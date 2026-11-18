/**
 * `w6w apps publish [dir] [--version <semver>]`.
 *
 * The vendored assembler is never loaded: it is replaced ({@linkcode useAssembler}) by a
 * fake that writes the canonical artifact tree.
 * The upload goes through the real SDK against a fake `fetch`, so what is asserted is
 * the request on the wire. Most cases drive the handler directly; the `main()` cases at the
 * end prove the real command line parses `--version <semver>` as a string for this command.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { ApiError, W6WClient } from "@w6w/sdk";
import type { FetchLike } from "@w6w/sdk";
import type { CliIo, CommandContext, EnvReader, Invocation } from "../mod.ts";
import { createOutput, main, NO_CONFIG, NO_ENV, NO_STDIN, NO_STORE } from "../mod.ts";
import { COMMANDS } from "../src/commands/index.ts";
import { type BuildResult, useAssembler } from "../src/app-toolchain.ts";

const BEARER = "t_secret_bearer_value";
const ID = "io.w6w.demo";
const BUILT = "0.1.0";
// Every byte value, so a text round-trip would corrupt it.
const EXEC = Uint8Array.from({ length: 256 }, (_, i) => i);
const EXEC_B64 = btoa(String.fromCharCode(...EXEC));
const MANIFEST = { id: ID, version: BUILT, name: "Demo" };

const madeDirs: string[] = [];
// Fixtures live under the OS temp dir; remove every one when the test process ends.
globalThis.addEventListener("unload", () => {
  for (const dir of madeDirs) {
    try {
      Deno.removeSync(dir, { recursive: true });
    } catch { /* already gone */ }
  }
});

async function appDir(
  pkg: string | undefined = '{\n    "name": "demo",\n    "version": "0.0.1"\n}\n',
) {
  const dir = await Deno.makeTempDir({ prefix: "w6w-publish-app-" });
  madeDirs.push(dir);
  if (pkg !== undefined) await Deno.writeTextFile(`${dir}/package.json`, pkg);
  await Deno.writeTextFile(`${dir}/index.ts`, "export default {};\n");
  return dir;
}

async function fabricate(out: string, withMap: boolean): Promise<BuildResult> {
  const at = `${out}/${ID}/${BUILT}`;
  await Deno.mkdir(at, { recursive: true });
  await Deno.writeTextFile(`${at}/manifest.json`, JSON.stringify(MANIFEST));
  await Deno.writeFile(`${at}/app.js`, EXEC);
  if (withMap) await Deno.writeTextFile(`${at}/app.js.map`, "{}");
  return {
    id: ID,
    version: BUILT,
    execSha256: "a".repeat(64),
    digest: "b".repeat(64),
    digestVersion: 2,
    sourceDigest: "c".repeat(64),
    outDir: at,
  };
}

/** An assembler whose `assembleApp` is `fn`; validating alone is never what publish does. */
function assemblerOf(fn: (dir: string, out: string) => Promise<BuildResult>) {
  return useAssembler({
    assembleApp: fn,
    validateAssembled: () => Promise.reject(new Error("publish never only validates")),
  });
}

interface Seen {
  /** The app directory of every packaging run. */
  runs: string[];
  outs: string[];
  requests: { url: string; method: string; auth: string | null; body: string }[];
  /** `package.json`'s `version` as it was when the runner was invoked. */
  pkgAtBuild: string[];
}

