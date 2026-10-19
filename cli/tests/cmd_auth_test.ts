/**
 * `w6w auth login | logout | status`, and the stored-token binding they feed.
 *
 * Real `main()`, a fake environment, an **in-memory store** and a fake
 * transport — nothing here touches a disk, a terminal or a network. (The real
 * file adapter is covered in `config_store_test.ts`, in a temp dir.)
 *
 * The rule under test is the trust boundary: a stored token is looked up by the
 * canonical resolved base URL and nothing else, so an override to another host
 * sends nothing at all.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import type { FetchLike } from "@w6w/sdk";
import { main } from "../mod.ts";
import type { ConfigStore, EnvReader, StdinSource } from "../mod.ts";
import { COMMANDS } from "../src/commands/index.ts";

const CLOUD = "https://api.w6w.io";
const LOCAL = "http://127.0.0.1:9999";
const CLOUD_TOK = "tokcloud_AAAA1111";
const LOCAL_TOK = "toklocal_BBBB2222";
const PATH = "/home/u/.config/w6w/config.json";

function fakeEnv(values: Record<string, string> = {}): EnvReader {
  return (name) => values[name];
}

/** An in-memory store that records every write. */
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

function stdinOf(text: string, terminal = false): StdinSource & { reads: number } {
  const source = {
    reads: 0,
    isTerminal: () => terminal,
    read: () => {
      source.reads++;
      return Promise.resolve(text);
    },
  };
  return source;
}

function run(
  argv: string[],
  options: {
    env?: Record<string, string>;
    store?: ConfigStore;
    stdin?: StdinSource;
    fetch?: FetchLike;
  } = {},
) {
  const out: string[] = [];
  const err: string[] = [];
  const calls: { url: string; auth: string | null }[] = [];
  const transport: FetchLike = options.fetch ?? ((url, init) => {
    calls.push({ url, auth: new Headers(init?.headers).get("authorization") });
    return Promise.resolve(
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
    );
  });
  return main(argv, { stdout: (t) => out.push(t), stderr: (t) => err.push(t) }, {
    env: fakeEnv(options.env),
    store: options.store,
    stdin: options.stdin,
    fetch: transport,
    commands: COMMANDS,
  }).then((code) => ({ code, stdout: out.join("\n"), stderr: err.join("\n"), calls }));
}

function stored(state: { text?: string }) {
  return JSON.parse(state.text ?? "null");
}

Deno.test("auth login <token>: stores the token for the default host, in the pinned shape", async () => {
  const { store, state } = memoryStore();
  const result = await run(["auth", "login", CLOUD_TOK], { store });
  assertEquals(result.code, 0, result.stderr);
  assertEquals(stored(state), {
    version: 1,
    baseUrl: CLOUD,
    hosts: { [CLOUD]: { token: CLOUD_TOK } },
  });
  assert(!(result.stdout + result.stderr).includes(CLOUD_TOK), "the token was echoed");
  assertEquals(result.calls.length, 0, "login must not use the network");
});

Deno.test("auth login: a second host is keyed by the canonical URL and keeps the first", async () => {
  const { store, state } = memoryStore(file({ [CLOUD]: CLOUD_TOK }));
  const result = await run(["auth", "login", LOCAL_TOK, "--base-url", `${LOCAL}/`], { store });
  assertEquals(result.code, 0, result.stderr);
  const config = stored(state);
  assertEquals(config.baseUrl, LOCAL);
  assertEquals(config.hosts, { [CLOUD]: { token: CLOUD_TOK }, [LOCAL]: { token: LOCAL_TOK } });
});

Deno.test("auth login -: reads stdin and strips exactly one trailing newline", async () => {
  for (
    const [input, want] of [["tok_x\n", "tok_x"], ["tok_x\r\n", "tok_x"], ["tok_x\n\n", "tok_x\n"]]
  ) {
    const { store, state } = memoryStore();
    const result = await run(["auth", "login", "-"], { store, stdin: stdinOf(input, true) });
    // The sole rejection is the doubled newline: a control character survives the strip.
    if (want.includes("\n")) {
      assertEquals(result.code, 1);
      assertEquals(state.writes, 0);
    } else {
      assertEquals(result.code, 0, result.stderr);
      assertEquals(stored(state).hosts[CLOUD].token, want);
    }
  }
});

