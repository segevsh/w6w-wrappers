/**
 * `w6w apps build [dir] [-o|--out <dir>] [--pack <file>]` and its alias
 * `w6w build app <folder>`.
 *
 * The app builder is never started: every test replaces the Deno spawn
 * ({@linkcode useToolchainRunner}) and, where the flow continues past it, has the
 * fake write the canonical artifact — `<out>/<id>/<version>/…` plus
 * `<out>/index.json` — exactly as `@w6w/app-build` does. The real file system is
 * used (temp directories) so the pack lock, the reread and the rename are the ones
 * that ship. No network, no npm, no imported bundle.
 */

import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import type { CliIo, CommandContext, Invocation } from "../mod.ts";
import { createOutput, main, NO_CONFIG, NO_ENV, NO_STDIN, NO_STORE } from "../mod.ts";
import { COMMANDS } from "../src/commands/index.ts";
import { APP_COMMANDS } from "../src/commands/apps.ts";
import { type ToolchainResult, useToolchainRunner } from "../src/app-toolchain.ts";
import { BUILD_COMMANDS, type BuildEntry } from "../src/commands/build.ts";

const NAMING = "w6w apps build [dir] [-o|--out <dir>] [--pack <file>]";

/** The record a build of the fixture app produces, as it appears in `index.json`. */
const ENTRY: BuildEntry = {
  id: "io.w6w.demo",
  version: "0.1.0",
  execSha256: "a".repeat(64),
  digest: "b".repeat(64),
  sourceDigest: "c".repeat(64),
};

/** An app directory: an import map, an entry module, and deliberately no `package.json`. */
async function appDirWith(mapped: string | undefined): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "w6w-build-app-" });
  if (mapped !== undefined) {
    await Deno.writeTextFile(
      `${dir}/deno.json`,
      JSON.stringify({ imports: { "@w6w/types": mapped } }, null, 2),
    );
  }
  await Deno.writeTextFile(`${dir}/index.ts`, "export default { id: 'io.w6w.demo' };\n");
  return dir;
}

/** The `-o` value in an argv. */
function outOf(argv: string[]): string {
  const at = argv.indexOf("-o");
  if (at === -1) throw new Error(`no -o in ${argv.join(" ")}`);
  return argv[at + 1];
}

/** Writes what a successful builder writes: the artifact tree and `index.json`. */
async function fabricate(argv: string[], entry: BuildEntry = ENTRY): Promise<void> {
  const out = outOf(argv);
  const at = `${out}/${entry.id}/${entry.version}`;
  await Deno.mkdir(at, { recursive: true });
  await Deno.writeTextFile(`${at}/app.js`, "// built by @w6w/app-build\n");
  await Deno.writeTextFile(`${at}/manifest.json`, JSON.stringify({ id: entry.id }));
  await Deno.writeTextFile(
    `${out}/index.json`,
    JSON.stringify({ apps: [entry], failures: [] }, null, 2) + "\n",
  );
}

/** One builder call, as the substituted runner saw it. */
interface Call {
  argv: string[];
  cwd: string;
}

/**
 * A runner that pretends to be the builder: it records the call, then either
 * fabricates the canonical output or answers with the given failure.
 */
function builder(
  calls: Call[],
  answer: ToolchainResult | ((argv: string[]) => Promise<ToolchainResult> | ToolchainResult) = {
    code: 0,
    stdout: "",
    stderr: "",
  },
) {
  return useToolchainRunner(async (argv, cwd) => {
    calls.push({ argv, cwd });
    if (typeof answer === "function") return await answer(argv);
    if (answer.code === 0 && argv.includes("-o")) await fabricate(argv);
    return answer;
  });
}

