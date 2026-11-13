/**
 * `w6w apps validate [dir] [--resolution sibling|registry] [--builder <spec>]`.
 *
 * Unit tests for the toolchain seam: `deno` is never started. Every test replaces
 * the spawn ({@linkcode useToolchainRunner}) and asserts the argv the CLI *would*
 * have run, then feeds back the one JSON line the builder prints. No network, no
 * temp app that is ever built.
 */

import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import type { CliIo, CommandContext, Invocation } from "../mod.ts";
import { createOutput, EXIT_USAGE, NO_CONFIG, NO_ENV, NO_STDIN, NO_STORE } from "../mod.ts";
import {
  builderArgs,
  DEFAULT_BUILDER,
  DENO_MISSING,
  type ToolchainResult,
  useToolchainRunner,
} from "../src/app-toolchain.ts";
import { VALIDATE_COMMANDS } from "../src/commands/validate.ts";

const NAMING = "w6w apps validate [dir] [--resolution sibling|registry] [--builder <spec>]";

const PASS_LINE = JSON.stringify({ ok: true, id: "demo-app", version: "0.1.0" });

const ERRORS = [
  {
    code: "app_id_mismatch",
    message: "`package.json` names `demo` but the directory is `demo-app`.",
  },
  {
    code: "unknown_specifier",
    message: "`@w6w/types` is neither a `jsr:` nor a relative specifier.",
  },
];

const ERROR_LINE = JSON.stringify({ ok: false, errors: ERRORS });

/** The invocation under test: positionals, `--flag` values, and whether `--json` is on. */
interface Invoked {
  positionals: string[];
  options?: Record<string, string>;
  json?: boolean;
}

/** A command context, the renderer included, writing into arrays a test can read. */
function context(
  invoked: Invoked,
): { context: CommandContext; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const io: CliIo = {
    stdout: (text) => stdout.push(text),
    stderr: (text) => stderr.push(text),
  };
  const invocation: Invocation = {
    command: ["apps", "validate"],
    positionals: invoked.positionals,
    globals: { json: invoked.json === true, noColor: true, version: false, help: false },
    options: invoked.options ?? {},
  };
  const command = {
    operation: "apps.validate",
    path: ["apps", "validate"],
    name: "apps validate",
    aliases: [],
    summary: "Validate an app directory against the canonical builder.",
    short: "Validate an app directory.",
    headline: "Validate an app directory against the canonical builder.",
    usage: "w6w apps validate [dir]",
    naming: NAMING,
    status: "live",
    params: [],
    examples: [],
    notes: [],
  };
  return {
    context: {
      command,
      invocation,
      out: createOutput(io, { json: invoked.json === true, noColor: true }),
      client: () => {
        throw new Error("`apps validate` never reaches the API.");
      },
      env: NO_ENV,
      stored: NO_CONFIG,
      store: NO_STORE,
      stdin: NO_STDIN,
    },
    stdout,
    stderr,
  };
}

/** One builder call, as the substituted runner saw it. */
interface Call {
  argv: string[];
  cwd: string;
}

/**
 * Run the handler with the spawn replaced. `answer` is what the builder would have
 * produced — or a function of the argv, for a test that cares what it was handed.
 */
async function validate(
  invoked: Invoked,
  answer: ToolchainResult | ((argv: string[]) => ToolchainResult),
): Promise<{ code: number | void; stdout: string; stderr: string; calls: Call[] }> {
  const calls: Call[] = [];
  const restore = useToolchainRunner((argv, cwd) => {
    calls.push({ argv, cwd });
    return Promise.resolve(typeof answer === "function" ? answer(argv) : answer);
  });
  const { context: ctx, stdout, stderr } = context(invoked);
  try {
    const code = await VALIDATE_COMMANDS["apps validate"](ctx);
    return { code, stdout: stdout.join("\n"), stderr: stderr.join("\n"), calls };
  } finally {
    restore();
  }
}

/** The argv the CLI builds for the default (jsr) builder. */
function jsrArgv(dir: string, resolution: string, spec = DEFAULT_BUILDER): string[] {
  return [
    "run",
    "-A",
    "--unstable-worker-options",
    "--no-config",
    spec,
    dir,
    "--validate",
    "--resolution",
    resolution,
  ];
}

/** An app directory holding a `deno.json`, with `@w6w/types` mapped as given. */
async function appWith(mapped: string | undefined): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "w6w-validate-app-" });
  if (mapped !== undefined) {
    await Deno.writeTextFile(
      `${dir}/deno.json`,
      JSON.stringify({ imports: { "@w6w/types": mapped } }, null, 2),
    );
  }
  return dir;
}