Deno.test("auth login with no argument reads piped stdin, but never a terminal", async () => {
  const piped = memoryStore();
  const ok = await run(["auth", "login"], { store: piped.store, stdin: stdinOf("tok_piped\n") });
  assertEquals(ok.code, 0, ok.stderr);
  assertEquals(stored(piped.state).hosts[CLOUD].token, "tok_piped");

  const tty = memoryStore();
  const terminal = stdinOf("never read", true);
  const bad = await run(["auth", "login"], { store: tty.store, stdin: terminal });
  assertEquals(bad.code, 1);
  assertEquals(terminal.reads, 0, "a terminal stdin must never be read (it would hang)");
  assertEquals(tty.state.writes, 0);
  assertStringIncludes(bad.stderr, "auth login");
});

Deno.test("auth login: ignores the global --token and W6W_TOKEN, and never stores them", async () => {
  const { store, state } = memoryStore();
  const result = await run(["--token", "flagtok_EEEE5555", "auth", "login", CLOUD_TOK], {
    store,
    env: { W6W_TOKEN: "envtok_DDDD4444" },
  });
  assertEquals(result.code, 0, result.stderr);
  assertEquals(stored(state).hosts[CLOUD].token, CLOUD_TOK);
  assert(!state.text!.includes("flagtok") && !state.text!.includes("envtok"));
});

Deno.test("auth login: empty or unsendable tokens exit 1 and leave the store untouched", async () => {
  for (const token of ["", "   ", "bad\u0001tok"]) {
    const { store, state } = memoryStore(file({ [CLOUD]: CLOUD_TOK }));
    const before = state.text;
    const result = await run(["auth", "login", token], { store });
    assertEquals(result.code, 1, JSON.stringify(token));
    assertEquals(state.text, before);
    assertEquals(state.writes, 0);
  }
});

Deno.test("auth login: nowhere to store is a usage error", async () => {
  const { store } = memoryStore(undefined, null);
  const result = await run(["auth", "login", CLOUD_TOK], { store });
  assertEquals(result.code, 1);
  assertStringIncludes(result.stderr, "XDG_CONFIG_HOME");
});

Deno.test("auth logout: removes only the resolved host, keeps the rest; idempotent", async () => {
  const { store, state } = memoryStore(file({ [CLOUD]: CLOUD_TOK, [LOCAL]: LOCAL_TOK }, LOCAL));
  const first = await run(["auth", "logout"], { store });
  assertEquals(first.code, 0, first.stderr);
  const config = stored(state);
  assertEquals(config.hosts, { [CLOUD]: { token: CLOUD_TOK } });
  assertEquals(config.baseUrl, LOCAL, "logout keeps the current baseUrl");

  const writes = state.writes;
  const again = await run(["auth", "logout"], { store });
  assertEquals(again.code, 0);
  assertEquals(state.writes, writes, "nothing to remove means no write");
});

Deno.test("auth logout never creates a file", async () => {
  const { store, state } = memoryStore();
  const result = await run(["auth", "logout"], { store });
  assertEquals(result.code, 0);
  assertEquals(state.writes, 0);
  assertEquals(state.text, undefined);
});

Deno.test("auth status: logged out is exit 0 with the default URL and no token", async () => {
  const { store } = memoryStore();
  const result = await run(["auth", "status", "--json"], { store });
  assertEquals(result.code, 0, result.stderr);
  assertEquals(JSON.parse(result.stdout), {
    baseUrl: CLOUD,
    baseUrlSource: "default",
    tokenSource: null,
    tokenMasked: null,
    configPath: PATH,
  });
});