/** A command context for `apps build`, the renderer included, writing into arrays. */
function context(
  invoked: { positionals: string[]; options?: Record<string, string>; json?: boolean },
): { context: CommandContext; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const io: CliIo = {
    stdout: (text) => stdout.push(text),
    stderr: (text) => stderr.push(text),
  };
  const invocation: Invocation = {
    command: ["apps", "build"],
    positionals: invoked.positionals,
    globals: { json: invoked.json === true, noColor: true, version: false, help: false },
    options: invoked.options ?? {},
  };
  const command = {
    operation: "apps.build",
    path: ["apps", "build"],
    name: "apps build",
    aliases: [],
    summary: "Build an app directory with the canonical builder.",
    short: "Build an app directory.",
    headline: "Build an app directory with the canonical builder.",
    usage: "w6w apps build [dir]",
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
        throw new Error("`apps build` never reaches the API.");
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

/** Drives the handler itself — `apps build` is not in the help tree until the surface lands. */
async function appsBuild(
  invoked: { positionals: string[]; options?: Record<string, string>; json?: boolean },
  answer?: ToolchainResult | ((argv: string[]) => Promise<ToolchainResult> | ToolchainResult),
): Promise<{ code: number | void; stdout: string; stderr: string; calls: Call[] }> {
  const calls: Call[] = [];
  const restore = builder(calls, answer);
  const { context: ctx, stdout, stderr } = context(invoked);
  try {
    const code = await COMMANDS["apps build"](ctx);
    return { code, stdout: stdout.join("\n"), stderr: stderr.join("\n"), calls };
  } finally {
    restore();
  }
}

/** Drives `main()` — the route `w6w build app` takes, help tree and flag parsing included. */
async function buildApp(
  argv: string[],
  answer?: ToolchainResult | ((argv: string[]) => Promise<ToolchainResult> | ToolchainResult),
): Promise<{ code: number; stdout: string; stderr: string; calls: Call[] }> {
  const calls: Call[] = [];
  const restore = builder(calls, answer);
  const out: string[] = [];
  const err: string[] = [];
  try {
    const code = await main(
      argv,
      { stdout: (text) => out.push(text), stderr: (text) => err.push(text) },
      { commands: COMMANDS },
    );
    return { code, stdout: out.join("\n"), stderr: err.join("\n"), calls };
  } finally {
    restore();
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

Deno.test("`apps build` and `build app` are one handler", () => {
  assertEquals(APP_COMMANDS["apps build"], BUILD_COMMANDS["build app"]);
  assertEquals(COMMANDS["apps build"], COMMANDS["build app"]);
});

Deno.test("apps build: the canonical builder runs, and stdout is its index entry", async () => {
  const dir = await appDirWith("jsr:@w6w/types@0.2.0");
  const out = await Deno.makeTempDir({ prefix: "w6w-build-out-" });
  const { code, stdout, calls } = await appsBuild({
    positionals: [dir],
    options: { out },
    json: true,
  }, {
    code: 0,
    stdout: "built 1/1 → index.json\n",
    stderr: "",
  });
  assertEquals(code, 0);
  // Nothing about the app folder is read here: no `package.json`, no `scripts.test`,
  // no `npm run build`, no import of a built bundle.
  assertEquals(calls, [{
    argv: [
      "run",
      "-A",
      "--unstable-worker-options",
      "--no-config",
      "jsr:@w6w/app-build@0.2.0/cli",
      dir,
      "-o",
      out,
      "--resolution",
      "registry",
    ],
    cwd: dir,
  }]);
  assertEquals(JSON.parse(stdout), ENTRY);
  // One document: the entry, never the builder's progress line.
  assert(!stdout.includes("built 1/1"));
});

Deno.test("build app: the alias builds through main() and prints the same entry", async () => {
  const dir = await appDirWith("./core/packages/types/mod.ts");
  const out = await Deno.makeTempDir({ prefix: "w6w-build-out-" });
  const { code, stdout, stderr, calls } = await buildApp(
    ["build", "app", dir, "--out", out, "--json"],
    { code: 0, stdout: "", stderr: "" },
  );
  assertEquals(code, 0, stderr);
  assertEquals(JSON.parse(stdout), ENTRY);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].argv.slice(0, 5), [
    "run",
    "-A",
    "--unstable-worker-options",
    "--no-config",
    "jsr:@w6w/app-build@0.2.0/cli",
  ]);
  assertEquals(calls[0].argv.slice(5), [dir, "-o", out, "--resolution", "sibling"]);
  assertEquals(calls[0].cwd, dir);
  assert(!stdout.includes("manifestVersion"));
});

Deno.test("the human line names the artifact the builder wrote", async () => {
  const dir = await appDirWith(undefined);
  const out = await Deno.makeTempDir({ prefix: "w6w-build-out-" });
  const { code, stdout } = await appsBuild({ positionals: [dir], options: { out } }, {
    code: 0,
    stdout: "",
    stderr: "",
  });
  assertEquals(code, 0);
  assertEquals(stdout, `built io.w6w.demo@0.1.0 → ${out}/io.w6w.demo/0.1.0`);
});

Deno.test("--builder overrides the spec and runs with its own config", async () => {
  const root = await Deno.makeTempDir({ prefix: "w6w-build-builder-" });
  await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify({ imports: {} }));
  await Deno.mkdir(`${root}/builder`);
  const spec = `${root}/builder/cli.ts`;
  const dir = await appDirWith(undefined);
  const out = await Deno.makeTempDir({ prefix: "w6w-build-out-" });
  const { code, calls } = await appsBuild(
    { positionals: [dir], options: { out, builder: spec } },
    { code: 0, stdout: "", stderr: "" },
  );
  assertEquals(code, 0);
  assertEquals(calls[0].argv, [
    "run",
    "-A",
    "--unstable-worker-options",
    "--config",
    `${root}/deno.json`,
    spec,
    dir,
    "-o",
    out,
    "--resolution",
    "sibling",
  ]);
});

Deno.test("a refused build reports the builder's own lines and leaves the pack alone", async () => {
  const root = await Deno.makeTempDir({ prefix: "w6w-build-refused-" });
  const dir = await appDirWith(undefined);
  const pack = `${root}/w6w-pack.json`;
  const error = await assertRejects(
    () =>
      appsBuild({ positionals: [dir], options: { out: `${root}/out`, pack } }, {
        code: 1,
        stdout: "",
        stderr: "io.w6w.demo: graph_npm: `left-pad` is an npm import; apps are dependency-free.\n",
      }),
    Error,
  );
  assertStringIncludes(error.message, `could not build \`${dir}\``);
  assertStringIncludes(error.message, "graph_npm");
  assert(!(await exists(pack)), "a refused build must not record an entry");
});

Deno.test("build app: a refused build exits 1 with the builder's line on stderr", async () => {
  const root = await Deno.makeTempDir({ prefix: "w6w-build-refused-" });
  const dir = await appDirWith(undefined);
  const { code, stdout, stderr } = await buildApp(
    ["build", "app", dir, "--out", `${root}/out`],
    {
      code: 1,
      stdout: "built 0/1 → index.json\n",
      stderr: "io.w6w.demo: invalid_id: `io.w6w.demo` is not a reverse-DNS id.\n",
    },
  );
  assertEquals(code, 1);
  assertStringIncludes(stderr, "could not build");
  assertStringIncludes(stderr, "invalid_id");
  assertEquals(stdout, "");
});

Deno.test("a builder that wrote no index.json is reported, not read", async () => {
  const root = await Deno.makeTempDir({ prefix: "w6w-build-empty-" });
  const dir = await appDirWith(undefined);
  const error = await assertRejects(
    () =>
      appsBuild({ positionals: [dir], options: { out: `${root}/out` } }, () => ({
        code: 0,
        stdout: "built 1/1 → index.json\n",
        stderr: "",
      })),
    Error,
  );
  assertStringIncludes(error.message, `${root}/out/index.json`);
  assertStringIncludes(error.message, "not built");
});

Deno.test("a bad --resolution is a usage error, and the builder is never started", async () => {
  const dir = await appDirWith(undefined);
  const error = await assertRejects(
    () => appsBuild({ positionals: [dir], options: { resolution: "floating" } }),
    Error,
  );
  assertStringIncludes(error.message, "--resolution must be `sibling` or `registry`");
  assertStringIncludes(error.message, `Usage: ${NAMING}`);
});

Deno.test("--pack: a new pack gets the canonical entry", async () => {
  const root = await Deno.makeTempDir({ prefix: "w6w-build-pack-" });
  const dir = await appDirWith(undefined);
  const pack = `${root}/w6w-pack.json`;
  const { code, stdout } = await appsBuild(
    { positionals: [dir], options: { out: `${root}/out`, pack }, json: true },
    { code: 0, stdout: "", stderr: "" },
  );
  assertEquals(code, 0);
  assertEquals(JSON.parse(stdout), ENTRY);
  assertEquals(JSON.parse(await Deno.readTextFile(pack)), { apps: [ENTRY] });
  assert(!(await exists(`${pack}.lock`)));
});

Deno.test("--pack: updates by path, keeping the line's other fields", async () => {
  const root = await Deno.makeTempDir({ prefix: "w6w-build-pack-" });
  const dir = `${root}/app`;
  await Deno.mkdir(dir, { recursive: true });
  const pack = `${root}/w6w-pack.json`;
  await Deno.writeTextFile(
    pack,
    JSON.stringify({
      name: "official",
      apps: [{ path: "./zzz", id: "x" }, { path: "./app/", note: "keep", id: "old" }],
      tail: 1,
    }),
  );
  // The pack names the folder relatively: the entry lands on that line, and the
  // fields the CLI does not own survive.
  const { code } = await appsBuild({
    positionals: [dir],
    options: { out: `${root}/out`, pack },
  });
  assertEquals(code, 0);
  const written = JSON.parse(await Deno.readTextFile(pack));
  assertEquals(Object.keys(written), ["name", "apps", "tail"]);
  assertEquals(written.apps[0], { path: "./zzz", id: "x" });
  assertEquals(written.apps[1], { path: "./app/", note: "keep", ...ENTRY });
});

Deno.test("--pack: updates by id when no path matches", async () => {
  const root = await Deno.makeTempDir({ prefix: "w6w-build-pack-" });
  const dir = await appDirWith(undefined);
  const pack = `${root}/index.json`;
  await Deno.writeTextFile(
    pack,
    JSON.stringify({ apps: [{ id: "io.w6w.demo", version: "0.0.1", path: "./elsewhere" }] }),
  );
  const { code } = await appsBuild({
    positionals: [dir],
    options: { out: `${root}/out`, pack },
  });
  assertEquals(code, 0);
  assertEquals(JSON.parse(await Deno.readTextFile(pack)).apps, [
    { path: "./elsewhere", ...ENTRY },
  ]);
});

Deno.test("--pack: appends when nothing matches", async () => {
  const root = await Deno.makeTempDir({ prefix: "w6w-build-pack-" });
  const dir = await appDirWith(undefined);
  const pack = `${root}/packs/w6w-pack.json`;
  await Deno.mkdir(`${root}/packs`);
  await Deno.writeTextFile(pack, JSON.stringify({ apps: [{ path: "./other", id: "o" }] }));
  const { code } = await appsBuild({
    positionals: [dir],
    options: { out: `${root}/out`, pack },
  });
  assertEquals(code, 0);
  assertEquals(JSON.parse(await Deno.readTextFile(pack)).apps, [
    { path: "./other", id: "o" },
    ENTRY,
  ]);
});

Deno.test("--pack: a malformed pack is a usage error before the builder runs", async () => {
  const root = await Deno.makeTempDir({ prefix: "w6w-build-pack-" });
  const dir = await appDirWith(undefined);
  const pack = `${root}/w6w-pack.json`;
  await Deno.writeTextFile(pack, "{ nope");

  const calls: Call[] = [];
  const restore = builder(calls);
  const { context: ctx } = context({
    positionals: [dir],
    options: { out: `${root}/out`, pack },
  });
  try {
    const error = await assertRejects(
      () => Promise.resolve(COMMANDS["apps build"](ctx)),
      Error,
    );
    assertStringIncludes(error.message, `\`${pack}\` is not valid JSON`);
    assertEquals(calls, []);
  } finally {
    restore();
  }
});

Deno.test("--pack: concurrent builds against one pack all land", async () => {
  const root = await Deno.makeTempDir({ prefix: "w6w-build-pack-" });
  const pack = `${root}/w6w-pack.json`;
  const dirs = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => `${root}/app-${i}`);
  for (const dir of dirs) await Deno.mkdir(dir);

  // One runner for all of them — a build is identified by the folder it was handed,
  // which is what makes eight of them distinguishable in the pack.
  const restore = useToolchainRunner(async (argv, cwd) => {
    await fabricate(argv, { ...ENTRY, id: `io.w6w.${cwd.slice(cwd.lastIndexOf("/") + 1)}` });
    return { code: 0, stdout: "", stderr: "" };
  });
  try {
    const results = await Promise.all(
      dirs.map((dir, i) => {
        const { context: ctx, stdout } = context({
          positionals: [dir],
          options: { out: `${root}/out-${i}`, pack },
        });
        return Promise.resolve(COMMANDS["apps build"](ctx)).then((code) => ({
          code,
          stderr: stdout.join(""),
        }));
      }),
    );
    for (const result of results) assertEquals(result.code, 0, result.stderr);
  } finally {
    restore();
  }

  const written = JSON.parse(await Deno.readTextFile(pack));
  assertEquals(
    written.apps.map((a: { id: string }) => a.id).sort(),
    dirs.map((dir) => `io.w6w.${dir.slice(dir.lastIndexOf("/") + 1)}`).sort(),
  );
  assert(!(await exists(`${pack}.lock`)));
  const leftovers: string[] = [];
  for await (const entry of Deno.readDir(root)) {
    if (entry.name.endsWith(".tmp")) leftovers.push(entry.name);
  }
  assertEquals(leftovers, []);
});

