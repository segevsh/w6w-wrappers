// deno-lint-ignore-file no-explicit-any
/**
 * `w6w build app <folder> [--out <dir>] [--pack <file>]`.
 *
 * Real `main()` and the real file system (a temp copy of `tests/fixtures/build-app`),
 * with the `npm` runner replaced so nothing is spawned. Nothing touches a network.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { main, VERSION } from "../mod.ts";
import { COMMANDS } from "../src/commands/index.ts";
import { useBuildRunner } from "../src/commands/build.ts";

const FIXTURE = new URL("./fixtures/build-app/", import.meta.url).pathname;

async function copyDir(from: string, to: string): Promise<void> {
  await Deno.mkdir(to, { recursive: true });
  for await (const entry of Deno.readDir(from)) {
    if (entry.isDirectory) await copyDir(`${from}/${entry.name}`, `${to}/${entry.name}`);
    else await Deno.copyFile(`${from}/${entry.name}`, `${to}/${entry.name}`);
  }
}

/** A temp workspace holding a copy of the fixture at `<root>/app`. */
async function workspace() {
  const root = await Deno.makeTempDir({ prefix: "w6w-build-" });
  await copyDir(FIXTURE, `${root}/app`);
  return { root, app: `${root}/app` };
}

async function editPackage(app: string, edit: (pkg: Record<string, any>) => void) {
  const path = `${app}/package.json`;
  const pkg = JSON.parse(await Deno.readTextFile(path));
  edit(pkg);
  await Deno.writeTextFile(path, JSON.stringify(pkg));
}

