/**
 * `w6w apps publish [dir] [--version <semver>] [--builder <spec>]`.
 *
 * The app builder is never started: the Deno spawn is replaced
 * ({@linkcode useToolchainRunner}) by a fake that writes the canonical artifact tree.
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
import { useToolchainRunner } from "../src/app-toolchain.ts";

const BEARER = "t_secret_bearer_value";
const ID = "io.w6w.demo";
const BUILT = "0.1.0";
// Every byte value, so a text round-trip would corrupt it.
const EXEC = Uint8Array.from({ length: 256 }, (_, i) => i);
const EXEC_B64 = btoa(String.fromCharCode(...EXEC));
const MANIFEST = { id: ID, version: BUILT, name: "Demo" };

async function appDir(
  pkg: string | undefined = '{\n    "name": "demo",\n    "version": "0.0.1"\n}\n',
) {
  const dir = await Deno.makeTempDir({ prefix: "w6w-publish-app-" });
  if (pkg !== undefined) await Deno.writeTextFile(`${dir}/package.json`, pkg);
  await Deno.writeTextFile(`${dir}/index.ts`, "export default {};\n");
  return dir;
}

function outOf(argv: string[]): string {
  return argv[argv.indexOf("-o") + 1];
}

async function fabricate(argv: string[], withMap: boolean): Promise<void> {
  const out = outOf(argv);
  const at = `${out}/${ID}/${BUILT}`;
  await Deno.mkdir(at, { recursive: true });
  await Deno.writeTextFile(`${at}/manifest.json`, JSON.stringify(MANIFEST));
  await Deno.writeFile(`${at}/app.js`, EXEC);
  if (withMap) await Deno.writeTextFile(`${at}/app.js.map`, "{}");
  await Deno.writeTextFile(
    `${out}/index.json`,
    JSON.stringify({ apps: [{ id: ID, version: BUILT }] }),
  );
}

interface Seen {
  runs: string[][];
  outs: string[];
  requests: { url: string; method: string; auth: string | null; body: string }[];
  /** `package.json`'s `version` as it was when the runner was invoked. */
  pkgAtBuild: string[];
}

async function publish(
  invoked: { positionals?: string[]; options?: Record<string, string> },
  opts: {
    build?: { code: number; stderr?: string };
    reply?: () => Response;
    map?: boolean;
  } = {},
) {
  const seen: Seen = { runs: [], outs: [], requests: [], pkgAtBuild: [] };
  const dir = invoked.positionals?.[0];
  const restore = useToolchainRunner(async (argv, cwd) => {
    seen.runs.push(argv);
    try {
      seen.pkgAtBuild.push(JSON.parse(await Deno.readTextFile(`${cwd}/package.json`)).version);
    } catch { /* no package.json */ }
    if (opts.build && opts.build.code !== 0) {
      seen.outs.push(outOf(argv));
      return { code: opts.build.code, stdout: "", stderr: opts.build.stderr ?? "" };
    }
    seen.outs.push(outOf(argv));
    await fabricate(argv, opts.map === true);
    return { code: 0, stdout: "", stderr: "" };
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
      naming: "w6w apps publish [dir] [--version <semver>] [--builder <spec>]",
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

Deno.test("apps publish: a build failure uploads nothing and removes the temp dir", async () => {
  const r = await publish({ positionals: [await appDir()] }, {
    build: { code: 1, stderr: "refused: bad manifest" },
  });
  assertStringIncludes((r.error as Error).message, "refused: bad manifest");
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
  const runs: string[][] = [];
  const requests: { url: string; body: string }[] = [];
  const restore = useToolchainRunner(async (args) => {
    runs.push(args);
    await fabricate(args, false);
    return { code: 0, stdout: "", stderr: "" };
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
    const out = outOf(ran.runs[0]);
    assert(await gone(out), "temp dir gone");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test('main(): `--version "1.2.3\\n"` is a usage error before package.json or the builder', async () => {
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