Deno.test("--pack: a stale lock is removed", async () => {
  const root = await Deno.makeTempDir({ prefix: "w6w-build-pack-" });
  const dir = await appDirWith(undefined);
  const pack = `${root}/w6w-pack.json`;
  await Deno.writeTextFile(`${pack}.lock`, "");
  const old = new Date(Date.now() - 120_000);
  await Deno.utime(`${pack}.lock`, old, old);
  const { code } = await appsBuild({
    positionals: [dir],
    options: { out: `${root}/out`, pack },
  });
  assertEquals(code, 0);
  assertEquals(JSON.parse(await Deno.readTextFile(pack)).apps.length, 1);
  assert(!(await exists(`${pack}.lock`)));
});

Deno.test("-o is the short form of --out on `apps build` and `build app`, through main()", async () => {
  for (const head of [["apps", "build"], ["build", "app"]]) {
    const dir = await appDirWith("jsr:@w6w/types@0.2.0");
    const out = await Deno.makeTempDir({ prefix: "w6w-build-out-" });
    const { code, stderr, calls } = await buildApp(
      [...head, dir, "-o", out, "--json"],
      { code: 0, stdout: "", stderr: "" },
    );
    assertEquals(code, 0, stderr);
    assertEquals(calls.length, 1);
    assertEquals(calls[0].argv.slice(-4), ["-o", out, "--resolution", "registry"]);
  }
});

