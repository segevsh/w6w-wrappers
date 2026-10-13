/**
 * Concurrent ordinary requests on one config share ONE token-supplier call
 * (`requireToken`, `src/config.ts`); nothing is cached once it settles, and a
 * forced refresh never joins or fills the shared slot. Driven through the real
 * {@linkcode request} transport over a fake `fetch`, like `auth_options_test.ts`.
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import { type FetchLike, requireToken, resolveConfig, type TokenProvider } from "../src/config.ts";
import { ConfigError } from "../src/errors.ts";
import { request } from "../src/http.ts";

interface Call {
  url: string;
  headers: Headers;
}

function fakeFetch(respond?: (call: Call) => Response): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = (input, init) => {
    const call: Call = { url: input, headers: new Headers(init?.headers) };
    calls.push(call);
    return Promise.resolve(respond ? respond(call) : json({ ok: true }));
  };
  return { fetch, calls };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const macrotask = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A supplier whose result is released by hand, so requests genuinely overlap. */
function gatedSupplier(value: string) {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const token: TokenProvider = async () => {
    calls++;
    await gate;
    return value;
  };
  return { token, release, count: () => calls };
}

const get = (config: ReturnType<typeof resolveConfig>, f: FetchLike, path = "/vars") =>
  request(config, f, { method: "GET", path });

Deno.test("token-share: K1 five concurrent requests call the supplier once; a 6th after settle calls again", async () => {
  const s = gatedSupplier("tok_shared");
  const config = resolveConfig({ baseUrl: "https://api.example.com", token: s.token });
  const fake = fakeFetch();
  const all = Promise.all([1, 2, 3, 4, 5].map(() => get(config, fake.fetch)));
  await macrotask();
  s.release();
  await all;
  assertEquals(s.count(), 1);
  assertEquals(fake.calls.length, 5);
  for (const c of fake.calls) assertEquals(c.headers.get("authorization"), "Bearer tok_shared");
  await get(config, fake.fetch);
  assertEquals(s.count(), 2);
  assertEquals(fake.calls.length, 6);
});

Deno.test("token-share: K2 two configs with different suppliers each send their own bearer", async () => {
  const a = gatedSupplier("tok_a");
  const b = gatedSupplier("tok_b");
  const ca = resolveConfig({ baseUrl: "https://a.example.com", token: a.token });
  const cb = resolveConfig({ baseUrl: "https://b.example.com", token: b.token });
  const fa = fakeFetch();
  const fb = fakeFetch();
  const all = Promise.all([get(ca, fa.fetch), get(cb, fb.fetch), get(ca, fa.fetch)]);
  await macrotask();
  a.release();
  b.release();
  await all;
  assertEquals(a.count(), 1);
  assertEquals(b.count(), 1);
  assertEquals(fa.calls.map((c) => c.headers.get("authorization")), [
    "Bearer tok_a",
    "Bearer tok_a",
  ]);
  assertEquals(fb.calls.map((c) => c.headers.get("authorization")), ["Bearer tok_b"]);
});

Deno.test("token-share: K3 a rejecting supplier rejects all joiners with no transport call, then is re-invoked", async () => {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const token: TokenProvider = async () => {
    calls++;
    await gate;
    if (calls === 1) throw new Error("mint failed");
    return "tok_ok";
  };
  const config = resolveConfig({ baseUrl: "https://api.example.com", token });
  const fake = fakeFetch();
  const three = [1, 2, 3].map(() =>
    assertRejects(() => get(config, fake.fetch), Error, "mint failed")
  );
  await macrotask();
  release();
  await Promise.all(three);
  assertEquals(calls, 1);
  assertEquals(fake.calls.length, 0);
  await get(config, fake.fetch);
  assertEquals(calls, 2);
  assertEquals(fake.calls.length, 1);
});

Deno.test("token-share: K4 a nullish result gives every joiner a ConfigError from one supplier call", async () => {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const token: TokenProvider = async () => {
    calls++;
    await gate;
    return null;
  };
  const config = resolveConfig({ baseUrl: "https://api.example.com", token });
  const fake = fakeFetch();
  const three = [1, 2, 3].map(() => assertRejects(() => get(config, fake.fetch), ConfigError));
  await macrotask();
  release();
  await Promise.all(three);
  assertEquals(calls, 1);
  assertEquals(fake.calls.length, 0);
});

Deno.test("token-share: K5 a forced refresh neither joins a pending ordinary flight nor is joined", async () => {
  const seen: Array<{ forceRefresh?: boolean } | undefined> = [];
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const token: TokenProvider = async (ctx) => {
    seen.push(ctx);
    await gate;
    return ctx?.forceRefresh ? "tok_forced" : "tok_ordinary";
  };
  const config = resolveConfig({ baseUrl: "https://api.example.com", token });

  // Forced while an ordinary flight is pending: own call, own result.
  const ord1 = requireToken(config);
  const forced1 = requireToken(config, { forceRefresh: true });
  // Ordinary while a forced flight is pending: joins the earlier ordinary one.
  const ord2 = requireToken(config);
  await macrotask();
  release();
  assertEquals(await ord1, "tok_ordinary");
  assertEquals(await forced1, "tok_forced");
  assertEquals(await ord2, "tok_ordinary");
  assertEquals(seen.filter((c) => c?.forceRefresh === true).length, 1);
  assertEquals(seen.filter((c) => c?.forceRefresh !== true).length, 1);

  // A forced flight must not fill the slot a later ordinary call would join.
  const seen2: Array<{ forceRefresh?: boolean } | undefined> = [];
  let release2!: () => void;
  const gate2 = new Promise<void>((r) => (release2 = r));
  const config2 = resolveConfig({
    baseUrl: "https://api.example.com",
    token: async (ctx) => {
      seen2.push(ctx);
      await gate2;
      return ctx?.forceRefresh ? "tok_forced" : "tok_ordinary";
    },
  });
  const f = requireToken(config2, { forceRefresh: true });
  const o = requireToken(config2);
  await macrotask();
  release2();
  assertEquals(await f, "tok_forced");
  assertEquals(await o, "tok_ordinary");
  assertEquals(seen2.filter((c) => c?.forceRefresh === true).length, 1);
  assertEquals(seen2.filter((c) => c?.forceRefresh !== true).length, 1);
});

Deno.test("token-share: K6 a 401 on the first of 5 concurrent requests forces exactly one refresh", async () => {
  const ctxSeen: Array<{ forceRefresh?: boolean } | undefined> = [];
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const token: TokenProvider = async (ctx) => {
    ctxSeen.push(ctx);
    if (!ctx) await gate;
    return ctx?.forceRefresh ? "tok_new" : "tok_old";
  };
  const config = resolveConfig({
    baseUrl: "https://api.example.com",
    token,
    refreshOnUnauthorized: true,
  });
  let n = 0;
  const fake = fakeFetch(() =>
    n++ === 0 ? json({ error: { code: "unauthorized", message: "expired" } }, 401) : json({ ok: 1 })
  );
  const all = Promise.all([1, 2, 3, 4, 5].map(() => get(config, fake.fetch)));
  await macrotask();
  release();
  await all;
  assertEquals(ctxSeen, [undefined, { forceRefresh: true }]);
  assertEquals(fake.calls.length, 6);
  assertEquals(
    fake.calls.filter((c) => c.headers.get("authorization") === "Bearer tok_new").length,
    1,
  );
  assert(fake.calls.slice(0, 5).every((c) => c.headers.get("authorization") === "Bearer tok_old"));
});
