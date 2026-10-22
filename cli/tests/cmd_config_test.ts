/**
 * `w6w config get-base-url | set-base-url <url>`.
 *
 * Same harness as `cmd_auth_test.ts`: real `main()`, fake environment, in-memory
 * store, fake transport. Nothing touches a disk or a network.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import type { FetchLike } from "@w6w/sdk";
import { main } from "../mod.ts";
import type { ConfigStore, EnvReader } from "../mod.ts";
import { COMMANDS } from "../src/commands/index.ts";

const CLOUD = "https://api.w6w.io";
const HOST_A = "https://a.example";
const HOST_B = "https://b.example";
const TOK_A = "tok_host_a_AAAA1111";
const PATH = "/home/u/.config/w6w/config.json";

function fakeEnv(values: Record<string, string> = {}): EnvReader {
  return (name) => values[name];
}

function memoryStore(initial?: string, path: string | null = PATH) {
  const state = { text: initial, writes: 0 };
  const store: ConfigStore = {
    path: path ?? undefined,
    read: () => Promise.resolve(state.text),
    write: (text) => {
      state.text = text;
      state.writes++;
      return Promise.resolve();
    },
  };
  return { store, state };
}

function file(hosts: Record<string, string>, baseUrl = CLOUD): string {
  const map: Record<string, { token: string }> = {};
  for (const [url, token] of Object.entries(hosts)) map[url] = { token };
  return JSON.stringify({ version: 1, baseUrl, hosts: map });
}

function run(
  argv: string[],
  options: { env?: Record<string, string>; store?: ConfigStore } = {},
) {
  const out: string[] = [];
  const err: string[] = [];
  const calls: { url: string; auth: string | null }[] = [];
  const transport: FetchLike = (url, init) => {
    calls.push({ url, auth: new Headers(init?.headers).get("authorization") });
    return Promise.resolve(
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
    );
  };
  return main(argv, { stdout: (t) => out.push(t), stderr: (t) => err.push(t) }, {
    env: fakeEnv(options.env),
    store: options.store,
    fetch: transport,
    commands: COMMANDS,
  }).then((code) => ({ code, stdout: out.join("\n"), stderr: err.join("\n"), calls }));
}

Deno.test("get-base-url: sources are flag > env > config > default, --json shape exact", async () => {
  const { store } = memoryStore(file({}, HOST_A));
  const flag = await run(["config", "get-base-url", "--base-url", "https://f.example/", "--json"], {
    store,
    env: { W6W_BASE_URL: HOST_B },
  });
  assertEquals(flag.code, 0, flag.stderr);
  assertEquals(JSON.parse(flag.stdout), {
    baseUrl: "https://f.example",
    baseUrlSource: "flag",
    configBaseUrl: HOST_A,
    configPath: PATH,
  });

  const env = await run(["config", "get-base-url", "--json"], {
    store,
    env: { W6W_BASE_URL: `${HOST_B}/` },
  });
  assertEquals(JSON.parse(env.stdout), {
    baseUrl: HOST_B,
    baseUrlSource: "env",
    configBaseUrl: HOST_A,
    configPath: PATH,
  });

  const config = await run(["config", "get-base-url", "--json"], { store });
  assertEquals(JSON.parse(config.stdout).baseUrlSource, "config");
  assertEquals(JSON.parse(config.stdout).baseUrl, HOST_A);

  const none = memoryStore();
  const def = await run(["config", "get-base-url", "--json"], { store: none.store });
  // No stored base URL: `configBaseUrl` is absent, not null.
  assertEquals(JSON.parse(def.stdout), {
    baseUrl: CLOUD,
    baseUrlSource: "default",
    configPath: PATH,
  });

  const text = await run(["config", "get-base-url"], { store });
  assertEquals(text.stdout, `${HOST_A} (config)`);
  assertEquals(config.calls.length + text.calls.length + def.calls.length, 0, "no network");
});

Deno.test("set-base-url: stores the canonical URL, leaves hosts untouched", async () => {
  const initial = file({ [HOST_A]: TOK_A }, CLOUD);
  const { store, state } = memoryStore(initial);
  const result = await run(["config", "set-base-url", "https://x.example/"], { store });
  assertEquals(result.code, 0, result.stderr);
  assertEquals(JSON.parse(state.text!), {
    version: 1,
    baseUrl: "https://x.example",
    hosts: { [HOST_A]: { token: TOK_A } },
  });
  assert(!(result.stdout + result.stderr).includes(TOK_A), "a token was printed");
  assertEquals(result.calls.length, 0);
});

Deno.test("set-base-url: notes when W6W_BASE_URL differs, and not when it matches", async () => {
  const differs = memoryStore();
  const a = await run(["config", "set-base-url", HOST_B, "--json"], {
    store: differs.store,
    env: { W6W_BASE_URL: HOST_A },
  });
  assertEquals(a.code, 0, a.stderr);
  assertStringIncludes(a.stderr, "W6W_BASE_URL");
  assertStringIncludes(a.stderr, HOST_A);
  JSON.parse(a.stdout); // --json stdout stays one document

  const same = memoryStore();
  const b = await run(["config", "set-base-url", `${HOST_A}/`], {
    store: same.store,
    env: { W6W_BASE_URL: HOST_A },
  });
  assertEquals(b.stderr, "");
});

Deno.test("set-base-url: blank, relative and non-http(s) are exit 1 and write nothing", async () => {
  for (const bad of ["", "   ", "/api", "localhost:8080", "ftp://x.example", "not a url"]) {
    const initial = file({ [HOST_A]: TOK_A });
    const { store, state } = memoryStore(initial);
    const result = await run(["config", "set-base-url", bad], { store });
    assertEquals(result.code, 1, `${JSON.stringify(bad)}: ${result.stderr}`);
    assertEquals(state.writes, 0);
    assertEquals(state.text, initial);
  }
  const missing = await run(["config", "set-base-url"], { store: memoryStore().store });
  assertEquals(missing.code, 1);
});

Deno.test("set-base-url: no config directory is a usage error", async () => {
  const { store, state } = memoryStore(undefined, null);
  const result = await run(["config", "set-base-url", HOST_B], { store });
  assertEquals(result.code, 1);
  assertEquals(state.writes, 0);
});

Deno.test("binding: after set-base-url B, host A's token is never sent to B", async () => {
  const { store, state } = memoryStore(file({ [HOST_A]: TOK_A }, HOST_A));
  const set = await run(["config", "set-base-url", HOST_B], { store });
  assertEquals(set.code, 0, set.stderr);
  const result = await run(["me"], { store });
  assertEquals(result.code, 1);
  assertStringIncludes(result.stderr, `No w6w API token is configured for ${HOST_B}`);
  assertEquals(result.calls.length, 0, "no request may carry host A's token");
  assert(JSON.parse(state.text!).hosts[HOST_A].token === TOK_A);
});