Deno.test("auth status: masks the token (last 4 when >= 12 chars) and never prints it", async () => {
  const { store } = memoryStore(file({ [CLOUD]: CLOUD_TOK }));
  const json = await run(["auth", "status", "--json"], { store });
  const parsed = JSON.parse(json.stdout);
  assertEquals(
    [parsed.baseUrlSource, parsed.tokenSource, parsed.tokenMasked],
    ["config", "config", "****1111"],
  );
  const human = await run(["auth", "status"], { store });
  assertEquals(human.code, 0);
  assertStringIncludes(human.stdout, "****1111");
  for (const text of [json.stdout, json.stderr, human.stdout, human.stderr]) {
    assert(!text.includes(CLOUD_TOK), "status printed the raw token");
  }

  const short = memoryStore(file({ [CLOUD]: "short" }));
  const masked = JSON.parse(
    (await run(["auth", "status", "--json"], { store: short.store })).stdout,
  );
  assertEquals(masked.tokenMasked, "****");
});

Deno.test("auth status: sources are flag > env > config > default", async () => {
  const { store } = memoryStore(file({ [LOCAL]: LOCAL_TOK }, LOCAL));
  const env = JSON.parse(
    (await run(["auth", "status", "--json"], {
      store,
      env: { W6W_BASE_URL: CLOUD, W6W_TOKEN: "envtok_DDDD4444" },
    })).stdout,
  );
  assertEquals([env.baseUrl, env.baseUrlSource, env.tokenSource], [CLOUD, "env", "env"]);
  const flag = JSON.parse(
    (await run(
      ["--base-url", LOCAL, "--token", "flagtok_EEEE5555", "auth", "status", "--json"],
      { store, env: { W6W_BASE_URL: CLOUD, W6W_TOKEN: "envtok_DDDD4444" } },
    )).stdout,
  );
  assertEquals([flag.baseUrl, flag.baseUrlSource, flag.tokenSource], [LOCAL, "flag", "flag"]);
  // A blank env var is absent: falls through to the stored URL.
  const blank = JSON.parse(
    (await run(["auth", "status", "--json"], {
      store,
      env: { W6W_BASE_URL: "  " },
    })).stdout,
  );
  assertEquals([blank.baseUrl, blank.baseUrlSource], [LOCAL, "config"]);
});

Deno.test("binding: a stored token reaches only its own canonical host", async () => {
  const { store } = memoryStore(file({ [CLOUD]: CLOUD_TOK, [LOCAL]: LOCAL_TOK }, LOCAL));

  // Stored current host + its own token.
  const own = await run(["me"], { store });
  assertEquals(own.code, 0, own.stderr);
  assertEquals(own.calls, [{ url: `${LOCAL}/auth/me`, auth: `Bearer ${LOCAL_TOK}` }]);

  // The slash variant shares the key.
  const slash = await run(["--base-url", `${LOCAL}/`, "me"], { store });
  assertEquals(slash.calls, [{ url: `${LOCAL}/auth/me`, auth: `Bearer ${LOCAL_TOK}` }]);

  // Another host: zero requests, exit 1, names `auth login`.
  const other = memoryStore(file({ [CLOUD]: CLOUD_TOK }, CLOUD));
  for (
    const argv of [["--base-url", LOCAL, "me"], ["me"]]
  ) {
    const result = await run(argv, {
      store: other.store,
      env: argv.length === 1 ? { W6W_BASE_URL: LOCAL } : {},
    });
    assertEquals(result.code, 1);
    assertEquals(result.calls.length, 0, "the cloud token must not be sent to another host");
    assertStringIncludes(result.stderr, "auth login");
    assert(!result.stderr.includes(CLOUD_TOK));
  }
});

Deno.test("binding: env token beats stored, flag beats env", async () => {
  const { store } = memoryStore(file({ [CLOUD]: CLOUD_TOK }));
  const env = await run(["me"], { store, env: { W6W_TOKEN: "envtok_DDDD4444" } });
  assertEquals(env.calls[0].auth, "Bearer envtok_DDDD4444");
  const flag = await run(["--token", "flagtok_EEEE5555", "me"], {
    store,
    env: { W6W_TOKEN: "envtok_DDDD4444" },
  });
  assertEquals(flag.calls[0].auth, "Bearer flagtok_EEEE5555");
  assertEquals(env.calls.concat(flag.calls).filter((c) => c.auth?.includes(CLOUD_TOK)).length, 0);
});