// ---------------------------------------------------------------------------
// `apps package`
// ---------------------------------------------------------------------------

const PACKAGE_FIXTURE = new URL("./fixtures/registry-package/", import.meta.url).pathname;

/** The fake builder for the fixture: the app id is the folder's name, `app.js` is unique per app. */
function packageBuilder(calls: Call[], failOn?: string) {
  return useToolchainRunner(async (argv, cwd) => {
    calls.push({ argv, cwd });
    const id = cwd.split("/").pop() as string;
    if (id === failOn) return { code: 1, stdout: "", stderr: "boom" };
    const entry: BuildEntry = { ...ENTRY, id, execSha256: undefined as unknown as string };
    delete (entry as Record<string, unknown>).execSha256;
    const out = outOf(argv);
    const at = `${out}/${id}/0.1.0`;
    await Deno.mkdir(at, { recursive: true });
    await Deno.writeTextFile(`${at}/app.js`, `// ${id}\n`);
    await Deno.writeTextFile(`${at}/manifest.json`, JSON.stringify({ id }));
    await Deno.writeTextFile(`${out}/index.json`, JSON.stringify({ apps: [entry] }));
    return { code: 0, stdout: "", stderr: "" };
  });
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
  );
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function runPackage(out: string, failOn?: string) {
  const calls: Call[] = [];
  const restore = packageBuilder(calls, failOn);
  const { context: ctx, stderr } = context({
    positionals: [`${PACKAGE_FIXTURE}w6w-pack.json`],
    options: { out, resolution: "registry" },
  });
  try {
    const code = await COMMANDS["apps package"](ctx);
    return { code, calls, stderr, error: undefined as Error | undefined };
  } catch (error) {
    return { code: undefined, calls, stderr, error: error as Error };
  } finally {
    restore();
  }
}

