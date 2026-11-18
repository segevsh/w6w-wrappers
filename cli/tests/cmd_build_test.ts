/**
 * `w6w apps build [dir] [-o|--out <dir>] [--pack <file>]` and its alias
 * `w6w build app <folder>`.
 *
 * The vendored assembler is never loaded: every test replaces it
 * ({@linkcode useAssembler}) with a fake that writes the artifact tree
 * `<out>/<id>/<version>/…` and returns the result, exactly as core's `assembleApp`
 * does. The real file system is used (temp directories) so `index.json`, the pack
 * lock, the reread and the rename are the ones that ship. No network, no build.
 */

import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import type { CliIo, CommandContext, Invocation } from "../mod.ts";
import { createOutput, main, NO_CONFIG, NO_ENV, NO_STDIN, NO_STORE } from "../mod.ts";
import { COMMANDS } from "../src/commands/index.ts";
import { APP_COMMANDS } from "../src/commands/apps.ts";
import { type BuildResult, useAssembler } from "../src/app-toolchain.ts";
import { BUILD_COMMANDS, type BuildEntry } from "../src/commands/build.ts";

const NAMING = "w6w apps build [dir] [-o|--out <dir>] [--pack <file>]";

/** The record a build of the fixture app produces, as it appears in `index.json`. */
const ENTRY: BuildEntry = {
  id: "io.w6w.demo",
  version: "0.1.0",
  execSha256: "a".repeat(64),
  digest: "b".repeat(64),
  digestVersion: 2,
  sourceDigest: "c".repeat(64),
};

/** An app directory: a package.json naming a prebuilt entry, and the entry itself. */
async function appDirWith(): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "w6w-build-app-" });
  await Deno.writeTextFile(
    `${dir}/package.json`,
    JSON.stringify({ name: "demo", version: "0.1.0", w6w: { entry: "./dist/app.js" } }),
  );
  await Deno.mkdir(`${dir}/dist`);
  await Deno.writeTextFile(`${dir}/dist/app.js`, "export default { actions: [] };\n");
  return dir;
}

/** Writes what a successful assembly writes, and returns its result. */
async function fabricate(out: string, entry: BuildEntry = ENTRY): Promise<BuildResult> {
  const at = `${out}/${entry.id}/${entry.version}`;
  await Deno.mkdir(at, { recursive: true });
  await Deno.writeTextFile(`${at}/app.js`, "// packaged\n");
  await Deno.writeTextFile(`${at}/manifest.json`, JSON.stringify({ id: entry.id }));
  return { ...entry, digestVersion: 2, outDir: at };
}

/** One assembler call, as the fake saw it. */
interface Call {
  dir: string;
  out: string;
}

type Answer = (dir: string, out: string) => Promise<BuildResult>;

/** Replace the assembler with one that records the call, then fabricates or answers. */
function assembler(calls: Call[], answer: Answer = (_dir, out) => fabricate(out)) {
  return useAssembler({
    assembleApp: (dir, out) => {
      calls.push({ dir, out });
      return answer(dir, out);
    },
    validateAssembled: () => Promise.reject(new Error("`apps build` never only validates")),
  });
}