/** The `--resolution` value in an argv, or `undefined` when the flag was not passed. */
function resolutionOf(argv: string[]): string | undefined {
  const at = argv.indexOf("--resolution");
  return at === -1 ? undefined : argv[at + 1];
}

Deno.test("a jsr builder spec runs with --no-config", async () => {
  const dir = await appWith(undefined);
  assertEquals(await builderArgs(DEFAULT_BUILDER, dir, "validate", { resolution: "registry" }), [
    "run",
    "-A",
    "--unstable-worker-options",
    "--no-config",
    DEFAULT_BUILDER,
    dir,
    "--validate",
    "--resolution",
    "registry",
  ]);
});

Deno.test("a local builder gets --config with the nearest deno.json above it", async () => {
  const root = await Deno.makeTempDir({ prefix: "w6w-validate-path-" });
  await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify({ imports: {} }));
  await Deno.mkdir(`${root}/builder`);
  const spec = `${root}/builder/cli.ts`;
  const expected = [
    "run",
    "-A",
    "--unstable-worker-options",
    "--config",
    `${root}/deno.json`,
    spec,
    root,
    "--validate",
    "--resolution",
    "sibling",
  ];
  assertEquals(await builderArgs(spec, root, "validate", { resolution: "sibling" }), expected);
  // A `file:` URL (percent-encoded) names the same file: same config, absolute path.
  const url = `file://${spec.replace("builder", "buil%64er")}`;
  assertEquals(await builderArgs(url, root, "validate", { resolution: "sibling" }), expected);
});

Deno.test("a relative builder is made absolute, with [dir] != cwd", async () => {
  const root = await Deno.makeTempDir({ prefix: "w6w-validate-rel-" });
  await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify({ imports: {} }));
  await Deno.mkdir(`${root}/builder`);
  const dir = `${root}/app`;
  await Deno.mkdir(dir);
  const abs = await Deno.realPath(root);
  const prev = Deno.cwd();
  Deno.chdir(root);
  try {
    const argv = await builderArgs("builder/cli.ts", "app", "validate", {});
    assertEquals(argv.slice(3), [
      "--config",
      `${abs}/deno.json`,
      `${abs}/builder/cli.ts`,
      `${abs}/app`,
      "--validate",
    ]);
  } finally {
    Deno.chdir(prev);
  }
});

Deno.test("a passing app exits 0 and prints `ok <id>@<version>`", async () => {
  const dir = await appWith("jsr:@w6w/types@0.2.0");
  const { code, stdout, calls } = await validate({ positionals: [dir] }, {
    code: 0,
    stdout: `${PASS_LINE}\n`,
    stderr: "",
  });
  assertEquals(code, 0);
  assertEquals(stdout, "ok demo-app@0.1.0");
  assertEquals(calls, [{ argv: jsrArgv(dir, "registry"), cwd: dir }]);
});

Deno.test("the answer is the last line: builder progress above it is ignored", async () => {
  const dir = await appWith(undefined);
  const { code, stdout } = await validate({ positionals: [dir] }, {
    code: 0,
    stdout: `Download https://jsr.io/@w6w/app-build/0.2.0/cli.ts\n${PASS_LINE}\n`,
    stderr: "",
  });
  assertEquals(code, 0);
  assertEquals(stdout, "ok demo-app@0.1.0");
});

Deno.test("with no argument the app directory is the current one", async () => {
  const { code, calls } = await validate({ positionals: [] }, {
    code: 0,
    stdout: PASS_LINE,
    stderr: "",
  });
  assertEquals(code, 0);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].cwd, Deno.cwd());
  assertEquals(calls[0].argv.includes(Deno.cwd()), true);
});

Deno.test("a refusal prints every `code: message` and exits with the CLI's failure code", async () => {
  const dir = await appWith(undefined);
  const { code, stdout } = await validate({ positionals: [dir] }, {
    code: 1,
    stdout: `${ERROR_LINE}\n`,
    stderr: "",
  });
  assertEquals(code, EXIT_USAGE);
  assertEquals(code, 1);
  assertEquals(stdout, ERRORS.map((error) => `${error.code}: ${error.message}`).join("\n"));
});

Deno.test("--json passes the builder's line through, pass or refusal", async () => {
  const dir = await appWith(undefined);
  const passed = await validate({ positionals: [dir], json: true }, {
    code: 0,
    stdout: `${PASS_LINE}\n`,
    stderr: "",
  });
  assertEquals(passed.code, 0);
  assertEquals(JSON.parse(passed.stdout), { ok: true, id: "demo-app", version: "0.1.0" });

  const refused = await validate({ positionals: [dir], json: true }, {
    code: 1,
    stdout: `${ERROR_LINE}\n`,
    stderr: "",
  });
  assertEquals(refused.code, EXIT_USAGE);
  assertEquals(JSON.parse(refused.stdout), { ok: false, errors: ERRORS });
});