Deno.test("apps package: writes w6w/index.json with execSha256 = sha-256 of each app.js", async () => {
  const out = await Deno.makeTempDir({ prefix: "w6w-package-out-" });
  const run = await runPackage(out);
  assertEquals(run.error, undefined);
  assertEquals(run.calls.length, 2);
  const index = JSON.parse(await Deno.readTextFile(`${out}/w6w/index.json`));
  assertEquals(index.apps.map((a: BuildEntry) => a.id), ["io.w6w.alpha", "io.w6w.beta"]);
  for (const app of index.apps as BuildEntry[]) {
    const js = await Deno.readTextFile(`${out}/w6w/${app.id}/${app.version}/app.js`);
    assertEquals(app.execSha256, await sha256Hex(js));
    assert(await exists(`${out}/w6w/${app.id}/${app.version}/manifest.json`));
  }
  // staging is gone (only the tree and the two publish manifests remain)
  assertEquals([...Deno.readDirSync(out)].map((e) => e.name).sort(), [
    "jsr.json",
    "package.json",
    "w6w",
  ]);
});

Deno.test("apps package: one app failing writes nothing to <out>/w6w", async () => {
  const out = await Deno.makeTempDir({ prefix: "w6w-package-out-" });
  const run = await runPackage(out, "io.w6w.beta");
  assert(run.error !== undefined);
  assertStringIncludes(run.error.message, "io.w6w.beta");
  assertEquals(await exists(`${out}/w6w`), false);
  assertEquals([...Deno.readDirSync(out)].length, 0);
});