/** A refusal thrown the way core's `BuildError` is: an Error carrying a `code`. */
function refuse(code: string, message: string): Answer {
  return () => Promise.reject(Object.assign(new Error(message), { code }));
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
    summary: "Package an app directory.",
    short: "Build an app directory.",
    headline: "Package an app directory.",
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

/** Drives the handler itself. */
async function appsBuild(
  invoked: { positionals: string[]; options?: Record<string, string>; json?: boolean },
  answer?: Answer,
): Promise<{ code: number | void; stdout: string; stderr: string; calls: Call[] }> {
  const calls: Call[] = [];
  const restore = assembler(calls, answer);
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
  answer?: Answer,
): Promise<{ code: number; stdout: string; stderr: string; calls: Call[] }> {
  const calls: Call[] = [];
  const restore = assembler(calls, answer);
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

Deno.test("apps build: the assembler packages the folder, and stdout is its index entry", async () => {
  const dir = await appDirWith();
  const out = await Deno.makeTempDir({ prefix: "w6w-build-out-" });
  const { code, stdout, calls } = await appsBuild({
    positionals: [dir],
    options: { out },
    json: true,
  });
  assertEquals(code, 0);
  assertEquals(calls, [{ dir, out }]);
  assertEquals(JSON.parse(stdout), ENTRY);
  // `outDir` is local-only: it never reaches the printed entry or the index.
  assert(!stdout.includes("outDir"));
  assertEquals(JSON.parse(await Deno.readTextFile(`${out}/index.json`)), {
    apps: [ENTRY],
    failures: [],
  });
});

Deno.test("build app: the alias builds through main() and prints the same entry", async () => {
  const dir = await appDirWith();
  const out = await Deno.makeTempDir({ prefix: "w6w-build-out-" });
  const { code, stdout, stderr, calls } = await buildApp([
    "build",
    "app",
    dir,
    "--out",
    out,
    "--json",
  ]);
  assertEquals(code, 0, stderr);
  assertEquals(JSON.parse(stdout), ENTRY);
  assertEquals(calls, [{ dir, out }]);
});

Deno.test("the human line names the artifact directory", async () => {
  const dir = await appDirWith();
  const out = await Deno.makeTempDir({ prefix: "w6w-build-out-" });
  const { code, stdout } = await appsBuild({ positionals: [dir], options: { out } });
  assertEquals(code, 0);
  assertEquals(stdout, `built io.w6w.demo@0.1.0 → ${out}/io.w6w.demo/0.1.0`);
});

Deno.test("assembler warnings are notes for a human, never part of --json", async () => {
  const dir = await appDirWith();
  const out = await Deno.makeTempDir({ prefix: "w6w-build-out-" });
  const warned: Answer = async (_dir, o) => ({
    ...(await fabricate(o)),
    warnings: ["action[ping] declares no output"],
  });
  const human = await appsBuild({ positionals: [dir], options: { out } }, warned);
  assertStringIncludes(human.stdout, "warning: action[ping] declares no output");
  const json = await appsBuild({ positionals: [dir], options: { out }, json: true }, warned);
  assertEquals(JSON.parse(json.stdout), ENTRY);
});

Deno.test("without -o the output root is ./out, relative to the invocation", async () => {
  const root = await Deno.makeTempDir({ prefix: "w6w-build-cwd-" });
  const dir = await appDirWith();
  const prev = Deno.cwd();
  Deno.chdir(root);
  try {
    const { code, calls } = await appsBuild({ positionals: [dir] });
    assertEquals(code, 0);
    assertEquals(calls[0].out, `${await Deno.realPath(root)}/out`);
  } finally {
    Deno.chdir(prev);
  }
});

Deno.test("a refused build reports `code: message` and leaves the pack alone", async () => {
  const root = await Deno.makeTempDir({ prefix: "w6w-build-refused-" });
  const dir = await appDirWith();
  const pack = `${root}/w6w-pack.json`;
  const error = await assertRejects(
    () =>
      appsBuild(
        { positionals: [dir], options: { out: `${root}/out`, pack } },
        refuse("bundle_not_self_contained", "`dist/app.js` imports `left-pad`; bundle it."),
      ),
    Error,
  );
  assertStringIncludes(error.message, `could not build \`${dir}\``);
  assertStringIncludes(
    error.message,
    "bundle_not_self_contained: `dist/app.js` imports `left-pad`; bundle it.",
  );
  assert(!(await exists(pack)), "a refused build must not record an entry");
  assert(!(await exists(`${root}/out/index.json`)), "a refused build writes no index");
});

Deno.test("build app: a refused build exits 1 with the refusal on stderr", async () => {
  const root = await Deno.makeTempDir({ prefix: "w6w-build-refused-" });
  const dir = await appDirWith();
  const { code, stdout, stderr } = await buildApp(
    ["build", "app", dir, "--out", `${root}/out`],
    refuse("invalid_id", "[invalid_id] `io.w6w.demo` is not a reverse-DNS id."),
  );
  assertEquals(code, 1);
  assertStringIncludes(stderr, "could not build");
  assertStringIncludes(stderr, "invalid_id: `io.w6w.demo` is not a reverse-DNS id.");
  assertEquals(stdout, "");
});

Deno.test("an assembler crash (no code) propagates as itself", async () => {
  const root = await Deno.makeTempDir({ prefix: "w6w-build-crash-" });
  const dir = await appDirWith();
  await assertRejects(
    () =>
      appsBuild(
        { positionals: [dir], options: { out: `${root}/out` } },
        () => Promise.reject(new TypeError("boom")),
      ),
    TypeError,
    "boom",
  );
});

Deno.test("a missing app directory is named, and nothing is packaged", async () => {
  const root = await Deno.makeTempDir({ prefix: "w6w-build-gone-" });
  const calls: Call[] = [];
  const restore = assembler(calls);
  const { context: ctx } = context({
    positionals: [`${root}/nope`],
    options: { out: `${root}/out` },
  });
  try {
    const error = await assertRejects(() => Promise.resolve(COMMANDS["apps build"](ctx)), Error);
    assertStringIncludes(error.message, "is not a directory");
    assertEquals(calls, []);
  } finally {
    restore();
  }
});

Deno.test("main(): --builder and --resolution are gone — unknown flags, nothing packaged", async () => {
  const dir = await appDirWith();
  for (
    const flag of [["--builder", "jsr:@w6w/app-build@0.2.0/cli"], ["--resolution", "registry"]]
  ) {
    const { code, stderr, calls } = await buildApp(["apps", "build", dir, ...flag]);
    assertEquals(code, 1, flag[0]);
    assertStringIncludes(stderr, flag[0]);
    assertEquals(calls, [], flag[0]);
  }
});

Deno.test("--pack: a new pack gets the canonical entry", async () => {
  const root = await Deno.makeTempDir({ prefix: "w6w-build-pack-" });
  const dir = await appDirWith();
  const pack = `${root}/w6w-pack.json`;
  const { code, stdout } = await appsBuild(
    { positionals: [dir], options: { out: `${root}/out`, pack }, json: true },
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
  const dir = await appDirWith();
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
  const dir = await appDirWith();
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

Deno.test("--pack: a malformed pack is a usage error before anything is packaged", async () => {
  const root = await Deno.makeTempDir({ prefix: "w6w-build-pack-" });
  const dir = await appDirWith();
  const pack = `${root}/w6w-pack.json`;
  await Deno.writeTextFile(pack, "{ nope");

  const calls: Call[] = [];
  const restore = assembler(calls);
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
  const restore = assembler(
    [],
    (dir, out) => fabricate(out, { ...ENTRY, id: `io.w6w.${dir.slice(dir.lastIndexOf("/") + 1)}` }),
  );
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
  const dir = await appDirWith();
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
    const dir = await appDirWith();
    const out = await Deno.makeTempDir({ prefix: "w6w-build-out-" });
    const { code, stderr, calls } = await buildApp([...head, dir, "-o", out, "--json"]);
    assertEquals(code, 0, stderr);
    assertEquals(calls, [{ dir, out }]);
  }
});

// ---------------------------------------------------------------------------
// `apps package`
// ---------------------------------------------------------------------------

const PACKAGE_FIXTURE = new URL("./fixtures/registry-package/", import.meta.url).pathname;

async function sha256Hex(text: string): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
  );
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The fake assembler for the fixture: the app id is the folder's name, `app.js` is unique per app. */
function packageBuilder(calls: Call[], failOn?: string) {
  return assembler(calls, async (dir, out) => {
    const id = dir.split("/").filter((p) => p !== "").pop() as string;
    if (id === failOn) {
      throw Object.assign(new Error("[load_failed] boom"), { code: "load_failed" });
    }
    const at = `${out}/${id}/0.1.0`;
    const js = `// ${id}\n`;
    await Deno.mkdir(at, { recursive: true });
    await Deno.writeTextFile(`${at}/app.js`, js);
    await Deno.writeTextFile(`${at}/manifest.json`, JSON.stringify({ id }));
    return { ...ENTRY, id, execSha256: await sha256Hex(js), digestVersion: 2, outDir: at };
  });
}

async function runPackage(out: string, failOn?: string) {
  const calls: Call[] = [];
  const restore = packageBuilder(calls, failOn);
  const { context: ctx, stderr } = context({
    positionals: [`${PACKAGE_FIXTURE}w6w-pack.json`],
    options: { out },
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

Deno.test("apps package: an unreadable pack is refused", async () => {
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

Deno.test("apps package: -o and --version work through main()", async () => {
  const out = await Deno.makeTempDir({ prefix: "w6w-package-out-" });
  const restore = packageBuilder([]);
  const err: string[] = [];
  let code: number;
  try {
    code = await main(
      ["apps", "package", `${PACKAGE_FIXTURE}w6w-pack.json`, "-o", out, "--version", "2.0.0"],
      { stdout: () => {}, stderr: (t) => err.push(t) },
      { commands: COMMANDS },
    );
  } finally {
    restore();
  }
  assertEquals(code, 0, err.join("\n"));
  assertEquals(await exists(`${out}/w6w/index.json`), true);
  assertEquals(JSON.parse(await Deno.readTextFile(`${out}/package.json`)).version, "2.0.0");
  assertEquals(JSON.parse(await Deno.readTextFile(`${out}/jsr.json`)).version, "2.0.0");
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

async function runPackageWith(out: string, options: Record<string, string>) {
  const calls: Call[] = [];
  const restore = packageBuilder(calls);
  const { context: ctx } = context({
    positionals: [`${PACKAGE_FIXTURE}w6w-pack.json`],
    options: { out, ...options },
  });
  try {
    await COMMANDS["apps package"](ctx);
  } finally {
    restore();
  }
}

Deno.test("apps package: --name/--version apply when package.json/jsr.json are created", async () => {
  const out = await Deno.makeTempDir({ prefix: "w6w-package-out-" });
  await runPackageWith(out, { name: "my-apps", version: "2.3.4" });
  const pkg = JSON.parse(await Deno.readTextFile(`${out}/package.json`));
  assertEquals([pkg.name, pkg.version], ["my-apps", "2.3.4"]);
  const jsr = JSON.parse(await Deno.readTextFile(`${out}/jsr.json`));
  assertEquals(jsr.version, "2.3.4");
});

Deno.test("apps package: --name/--version are ignored when the files exist", async () => {
  const out = await Deno.makeTempDir({ prefix: "w6w-package-out-" });
  const pkgBody = '{"name":"mine","version":"1.0.0","keywords":["w6w-app"],"files":["w6w/"]}\n';
  const jsrBody = '{"name":"@x/mine","version":"1.0.0","exports":"./w6w/index.json"}\n';
  await Deno.writeTextFile(`${out}/package.json`, pkgBody);
  await Deno.writeTextFile(`${out}/jsr.json`, jsrBody);
  await runPackageWith(out, { name: "other", version: "9.9.9" });
  assertEquals(await Deno.readTextFile(`${out}/package.json`), pkgBody);
  assertEquals(await Deno.readTextFile(`${out}/jsr.json`), jsrBody);
});

Deno.test("apps package: a created jsr.json carries a license (UNLICENSED by default)", async () => {
  const out = await Deno.makeTempDir({ prefix: "w6w-package-out-" });
  await runPackageWith(out, {});
  const jsr = JSON.parse(await Deno.readTextFile(`${out}/jsr.json`));
  assertEquals(jsr.license, "UNLICENSED");
});

Deno.test("apps package: a created jsr.json takes the license of an existing package.json", async () => {
  const out = await Deno.makeTempDir({ prefix: "w6w-package-out-" });
  await Deno.writeTextFile(
    `${out}/package.json`,
    '{"name":"mine","version":"1.0.0","license":"MIT","keywords":["w6w-app"],"files":["w6w/"]}\n',
  );
  await runPackageWith(out, {});
  assertEquals(JSON.parse(await Deno.readTextFile(`${out}/jsr.json`)).license, "MIT");
});

Deno.test("apps package: --license is honoured when nothing else declares one", async () => {
  const out = await Deno.makeTempDir({ prefix: "w6w-package-out-" });
  await runPackageWith(out, { license: "Apache-2.0" });
  assertEquals(JSON.parse(await Deno.readTextFile(`${out}/jsr.json`)).license, "Apache-2.0");
});