async function publish(
  invoked: { positionals?: string[]; options?: Record<string, string> },
  opts: {
    build?: { code: string; message: string };
    reply?: () => Response;
    map?: boolean;
  } = {},
) {
  const seen: Seen = { runs: [], outs: [], requests: [], pkgAtBuild: [] };
  const dir = invoked.positionals?.[0];
  const restore = assemblerOf(async (appDir, out) => {
    seen.runs.push(appDir);
    seen.outs.push(out);
    try {
      seen.pkgAtBuild.push(JSON.parse(await Deno.readTextFile(`${appDir}/package.json`)).version);
    } catch { /* no package.json */ }
    if (opts.build) {
      throw Object.assign(new Error(opts.build.message), { code: opts.build.code });
    }
    return await fabricate(out, opts.map === true);
  });
  const fetch: FetchLike = (url, init) => {
    const headers = new Headers(init?.headers as HeadersInit);
    seen.requests.push({
      url,
      method: init?.method ?? "GET",
      auth: headers.get("authorization"),
      body: typeof init?.body === "string" ? init.body : "",
    });
    return Promise.resolve(
      (opts.reply ??
        (() =>
          json(200, { id: ID, version: "9.9.9", outcome: "registered", target: "personal" })))(),
    );
  };
  const stdout: string[] = [];
  const stderr: string[] = [];
  const io: CliIo = { stdout: (t) => stdout.push(t), stderr: (t) => stderr.push(t) };
  const invocation: Invocation = {
    command: ["apps", "publish"],
    positionals: invoked.positionals ?? [],
    globals: { json: true, noColor: true, version: false, help: false },
    options: invoked.options ?? {},
  };
  const context = {
    command: {
      operation: "apps.publish",
      path: ["apps", "publish"],
      name: "apps publish",
      aliases: [],
      summary: "",
      short: "",
      headline: "",
      usage: "",
      naming: "w6w apps publish [dir] [--version <semver>]",
      status: "live",
      params: [],
      examples: [],
      notes: [],
    },
    invocation,
    out: createOutput(io, { json: true, noColor: true }),
    client: () => new W6WClient({ baseUrl: "https://api.example.test", token: BEARER, fetch }),
    env: NO_ENV,
    stored: NO_CONFIG,
    store: NO_STORE,
    stdin: NO_STDIN,
  } as CommandContext;
  let error: unknown;
  let code: number | void = undefined;
  try {
    code = await COMMANDS["apps publish"](context);
  } catch (e) {
    error = e;
  } finally {
    restore();
  }
  return { seen, dir, code, error, stdout: stdout.join("\n"), stderr: stderr.join("\n") };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function gone(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return false;
  } catch {
    return true;
  }
}

Deno.test("apps publish: uploads the built bytes and prints the SERVER's version", async () => {
  const dir = await appDir();
  const r = await publish({ positionals: [dir] }, { map: true });
  assertEquals(r.error, undefined);
  assertEquals(r.seen.runs.length, 1);
  assertEquals(r.seen.requests.length, 1);
  const req = r.seen.requests[0];
  assertEquals(req.method, "POST");
  assertStringIncludes(req.url, "/app-management/artifacts");
  const body = JSON.parse(req.body);
  assertEquals(body, { artifact: MANIFEST, exec: EXEC_B64, map: btoa("{}") });
  // The printed version is the response's, not the built 0.1.0.
  assertEquals(JSON.parse(r.stdout), {
    id: ID,
    version: "9.9.9",
    outcome: "registered",
    target: "personal",
  });
  assert(await gone(r.seen.outs[0]), "temp dir removed on success");
});

Deno.test("apps publish: no map file → no `map` key", async () => {
  const r = await publish({ positionals: [await appDir()] });
  assertEquals(Object.keys(JSON.parse(r.seen.requests[0].body)), ["artifact", "exec"]);
});

Deno.test("apps publish --version: package.json rewritten BEFORE the runner runs", async () => {
  const dir = await appDir();
  const r = await publish({ positionals: [dir], options: { version: "1.2.3" } });
  assertEquals(r.error, undefined);
  assertEquals(r.seen.pkgAtBuild, ["1.2.3"]);
  const text = await Deno.readTextFile(`${dir}/package.json`);
  assertEquals(JSON.parse(text).version, "1.2.3");
  assertStringIncludes(text, '    "name": "demo"'); // indentation kept
});

Deno.test("apps publish: no --version leaves package.json untouched", async () => {
  const dir = await appDir();
  const before = await Deno.readTextFile(`${dir}/package.json`);
  await publish({ positionals: [dir] });
  assertEquals(await Deno.readTextFile(`${dir}/package.json`), before);
});

Deno.test("apps publish --version nope: usage error, nothing built or sent", async () => {
  for (const bad of ["nope", "1.2", "01.2.3", "1.2.3.4", "v1.2.3", ""]) {
    const dir = await appDir();
    const before = await Deno.readTextFile(`${dir}/package.json`);
    const r = await publish({ positionals: [dir], options: { version: bad } });
    assert(r.error instanceof Error && !(r.error instanceof ApiError), bad);
    assertStringIncludes((r.error as Error).message, "Usage: w6w apps publish");
    assertEquals(r.seen.runs.length, 0, bad);
    assertEquals(r.seen.requests.length, 0, bad);
    assertEquals(await Deno.readTextFile(`${dir}/package.json`), before);
  }
});