Deno.test("apps package: a pack the builder cannot read is refused", async () => {
  const out = await Deno.makeTempDir({ prefix: "w6w-package-out-" });
  const { context: ctx } = context({ positionals: [`${out}/missing.json`], options: { out } });
  await assertRejects(
    () => Promise.resolve(COMMANDS["apps package"](ctx)),
    Error,
    "nothing was written",
  );
  assertEquals(await exists(`${out}/w6w`), false);
});

Deno.test("apps package: routes through main(); a failing app exits nonzero with no index.json", async () => {
  const out = await Deno.makeTempDir({ prefix: "w6w-package-out-" });
  const restore = packageBuilder([], "io.w6w.beta");
  const err: string[] = [];
  let code: number;
  try {
    code = await main(
      [
        "apps",
        "package",
        `${PACKAGE_FIXTURE}w6w-pack.json`,
        "--out",
        out,
        "--resolution",
        "registry",
      ],
      { stdout: () => {}, stderr: (t) => err.push(t) },
      { commands: COMMANDS },
    );
  } finally {
    restore();
  }
  assert(code !== 0, `expected nonzero exit, got ${code}; ${err.join("\n")}`);
  assertEquals(await exists(`${out}/w6w/index.json`), false);
});

Deno.test("apps package: creates package.json and jsr.json per P2 when absent", async () => {
  const out = await Deno.makeTempDir({ prefix: "w6w-package-out-" });
  const run = await runPackage(out);
  assertEquals(run.error, undefined);
  const pkg = JSON.parse(await Deno.readTextFile(`${out}/package.json`));
  assertEquals(pkg.keywords, ["w6w-app"]);
  assertEquals(pkg.files, ["w6w/"]);
  for (const key of ["dependencies", "devDependencies", "optionalDependencies"]) {
    assertEquals(key in pkg, false);
  }
  const jsr = JSON.parse(await Deno.readTextFile(`${out}/jsr.json`));
  assertEquals(jsr.exports, "./w6w/index.json");
  assertEquals(jsr.publish.include, ["jsr.json", "w6w/"]);
  assertEquals("imports" in jsr, false);
});

const REFUSED: [string, string, string, string][] = [
  ["package.json", '{"name":"x","keywords":["w6w-app"],"dependencies":{}}\n', "dependencies", ""],
  ["package.json", '{"name":"x","version":"1.0.0"}\n', "keywords", ""],
  [
    "package.json",
    '{"name":"x","keywords":["w6w-app"],"imports":{"a":"npm:left-pad"}}\n',
    "npm:/jsr:",
    "",
  ],
  ["deno.json", '{"imports":{"a":"jsr:@std/path"}}\n', "npm:/jsr:", ""],
];

for (const [file, body, needle] of REFUSED) {
  Deno.test(`apps package: existing ${file} (${needle}) is refused, nothing written`, async () => {
    const out = await Deno.makeTempDir({ prefix: "w6w-package-out-" });
    await Deno.writeTextFile(`${out}/${file}`, body);
    const run = await runPackage(out);
    assert(run.error !== undefined);
    assertStringIncludes(run.error.message, needle);
    assertEquals(await Deno.readTextFile(`${out}/${file}`), body);
    assertEquals(await exists(`${out}/w6w`), false);
    assertEquals(run.calls.length, 0);
    assertEquals([...Deno.readDirSync(out)].map((e) => e.name), [file]);
  });
}

Deno.test("apps package: a valid existing package.json is left byte-identical", async () => {
  const out = await Deno.makeTempDir({ prefix: "w6w-package-out-" });
  const body = '{"name":"mine","keywords":["w6w-app"],"files":["w6w/"]}\n';
  await Deno.writeTextFile(`${out}/package.json`, body);
  const run = await runPackage(out);
  assertEquals(run.error, undefined);
  assertEquals(await Deno.readTextFile(`${out}/package.json`), body);
  assert(await exists(`${out}/jsr.json`));
});