async function sha(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function dataUri(mime: string, text: string): string {
  return `data:${mime};base64,${btoa(text)}`;
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

async function run(argv: string[], npm: (script: string) => number = () => 0) {
  const calls: string[] = [];
  const restore = useBuildRunner((args, cwd) => {
    calls.push(`${args.join(" ")} @ ${cwd}`);
    return Promise.resolve(npm(args[1]));
  });
  const out: string[] = [];
  const err: string[] = [];
  try {
    const code = await main(argv, { stdout: (t) => out.push(t), stderr: (t) => err.push(t) }, {
      commands: COMMANDS,
    });
    return { code, stdout: out.join("\n"), stderr: err.join("\n"), calls };
  } finally {
    restore();
  }
}

Deno.test("build app: missing package.json or fields is a usage error, nothing runs", async () => {
  const { root, app } = await workspace();
  const none = await run(["build", "app", `${root}/nowhere`]);
  assertEquals(none.code, 1);
  assertStringIncludes(none.stderr, "package.json");

  for (
    const [field, edit] of [
      ["w6w.id", (p: Record<string, any>) => delete p.w6w.id],
      ["version", (p: Record<string, any>) => delete p.version],
      ["scripts.test", (p: Record<string, any>) => delete p.scripts.test],
      ["scripts.build", (p: Record<string, any>) => delete p.scripts.build],
      ["main", (p: Record<string, any>) => delete p.main],
    ] as const
  ) {
    const copy = `${root}/copy-${field}`;
    await copyDir(app, copy);
    await editPackage(copy, edit);
    const result = await run(["build", "app", copy]);
    assertEquals(result.code, 1, field);
    assertStringIncludes(result.stderr, field);
    assertStringIncludes(result.stderr, "Usage: w6w build app <folder>");
    assertEquals(result.calls, [], "npm must not run");
  }
});

Deno.test("build app: a failing test stops before build and writes nothing", async () => {
  const { root, app } = await workspace();
  const out = `${root}/out`;
  const result = await run(
    ["build", "app", app, "--out", out],
    (script) => script === "test" ? 3 : 0,
  );
  assert(result.code !== 0);
  assertStringIncludes(result.stderr, "npm run test");
  assertEquals(result.calls.length, 1);
  assert(!(await exists(out)));
});

Deno.test("build app: a failing build exits non-zero and writes nothing", async () => {
  const { root, app } = await workspace();
  const out = `${root}/out`;
  const result = await run(
    ["build", "app", app, "--out", out],
    (script) => script === "build" ? 1 : 0,
  );
  assert(result.code !== 0);
  assertStringIncludes(result.stderr, "npm run build");
  assertEquals(result.calls.length, 2);
  assert(!(await exists(out)));
});

Deno.test("build app: happy path writes app.js and a deterministic manifest", async () => {
  const { root, app } = await workspace();
  const out = `${root}/out`;
  const result = await run(["build", "app", app, "--out", out, "--json"]);
  assertEquals(result.code, 0, result.stderr);
  assertEquals(result.calls.map((c) => c.split(" @ ")[0]), ["run test", "run build"]);

  const built = await Deno.readFile(`${app}/built/app.js`);
  const digest = await sha(built);
  assertEquals(JSON.parse(result.stdout), {
    id: "io.w6w.fixture",
    version: "1.2.3",
    digest,
    out,
    files: ["app.js", "manifest.json"],
  });
  assertEquals(await Deno.readFile(`${out}/app.js`), built);
  assert(!(await exists(`${out}/assets`)));

  const text = await Deno.readTextFile(`${out}/manifest.json`);
  assert(text.endsWith("}\n"));
  const manifest = JSON.parse(text);
  assertEquals(Object.keys(manifest), [
    "manifestVersion",
    "id",
    "name",
    "version",
    "description",
    "license",
    "app",
    "exec",
    "digest",
    "definition",
    "builder",
  ]);
  assertEquals(manifest.name, "@w6w-apps/fixture");
  assertEquals(manifest.builder, `@w6w/cli@${VERSION}`);
  assertEquals(manifest.exec, {
    file: "app.js",
    sha256: digest,
    bytes: built.length,
    format: "esm",
  });
  assertEquals(manifest.digest, digest);
  assertEquals(manifest.app, {
    id: "io.w6w.fixture",
    displayName: "Fixture",
    appearance: {
      icon: {
        url: dataUri("image/png", "PNG-one"),
        sizes: {
          "64": dataUri("image/png", "PNG-one"),
          "128": dataUri("image/png", "PNG-two"),
        },
      },
      homepage: "https://example.com/",
    },
  });
  assertEquals(manifest.assets, undefined);
  assertEquals(manifest.definition.actions, [
    { name: "send", description: "Send", hooks: ["execute", "validate"] },
    { name: "list", hooks: [] },
  ]);
  assertEquals(manifest.definition.auth, [{ type: "apiKey", hooks: ["authenticate"] }]);
  assertEquals(manifest.definition.triggers, [
    { name: "onMessage", hooks: ["subscribe", "unsubscribe"] },
  ]);
  assertEquals(manifest.definition.healthChecks, [{ name: "ping", hooks: ["run"] }]);

  // Deterministic: a second build yields identical bytes.
  await run(["build", "app", app, "--out", out]);
  assertEquals(await Deno.readTextFile(`${out}/manifest.json`), text);
});

Deno.test("build app: defaults the output to the built file's directory, human line", async () => {
  const { app } = await workspace();
  const result = await run(["build", "app", app]);
  assertEquals(result.code, 0, result.stderr);
  const digest = await sha(await Deno.readFile(`${app}/built/app.js`));
  assertEquals(
    result.stdout,
    `built io.w6w.fixture@1.2.3 → ${app}/built (sha256 ${digest.slice(0, 12)})`,
  );
  assert(await exists(`${app}/built/manifest.json`));
  assert(!(await exists(`${app}/built/assets`)));
});

Deno.test("build app: embeds svg and png (any case), leaves http and data URLs alone", async () => {
  const { root, app } = await workspace();
  await Deno.mkdir(`${root}/_shared`);
  await Deno.writeTextFile(`${root}/_shared/logo.SVG`, "<svg/>");
  await editPackage(app, (p) => {
    p.w6w.appearance.icon.sizes["256"] = "../_shared/logo.SVG";
    p.w6w.appearance.icon.sizes["512"] = "https://example.com/i.png";
    p.w6w.appearance.icon.sizes["1024"] = "data:image/gif;base64,R0lGOD";
  });
  const out = `${root}/out`;
  const result = await run(["build", "app", app, "--out", out]);
  assertEquals(result.code, 0, result.stderr);
  const sizes = JSON.parse(await Deno.readTextFile(`${out}/manifest.json`)).app.appearance.icon
    .sizes;
  assertEquals(sizes["256"], dataUri("image/svg+xml", "<svg/>"));
  assertEquals(sizes["64"], dataUri("image/png", "PNG-one"));
  assertEquals(sizes["512"], "https://example.com/i.png");
  assertEquals(sizes["1024"], "data:image/gif;base64,R0lGOD");
});

Deno.test("build app: an unsupported asset extension fails and writes nothing", async () => {
  const { root, app } = await workspace();
  await Deno.writeTextFile(`${app}/assets/icon.bmp`, "BM");
  await editPackage(app, (p) => (p.w6w.appearance.icon.sizes["32"] = "./assets/icon.bmp"));
  const out = `${root}/out`;
  const result = await run(["build", "app", app, "--out", out]);
  assertEquals(result.code, 1);
  assertStringIncludes(result.stderr, ".bmp");
  assert(!(await exists(out)));
});

Deno.test("build app --pack: creates a missing pack", async () => {
  const { root, app } = await workspace();
  const pack = `${root}/w6w-pack.json`;
  const result = await run(["build", "app", app, "--out", `${root}/out`, "--pack", pack, "--json"]);
  assertEquals(result.code, 0, result.stderr);
  const digest = JSON.parse(result.stdout).digest;
  assertEquals(JSON.parse(result.stdout).pack, pack);
  const text = await Deno.readTextFile(pack);
  assert(text.endsWith("\n"));
  assertEquals(JSON.parse(text), {
    apps: [{ id: "io.w6w.fixture", version: "1.2.3", digest }],
  });
});

Deno.test("build app --pack: updates by path, keeping other fields, keys and order", async () => {
  const { root, app } = await workspace();
  const pack = `${root}/w6w-pack.json`;
  await Deno.writeTextFile(
    pack,
    JSON.stringify({
      name: "official",
      apps: [{ path: "./zzz", id: "x" }, { path: "./app/", note: "keep", id: "old" }],
      tail: 1,
    }),
  );
  const result = await run(["build", "app", app, "--pack", pack, "--json"]);
  assertEquals(result.code, 0, result.stderr);
  const digest = JSON.parse(result.stdout).digest;
  const written = JSON.parse(await Deno.readTextFile(pack));
  assertEquals(Object.keys(written), ["name", "apps", "tail"]);
  assertEquals(written.apps, [
    { path: "./zzz", id: "x" },
    { path: "./app/", note: "keep", id: "io.w6w.fixture", version: "1.2.3", digest },
  ]);
});

Deno.test("build app --pack: updates by id when no path matches", async () => {
  const { root, app } = await workspace();
  const pack = `${root}/index.json`;
  await Deno.writeTextFile(
    pack,
    JSON.stringify({ apps: [{ id: "io.w6w.fixture", version: "0.0.1", url: "u" }] }),
  );
  const result = await run(["build", "app", app, "--pack", pack, "--json"]);
  assertEquals(result.code, 0, result.stderr);
  const digest = JSON.parse(result.stdout).digest;
  assertEquals(JSON.parse(await Deno.readTextFile(pack)).apps, [
    { id: "io.w6w.fixture", version: "1.2.3", url: "u", digest },
  ]);
});

Deno.test("build app --pack: appends when nothing matches", async () => {
  const { root, app } = await workspace();
  const pack = `${root}/packs/w6w-pack.json`;
  await Deno.mkdir(`${root}/packs`);
  await Deno.writeTextFile(pack, JSON.stringify({ apps: [{ path: "./other", id: "o" }] }));
  const result = await run(["build", "app", app, "--pack", pack, "--json"]);
  assertEquals(result.code, 0, result.stderr);
  const digest = JSON.parse(result.stdout).digest;
  assertEquals(JSON.parse(await Deno.readTextFile(pack)).apps, [
    { path: "./other", id: "o" },
    { id: "io.w6w.fixture", version: "1.2.3", digest },
  ]);
});

Deno.test("build app --pack: concurrent builds against one pack all land", async () => {
  const { root, app } = await workspace();
  const pack = `${root}/w6w-pack.json`;
  const apps: string[] = [];
  for (let i = 0; i < 8; i++) {
    const copy = `${root}/app-${i}`;
    await copyDir(app, copy);
    await editPackage(copy, (p) => (p.w6w.id = `io.w6w.fixture${i}`));
    apps.push(copy);
  }
  const results = await Promise.all(
    apps.map((dir, i) => run(["build", "app", dir, "--out", `${root}/out-${i}`, "--pack", pack])),
  );
  for (const result of results) assertEquals(result.code, 0, result.stderr);
  const written = JSON.parse(await Deno.readTextFile(pack));
  assertEquals(
    written.apps.map((a: any) => a.id).sort(),
    apps.map((_, i) => `io.w6w.fixture${i}`).sort(),
  );
  assert(!(await exists(`${pack}.lock`)));
  const leftovers = [];
  for await (const entry of Deno.readDir(root)) {
    if (entry.name.endsWith(".tmp")) leftovers.push(entry.name);
  }
  assertEquals(leftovers, []);
});

Deno.test("build app --pack: a stale lock is removed", async () => {
  const { root, app } = await workspace();
  const pack = `${root}/w6w-pack.json`;
  await Deno.writeTextFile(`${pack}.lock`, "");
  const old = new Date(Date.now() - 120_000);
  await Deno.utime(`${pack}.lock`, old, old);
  const result = await run(["build", "app", app, "--pack", pack]);
  assertEquals(result.code, 0, result.stderr);
  assertEquals(JSON.parse(await Deno.readTextFile(pack)).apps.length, 1);
  assert(!(await exists(`${pack}.lock`)));
});
