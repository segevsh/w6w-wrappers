/**
 * `w6w apps validate [dir]`.
 *
 * Unit tests for the assembler seam: the vendored assembler is never loaded. Every
 * test replaces it ({@linkcode useAssembler}), asserts the directory the CLI handed
 * it, and feeds back the report it would have produced. No network, no build.
 */

import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import type { CliIo, CommandContext, Invocation } from "../mod.ts";
import { createOutput, EXIT_USAGE, main, NO_CONFIG, NO_ENV, NO_STDIN, NO_STORE } from "../mod.ts";
import { type Assembler, type BuilderReport, useAssembler } from "../src/app-toolchain.ts";
import { COMMANDS } from "../src/commands/index.ts";
import { VALIDATE_COMMANDS } from "../src/commands/validate.ts";

const NAMING = "w6w apps validate [dir]";

const PASS: BuilderReport = { ok: true, id: "com.example.demo-app", version: "0.1.0" };

const ERRORS = [
  { code: "entry_missing", message: "`dist/app.js` does not exist; run your build first." },
  { code: "entry_not_js", message: "`w6w.entry` must name a .js or .mjs file." },
];

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
    summary: "Validate an app directory.",
    short: "Validate an app directory.",
    headline: "Validate an app directory.",
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

/** An assembler whose `validateAssembled` answers with `answer` and records each call. */
function fake(calls: string[], answer: () => Promise<BuilderReport>): Assembler {
  return {
    assembleApp: () => Promise.reject(new Error("`apps validate` never packages")),
    validateAssembled: (dir) => {
      calls.push(dir);
      return answer();
    },
  };
}

/** Run the handler with the assembler replaced. */
async function validate(
  invoked: Invoked,
  answer: BuilderReport | (() => Promise<BuilderReport>),
): Promise<{ code: number | void; stdout: string; stderr: string; calls: string[] }> {
  const calls: string[] = [];
  const restore = useAssembler(
    fake(calls, typeof answer === "function" ? answer : () => Promise.resolve(answer)),
  );
  const { context: ctx, stdout, stderr } = context(invoked);
  try {
    const code = await VALIDATE_COMMANDS["apps validate"](ctx);
    return { code, stdout: stdout.join("\n"), stderr: stderr.join("\n"), calls };
  } finally {
    restore();
  }
}

/** A refusal thrown the way core's `BuildError` is: an Error carrying a `code`. */
function buildError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

Deno.test("a passing app exits 0 and prints `ok <id>@<version>`", async () => {
  const dir = await Deno.makeTempDir({ prefix: "w6w-validate-app-" });
  const { code, stdout, calls } = await validate({ positionals: [dir] }, PASS);
  assertEquals(code, 0);
  assertEquals(stdout, "ok com.example.demo-app@0.1.0");
  assertEquals(calls, [dir]);
});

Deno.test("with no argument the app directory is the current one", async () => {
  const { code, calls } = await validate({ positionals: [] }, PASS);
  assertEquals(code, 0);
  assertEquals(calls, [Deno.cwd()]);
});

Deno.test("a relative [dir] is resolved against the invocation's cwd", async () => {
  const root = await Deno.makeTempDir({ prefix: "w6w-validate-rel-" });
  await Deno.mkdir(`${root}/app`);
  const prev = Deno.cwd();
  Deno.chdir(root);
  try {
    const { calls } = await validate({ positionals: ["app"] }, PASS);
    assertEquals(calls, [`${await Deno.realPath(root)}/app`]);
  } finally {
    Deno.chdir(prev);
  }
});

Deno.test("a refusal prints every `code: message` and exits with the CLI's failure code", async () => {
  const dir = await Deno.makeTempDir({ prefix: "w6w-validate-app-" });
  const { code, stdout } = await validate({ positionals: [dir] }, { ok: false, errors: ERRORS });
  assertEquals(code, EXIT_USAGE);
  assertEquals(code, 1);
  assertEquals(stdout, ERRORS.map((error) => `${error.code}: ${error.message}`).join("\n"));
});

