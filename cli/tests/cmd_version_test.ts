/**
 * `w6w version` / `--version` / `-v` — versions only, unauthenticated, never fails.
 *
 * Real `main()` against a fake transport; no test reaches a real host.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import type { FetchLike } from "@w6w/sdk";
import { main, VERSION } from "../mod.ts";
import type { EnvReader } from "../mod.ts";
import { COMMANDS } from "../src/commands/index.ts";

const BASE = "https://api.example.test";
const BODY = { version: "1.2.3", composition: "core:a,server:b" };

interface Seen {
  url: string;
  headers: Headers;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function w6w(
  argv: string[],
  reply: (call: Seen, init?: RequestInit) => Promise<Response> | Response,
  env: Record<string, string> = {},
) {
  const calls: Seen[] = [];
  const stdout: string[] = [];
  const stderr: string[] = [];
  const fetch: FetchLike = (url, init) => {
    const call = { url, headers: new Headers(init?.headers) };
    calls.push(call);
    return Promise.resolve(reply(call, init));
  };
  const reader: EnvReader = (name) => ({ W6W_BASE_URL: BASE, ...env })[name];
  const started = performance.now();
  const code = await main(argv, {
    stdout: (text) => stdout.push(text),
    stderr: (text) => stderr.push(text),
  }, { env: reader, fetch, commands: COMMANDS });
  return {
    code,
    stdout: stdout.join("\n"),
    stderr: stderr.join("\n"),
    calls,
    ms: performance.now() - started,
  };
}

const SPELLINGS = [["version"], ["--version"], ["-v"]];

Deno.test("version: three lines, exit 0, no identity, for every spelling", async () => {
  for (const argv of SPELLINGS) {
    const r = await w6w(argv, () => json(200, BODY));
    assertEquals(r.code, 0, argv.join(" "));
    assertEquals(
      r.stdout,
      `wrapper: ${VERSION}\nserver: 1.2.3\ncomposition: core:a,server:b`,
      argv.join(" "),
    );
    assertEquals(r.stderr, "");
    assertEquals(r.calls.length, 1);
    assertEquals(r.calls[0].url, `${BASE}/version`);
    for (const word of ["tenant", "subject", "account", "role"]) {
      assert(!r.stdout.includes(word), `${argv.join(" ")} leaked ${word}`);
    }
  }
});

Deno.test("version: no token is needed", async () => {
  const r = await w6w(["version"], () => json(200, BODY));
  assertEquals(r.code, 0);
  assertStringIncludes(r.stdout, "server: 1.2.3");
});

Deno.test("version: unavailable server prints the reason, exits 0, quickly", async () => {
  const cases: [string, () => Promise<Response> | Response, string][] = [
    ["refused", () => Promise.reject(new TypeError("connection refused")), "connection refused"],
    ["500", () => json(500, {}), "HTTP 500"],
    ["not json", () => new Response("<html>", { status: 200 }), "not JSON"],
    ["missing field", () => json(200, { version: "1" }), "unexpected response"],
    ["non-string", () => json(200, { version: 1, composition: "x" }), "unexpected response"],
  ];
  for (const [label, reply, reason] of cases) {
    for (const argv of SPELLINGS) {
      const r = await w6w(argv, reply);
      assertEquals(r.code, 0, `${label} ${argv}`);
      const lines = r.stdout.split("\n");
      assertEquals(lines.length, 2, `${label}: ${r.stdout}`);
      assertEquals(lines[0], `wrapper: ${VERSION}`);
      assert(lines[1].startsWith("server: unavailable ("), r.stdout);
      assertStringIncludes(lines[1], reason);
      assert(r.ms < 5000);
    }
  }
});

Deno.test("version: a request that never answers times out within 5 s and exits 0", async () => {
  const r = await w6w(["version"], (_call, init) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    }));
  assertEquals(r.code, 0);
  assertStringIncludes(r.stdout, "server: unavailable (timed out after 3s)");
  assert(r.ms < 5000, `took ${r.ms}ms`);
});

Deno.test("version: an invalid base URL is unavailable, not a failure", async () => {
  const r = await w6w(["version", "--base-url", "not a url"], () => json(200, BODY));
  assertEquals(r.code, 0);
  assertStringIncludes(r.stdout, "server: unavailable (");
  assertEquals(r.calls.length, 0);
});

Deno.test("version --json: exact objects, raw values", async () => {
  for (const argv of [["version", "--json"], ["--version", "--json"], ["-v", "--json"]]) {
    const ok = await w6w(argv, () => json(200, { version: "0.0.0", composition: "dev" }));
    assertEquals(ok.code, 0);
    assertEquals(JSON.parse(ok.stdout), { wrapper: VERSION, server: "0.0.0", composition: "dev" });

    const down = await w6w(argv, () => json(500, {}));
    assertEquals(down.code, 0);
    assertEquals(JSON.parse(down.stdout), {
      wrapper: VERSION,
      server: null,
      composition: null,
      serverError: "HTTP 500",
    });
  }
});

Deno.test("version text: the D5 display rule shows 0.0.0 as dev", async () => {
  const r = await w6w(["version"], () => json(200, { version: "0.0.0", composition: "dev" }));
  assertStringIncludes(r.stdout, "server: dev");
});

Deno.test("version: never sends an Authorization header, whatever token is configured", async () => {
  const runs: [string[], Record<string, string>][] = [
    [["version"], { W6W_TOKEN: "secret" }],
    [["version", "--token", "secret"], {}],
    [["--version", "--token", "secret"], { W6W_TOKEN: "secret" }],
  ];
  for (const [argv, env] of runs) {
    const r = await w6w(argv, () => json(200, BODY), env);
    assertEquals(r.calls.length, 1);
    assertEquals(r.calls[0].headers.get("authorization"), null, argv.join(" "));
    assertEquals([...r.calls[0].headers.keys()].filter((k) => k.includes("auth")), []);
  }
});

Deno.test("help: no request is made for --help, version --help or --version --help", async () => {
  for (const argv of [["--help"], ["version", "--help"], ["--version", "--help"], ["-v", "-h"]]) {
    const r = await w6w(argv, () => json(200, BODY));
    assertEquals(r.code, 0, argv.join(" "));
    assertEquals(r.calls.length, 0, argv.join(" "));
    assert(r.stdout.length > 0);
  }
  const help = await w6w(["version", "--help"], () => json(200, BODY));
  assertStringIncludes(help.stdout, "w6w version");
});

Deno.test("version does not shadow `workflows version` / `functions version`", async () => {
  for (const group of ["workflows", "functions"]) {
    const r = await w6w(
      [group, "version", "wf_1", "2"],
      () => json(200, { version: { versionNumber: 2, createdAt: "2026-10-02T00:00:00Z" } }),
      { W6W_TOKEN: "t" },
    );
    assertEquals(r.code, 0, r.stderr);
    assertEquals(r.calls.length, 1);
    assertStringIncludes(r.calls[0].url, "/versions/2");
    assert(!r.calls[0].url.endsWith("/version"));
    assertEquals(r.calls[0].headers.get("authorization"), "Bearer t");
  }
});

Deno.test("me: renders the server's server and composition version lines", async () => {
  const r = await w6w(["me"], () =>
    json(200, {
      tenant: "default",
      subject: "user_01H",
      account: "default",
      role: "admin",
      versions: { server: "1.2.3", composition: "core:a,server:b", wrapper: "0.9.30" },
    }), { W6W_TOKEN: "t" });
  assertEquals(r.code, 0, r.stderr);
  assertStringIncludes(r.stdout, "  server: 1.2.3");
  assertStringIncludes(r.stdout, "  composition: core:a,server:b");
});