Deno.test("auto resolution: a jsr: mapping is `registry`, a relative one is `sibling`", async () => {
  const registry = await appWith("jsr:@w6w/types@0.2.0");
  const sibling = await appWith("./core/packages/types/mod.ts");
  const none = await appWith(undefined);

  const cases: [string, string][] = [
    [registry, "registry"],
    [sibling, "sibling"],
    [none, "sibling"],
  ];
  for (const [dir, expected] of cases) {
    const { calls } = await validate({ positionals: [dir] }, {
      code: 0,
      stdout: PASS_LINE,
      stderr: "",
    });
    assertEquals(resolutionOf(calls[0].argv), expected, dir);
  }
});

Deno.test("an explicit --resolution wins over the app's mapping, both ways", async () => {
  const registry = await appWith("jsr:@w6w/types@0.2.0");
  const sibling = await appWith("./core/packages/types/mod.ts");
  const cases: [string, string][] = [
    [registry, "sibling"],
    [sibling, "registry"],
  ];
  for (const [dir, flag] of cases) {
    const { calls } = await validate({ positionals: [dir], options: { resolution: flag } }, {
      code: 0,
      stdout: PASS_LINE,
      stderr: "",
    });
    assertEquals(resolutionOf(calls[0].argv), flag, dir);
  }
});

Deno.test("--builder overrides the default spec and is run with its own config", async () => {
  const root = await Deno.makeTempDir({ prefix: "w6w-validate-builder-" });
  await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify({ imports: {} }));
  await Deno.mkdir(`${root}/builder`);
  const spec = `${root}/builder/cli.ts`;
  const dir = await appWith(undefined);

  const { code, calls } = await validate({ positionals: [dir], options: { builder: spec } }, {
    code: 0,
    stdout: PASS_LINE,
    stderr: "",
  });
  assertEquals(code, 0);
  assertEquals(calls[0].argv, [
    "run",
    "-A",
    "--unstable-worker-options",
    "--config",
    `${root}/deno.json`,
    spec,
    dir,
    "--validate",
    "--resolution",
    "sibling",
  ]);
});

Deno.test("a bad --resolution is a usage error, and the builder is never started", async () => {
  const dir = await appWith(undefined);
  const calls: Call[] = [];
  const restore = useToolchainRunner((argv, cwd) => {
    calls.push({ argv, cwd });
    return Promise.resolve({ code: 0, stdout: PASS_LINE, stderr: "" });
  });
  const { context: ctx } = context({ positionals: [dir], options: { resolution: "floating" } });
  try {
    const error = await assertRejects(
      () => Promise.resolve(VALIDATE_COMMANDS["apps validate"](ctx)),
      Error,
    );
    assertStringIncludes(error.message, "--resolution must be `sibling` or `registry`");
    assertStringIncludes(error.message, `Usage: ${NAMING}`);
    assertEquals(calls.length, 0);
  } finally {
    restore();
  }
});

Deno.test("no Deno on PATH names the Deno prerequisite", async () => {
  const dir = await appWith(undefined);
  const restore = useToolchainRunner(() =>
    Promise.reject(Object.assign(new Error("spawn deno ENOENT"), { code: "ENOENT" }))
  );
  const { context: ctx } = context({ positionals: [dir] });
  try {
    const error = await assertRejects(
      () => Promise.resolve(VALIDATE_COMMANDS["apps validate"](ctx)),
      Error,
    );
    assertEquals(error.message, DENO_MISSING);
    assertStringIncludes(error.message, "Deno is required");
    assertStringIncludes(error.message, "PATH");
  } finally {
    restore();
  }
});

Deno.test("a builder that answers with no JSON line is reported with its stderr", async () => {
  const dir = await appWith(undefined);
  const { context: ctx } = context({ positionals: [dir] });
  const restore = useToolchainRunner(() =>
    Promise.resolve({
      code: 1,
      stdout: "warning: no lockfile\n",
      stderr: 'error: Relative import path "@w6w/app-build" not prefixed\n',
    })
  );
  try {
    const error = await assertRejects(
      () => Promise.resolve(VALIDATE_COMMANDS["apps validate"](ctx)),
      Error,
    );
    assertStringIncludes(error.message, "did not answer with its JSON line");
    assertStringIncludes(error.message, "no lockfile");
    assertStringIncludes(error.message, "error: Relative import path");
  } finally {
    restore();
  }
});