Deno.test("apps publish: a packaging refusal uploads nothing and removes the temp dir", async () => {
  const r = await publish({ positionals: [await appDir()] }, {
    build: { code: "entry_missing", message: "`dist/app.js` does not exist" },
  });
  assertStringIncludes((r.error as Error).message, "entry_missing: `dist/app.js` does not exist");
  assertEquals(r.seen.requests.length, 0);
  assert(await gone(r.seen.outs[0]));
});

Deno.test("apps publish: an upload refusal is `code: message`, leaks nothing, cleans up", async () => {
  const r = await publish({ positionals: [await appDir()] }, {
    map: true,
    reply: () => json(409, { error: { code: "id_taken", message: "that id belongs to another" } }),
  });
  assert(r.error instanceof ApiError);
  assertStringIncludes((r.error as ApiError).message, "id_taken: ");
  assertEquals((r.error as ApiError).code, "id_taken");
  assertEquals((r.error as ApiError).raw, null);
  assert(await gone(r.seen.outs[0]));
  const everything = `${r.stdout}\n${r.stderr}\n${(r.error as Error).message}\n${
    (r.error as Error).stack
  }`;
  assert(!everything.includes(BEARER), "bearer absent");
  assert(!everything.includes(EXEC_B64), "base64 exec absent");
});