Deno.test("--json prints the one report line, pass or refusal", async () => {
  const dir = await Deno.makeTempDir({ prefix: "w6w-validate-app-" });
  const passed = await validate({ positionals: [dir], json: true }, PASS);
  assertEquals(passed.code, 0);
  assertEquals(JSON.parse(passed.stdout), PASS);

  const refused = await validate({ positionals: [dir], json: true }, {
    ok: false,
    errors: ERRORS,
  });
  assertEquals(refused.code, EXIT_USAGE);
  assertEquals(JSON.parse(refused.stdout), { ok: false, errors: ERRORS });
});

Deno.test("a thrown BuildError is the same refusal report, not a crash", async () => {
  const dir = await Deno.makeTempDir({ prefix: "w6w-validate-app-" });
  const { code, stdout } = await validate(
    { positionals: [dir], json: true },
    () => Promise.reject(buildError("invalid_package", "package.json is not valid JSON")),
  );
  assertEquals(code, EXIT_USAGE);
  assertEquals(JSON.parse(stdout), {
    ok: false,
    errors: [{ code: "invalid_package", message: "package.json is not valid JSON" }],
  });
});

Deno.test("an assembler crash (no code) is thrown, not reported as a refusal", async () => {
  const dir = await Deno.makeTempDir({ prefix: "w6w-validate-app-" });
  const calls: string[] = [];
  const restore = useAssembler(fake(calls, () => Promise.reject(new TypeError("boom"))));
  const { context: ctx, stdout } = context({ positionals: [dir] });
  try {
    await assertRejects(() => Promise.resolve(VALIDATE_COMMANDS["apps validate"](ctx)), TypeError);
    assertEquals(stdout, []);
  } finally {
    restore();
  }
});

Deno.test("a missing app directory is named, and the assembler is never asked", async () => {
  const dir = `${await Deno.makeTempDir({ prefix: "w6w-validate-gone-" })}/nope`;
  const calls: string[] = [];
  const restore = useAssembler(fake(calls, () => Promise.resolve(PASS)));
  const { context: ctx } = context({ positionals: [dir] });
  try {
    const error = await assertRejects(
      () => Promise.resolve(VALIDATE_COMMANDS["apps validate"](ctx)),
      Error,
    );
    assertStringIncludes(error.message, "is not a directory");
    assertStringIncludes(error.message, "nope");
    assertEquals(calls, []);
  } finally {
    restore();
  }
});

Deno.test("main(): --builder and --resolution are gone — unknown flags, nothing validated", async () => {
  const dir = await Deno.makeTempDir({ prefix: "w6w-validate-app-" });
  for (
    const flag of [["--builder", "jsr:@w6w/app-build@0.2.0/cli"], ["--resolution", "registry"]]
  ) {
    const calls: string[] = [];
    const restore = useAssembler(fake(calls, () => Promise.resolve(PASS)));
    const err: string[] = [];
    try {
      const code = await main(
        ["apps", "validate", dir, ...flag],
        { stdout: () => {}, stderr: (text) => err.push(text) },
        { commands: COMMANDS },
      );
      assertEquals(code, 1, flag[0]);
      assertStringIncludes(err.join("\n"), flag[0]);
      assertEquals(calls, [], flag[0]);
    } finally {
      restore();
    }
  }
});

Deno.test("core's `[code] ` message prefix is dropped, so the code is never said twice", async () => {
  const dir = await Deno.makeTempDir({ prefix: "w6w-validate-app-" });
  const thrown = await validate(
    { positionals: [dir] },
    () =>
      Promise.reject(buildError("entry_missing", "[entry_missing] `dist/app.js` does not exist")),
  );
  assertEquals(thrown.stdout, "entry_missing: `dist/app.js` does not exist");

  const reported = await validate({ positionals: [dir], json: true }, {
    ok: false,
    errors: [{ code: "entry_not_js", message: "[entry_not_js] `w6w.entry` must name a .js file" }],
  });
  assertEquals(JSON.parse(reported.stdout), {
    ok: false,
    errors: [{ code: "entry_not_js", message: "`w6w.entry` must name a .js file" }],
  });
});