Deno.test("a malformed config fails every dispatched command, naming the path, never echoing it", async () => {
  const secret = "SECRETVALUE_ZZZZ9999";
  const text =
    `{"version":1,"baseUrl":"${CLOUD}","hosts":{"${CLOUD}":{"token":"${secret}"}},"junk":`;
  for (
    const argv of [["auth", "status"], ["auth", "login", CLOUD_TOK], ["auth", "logout"], ["me"]]
  ) {
    const { store, state } = memoryStore(text);
    const result = await run(argv, { store, env: { W6W_TOKEN: "t" } });
    assertEquals(result.code, 1, argv.join(" "));
    assertStringIncludes(result.stderr, PATH);
    assert(!(result.stdout + result.stderr).includes(secret), "file content was echoed");
    assertEquals(state.text, text, "a malformed file must be left exactly as found");
    assertEquals(result.calls.length, 0);
  }
});

Deno.test("help and --version never read the store", async () => {
  const store: ConfigStore = {
    path: PATH,
    read: () => Promise.reject(new Error("the store was read")),
    write: () => Promise.reject(new Error("the store was written")),
  };
  for (const argv of [["--help"], ["auth", "--help"], ["auth", "login", "--help"], ["--version"]]) {
    const result = await run(argv, { store });
    assertEquals(result.code, 0, `${argv.join(" ")}: ${result.stderr}`);
  }
});

Deno.test("binding: the stored key matches exactly - no prefix, scheme, port or case variants", async () => {
  const { store } = memoryStore(file({ [CLOUD]: CLOUD_TOK }));
  const variants = [
    "http://api.w6w.io",
    "https://api.w6w.io.example.com",
    "https://api.w6w.io:8443",
    "https://API.W6W.IO",
    "https://api.w6w.io/v1",
  ];
  for (const url of variants) {
    for (const via of ["flag", "env"]) {
      const result = via === "flag"
        ? await run(["--base-url", url, "me"], { store })
        : await run(["me"], { store, env: { W6W_BASE_URL: url } });
      assertEquals(result.calls.length, 0, `${via} ${url}: the token must not be sent`);
      assertEquals(result.code, 1, `${via} ${url}`);
    }
  }
});

Deno.test("auth login/logout honour W6W_BASE_URL for the host key", async () => {
  const login = memoryStore();
  const ok = await run(["auth", "login", LOCAL_TOK], {
    store: login.store,
    env: { W6W_BASE_URL: `${LOCAL}/` },
  });
  assertEquals(ok.code, 0, ok.stderr);
  const config = stored(login.state);
  assertEquals(config.hosts, { [LOCAL]: { token: LOCAL_TOK } });
  assert(!(CLOUD in config.hosts), "the token was saved under the cloud key");

  const out = memoryStore(file({ [CLOUD]: CLOUD_TOK, [LOCAL]: LOCAL_TOK }));
  const result = await run(["auth", "logout"], {
    store: out.store,
    env: { W6W_BASE_URL: `${LOCAL}/` },
  });
  assertEquals(result.code, 0, result.stderr);
  assertEquals(stored(out.state).hosts, { [CLOUD]: { token: CLOUD_TOK } });
});

Deno.test("auth status: the mask boundary is 12 characters", async () => {
  for (
    const [token, want] of [["a".repeat(11) + "WXYZ".slice(0, 0), "****"], [
      "a".repeat(8) + "WXYZ",
      "****WXYZ",
    ]]
  ) {
    const { store } = memoryStore(file({ [CLOUD]: token }));
    const parsed = JSON.parse((await run(["auth", "status", "--json"], { store })).stdout);
    assertEquals(parsed.tokenMasked, want, `${token.length} chars`);
  }
});