Deno.test("apps publish: takes no credential flag or extra positional", async () => {
  const dir = await appDir();
  const extra = await publish({ positionals: [dir, "x"] });
  assertStringIncludes((extra.error as Error).message, "extra one");
  assertEquals(extra.seen.requests.length, 0);
  const src = await Deno.readTextFile(new URL("../src/commands/publish.ts", import.meta.url));
  assert(!/textFlag\(context, "(token|auth|credential|bearer)/i.test(src));
});

// --- the real command line (`main()`): `--version` is a string flag here only -------------

async function viaMain(argv: string[], dir: string, reply?: () => Response) {
  /** The output root of every packaging run. */
  const runs: string[] = [];
  const requests: { url: string; body: string }[] = [];
  const restore = assemblerOf(async (_appDir, out) => {
    runs.push(out);
    return await fabricate(out, false);
  });
  const fetch: FetchLike = (url, init) => {
    requests.push({ url, body: typeof init?.body === "string" ? init.body : "" });
    return Promise.resolve(
      reply?.() ??
        json(200, { id: ID, version: "9.9.9", outcome: "registered", target: "personal" }),
    );
  };
  const env: EnvReader = (name) =>
    ({ W6W_BASE_URL: "https://api.example.test", W6W_TOKEN: BEARER } as Record<string, string>)[
      name
    ];
  const stdout: string[] = [];
  const stderr: string[] = [];
  try {
    const code = await main([...argv, dir], {
      stdout: (t) => stdout.push(t),
      stderr: (t) => stderr.push(t),
    }, { env, fetch, commands: COMMANDS });
    return { code, runs, requests, stdout: stdout.join("\n"), stderr: stderr.join("\n") };
  } finally {
    restore();
  }
}

Deno.test("main(): `apps publish --version 1.2.3` rewrites package.json, builds and uploads", async () => {
  const dir = await appDir();
  try {
    const ran = await viaMain(["apps", "publish", "--version", "1.2.3", "--json"], dir);
    assertEquals(ran.code, 0, ran.stderr);
    assertEquals(JSON.parse(await Deno.readTextFile(`${dir}/package.json`)).version, "1.2.3");
    assertEquals(ran.runs.length, 1);
    assertEquals(ran.requests.length, 1);
    assert(!ran.stdout.includes("wrapper:"), "must not print the version banner");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("main(): `apps publish --version nope` is a usage error, nothing built or sent", async () => {
  const dir = await appDir();
  try {
    const ran = await viaMain(["apps", "publish", "--version", "nope"], dir);
    assertEquals(ran.code, 1);
    assertEquals(ran.runs.length, 0);
    assertEquals(ran.requests.length, 0);
    assertEquals(JSON.parse(await Deno.readTextFile(`${dir}/package.json`)).version, "0.0.1");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("main(): plain `--version` is still the banner, not a publish flag", async () => {
  const ran = await viaMain(["--version", "--json"], ".");
  assertEquals(ran.code, 0, ran.stderr);
  assertEquals(ran.runs.length, 0);
  assertEquals(ran.requests.length <= 1, true);
});

Deno.test("main(): an upload refusal (409 id_taken) exits nonzero and leaks nothing", async () => {
  const dir = await appDir();
  try {
    const ran = await viaMain(
      ["apps", "publish"],
      dir,
      () => json(409, { error: { code: "id_taken", message: "that id belongs to another" } }),
    );
    assert(ran.code !== 0, "nonzero exit");
    assertEquals(ran.requests.length, 1);
    const all = `${ran.stdout}\n${ran.stderr}`;
    assertStringIncludes(all, "id_taken");
    assert(!all.includes(BEARER), "bearer absent");
    assert(!all.includes(EXEC_B64), "base64 exec absent");
    assert(await gone(ran.runs[0]), "temp dir gone");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test('main(): `--version "1.2.3\\n"` is a usage error before package.json or packaging', async () => {
  const dir = await appDir();
  try {
    const ran = await viaMain(["apps", "publish", "--version", "1.2.3\n"], dir);
    assertEquals(ran.code, 1);
    assertEquals(ran.runs.length, 0);
    assertEquals(ran.requests.length, 0);
    assertEquals(JSON.parse(await Deno.readTextFile(`${dir}/package.json`)).version, "0.0.1");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("main(): `apps publish --builder` is an unknown flag now; nothing packaged or sent", async () => {
  const dir = await appDir();
  try {
    const ran = await viaMain(
      ["apps", "publish", "--builder", "jsr:@w6w/app-build@0.2.0/cli"],
      dir,
    );
    assertEquals(ran.code, 1);
    assertStringIncludes(ran.stderr, "--builder");
    assertEquals(ran.runs.length, 0);
    assertEquals(ran.requests.length, 0);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// --- 403 namespace_not_owned: the pinned refusal envelope (multiple prefixes / none) ------

const NOT_OWNED = {
  multiple: "io.w6w.demo is not under a prefix you own; your active prefixes are acme. and beta.",
  none: "you own no namespace prefix; ask an operator to assign one to your tenant",
};

function notOwned(message: string): () => Response {
  return () => json(403, { error: { code: "namespace_not_owned", message } });
}

function assertClean(everything: string) {
  assert(!everything.includes(BEARER), "bearer absent");
  assert(!everything.includes(EXEC_B64), "base64 exec absent");
  assert(!everything.includes('"raw"'), "raw envelope absent");
  assert(!everything.includes("app.js.map"), "map absent");
}

for (const [label, message] of Object.entries(NOT_OWNED)) {
  Deno.test(`apps publish: 403 namespace_not_owned (${label}) keeps code and message`, async () => {
    const r = await publish({ positionals: [await appDir()] }, {
      map: true,
      reply: notOwned(message),
    });
    assert(r.error instanceof ApiError);
    const e = r.error as ApiError;
    assertEquals(e.code, "namespace_not_owned");
    assertEquals(e.status, 403);
    assertEquals(e.raw, null);
    assertStringIncludes(e.message, `namespace_not_owned: ${message}`);
    assertEquals(r.code, undefined, "no success return");
    assertEquals(r.stdout, "", "no success output");
    assertEquals(r.seen.requests.length, 1, "no second request");
    assert(await gone(r.seen.outs[0]), "temp dir gone");
    assertClean(`${r.stdout}\n${r.stderr}\n${e.message}\n${e.stack}`);
  });

  Deno.test(`main(): 403 namespace_not_owned (${label}) exits nonzero with the message`, async () => {
    const dir = await appDir();
    try {
      const ran = await viaMain(["apps", "publish"], dir, notOwned(message));
      assert(ran.code !== 0, "nonzero exit");
      assertEquals(ran.requests.length, 1);
      const all = `${ran.stdout}\n${ran.stderr}`;
      assertStringIncludes(all, "namespace_not_owned");
      assertStringIncludes(all, message);
      assert(!ran.stdout.includes("registered"), "no success output");
      assertClean(all);
      assert(await gone(ran.runs[0]), "temp dir gone");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });
}
