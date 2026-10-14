/**
 * T2.1.1 — `<W6WProvider getSession>` + `useW6WSession()`.
 *
 * Fake clock: `mock.timers` (setTimeout + Date). Counts of `getSession` calls
 * come from closure counters and Authorization headers from the fake
 * transport's recorded calls — independent literals, never values the store
 * computed. Never `await new Promise(r => setTimeout(r, 0))` under the fake
 * clock (it hangs): flush with `settle()` / `tick()`.
 */
import assert from "node:assert/strict";
import { mock, test } from "node:test";
import type { FetchLike, W6WClient } from "@w6w/sdk";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { W6WProvider, useW6WClient } from "../W6WProvider.tsx";
import { type W6WSession, type W6WSessionState, useW6WSession } from "../session.ts";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Call {
  url: string;
  method: string;
  headers: Headers;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fakeFetch(respond?: (call: Call) => Response): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = (input, init) => {
    const call: Call = {
      url: input,
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
    };
    calls.push(call);
    return Promise.resolve(respond ? respond(call) : json({}));
  };
  return { fetch, calls };
}

function withRoot<T>(run: (root: Root) => Promise<T> | T): Promise<T> {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
  (globalThis as unknown as { window: unknown }).window = dom.window;
  (globalThis as unknown as { document: Document }).document = dom.window.document;
  Object.defineProperty(globalThis, "navigator", {
    value: dom.window.navigator,
    configurable: true,
  });
  // jsdom reports "prerender"/"hidden" by default; a real foreground tab is "visible".
  Object.defineProperty(dom.window.document, "visibilityState", {
    value: "visible",
    configurable: true,
  });
  const container = dom.window.document.getElementById("root") as unknown as Element;
  const root = createRoot(container);
  return Promise.resolve(run(root)).finally(() => {
    act(() => {
      root.unmount();
    });
    mock.timers.reset();
  });
}

const T0 = 1_800_000_000_000;
const ME_BODY = { tenant: "t1", subject: "s1", account: "a1", role: "owner" };
const bearer = (c: Call | undefined) => c?.headers.get("authorization");

/** Latest values captured by <Probe/>. */
const cap: { client: W6WClient | null; session: W6WSessionState | null } = {
  client: null,
  session: null,
};
function Probe() {
  cap.client = useW6WClient();
  cap.session = useW6WSession();
  return null;
}
const client = () => cap.client as W6WClient;
const state = () => cap.session as W6WSessionState;

function fakeClock(): void {
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: T0 });
}
/** Flush microtasks (promise chains) without touching the fake clock. */
async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) await act(async () => {});
}
async function tick(ms: number): Promise<void> {
  await act(async () => {
    mock.timers.tick(ms);
  });
  await settle();
}
async function show(visible: boolean): Promise<void> {
  const doc = document as unknown as Document;
  Object.defineProperty(doc, "visibilityState", {
    value: visible ? "visible" : "hidden",
    configurable: true,
  });
  await act(async () => {
    doc.dispatchEvent(
      new (globalThis as unknown as { window: { Event: typeof Event } }).window.Event(
        "visibilitychange",
      ),
    );
  });
  await settle();
}

/** A getSession that mints `tok-N` expiring `ttlMs` after it is called. */
function minter(ttlMs: number, extra: Partial<W6WSession> = {}) {
  const m = {
    calls: 0,
    fn: (): Promise<W6WSession> => {
      m.calls++;
      return Promise.resolve({
        token: `tok-${m.calls}`,
        expiresAt: new Date(Date.now() + ttlMs).toISOString(),
        ...extra,
      });
    },
  };
  return m;
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type Props = Record<string, unknown>;
async function mount(root: Root, props: Props): Promise<void> {
  await act(async () => {
    root.render(createElement(W6WProvider, props as never, createElement(Probe)));
  });
  await settle();
}

const BASE = "https://api.example.com";

// ── props contract ───────────────────────────────────────────────────────

test("W6WProvider throws a plain Error when both or neither of token/getSession are given", () =>
  withRoot(async (root) => {
    const origError = console.error;
    console.error = () => {};
    try {
      for (const props of [
        { baseUrl: BASE, token: "t", getSession: minter(1000).fn },
        { baseUrl: BASE },
      ]) {
        await assert.rejects(
          (async () => {
            await act(async () => {
              root.render(createElement(W6WProvider, props as never, createElement(Probe)));
            });
          })(),
          (e: unknown) =>
            e instanceof Error && /exactly one of `token` or `getSession`/.test(e.message),
        );
      }
    } finally {
      console.error = origError;
    }
  }));

test("token mode: useW6WSession is ready/loading by `ready`, expiresAt null, refresh() calls nothing", () =>
  withRoot(async (root) => {
    const fake = fakeFetch();
    await mount(root, { baseUrl: BASE, token: "t", fetch: fake.fetch });
    assert.equal(state().status, "ready");
    assert.equal(state().expiresAt, null);
    await state().refresh();
    assert.equal(fake.calls.length, 0);
    await mount(root, { baseUrl: BASE, token: "t", ready: false, fetch: fake.fetch });
    assert.equal(state().status, "loading");
  }));

// ── AC2: renewal window ──────────────────────────────────────────────────

test("renews inside the window and not before it (lazy and eager)", () =>
  withRoot(async (root) => {
    fakeClock();
    const fake = fakeFetch(() => json(ME_BODY));
    const m = minter(120_000);
    await mount(root, {
      baseUrl: BASE,
      getSession: m.fn,
      renewBeforeMs: 30_000,
      fetch: fake.fetch,
    });
    await client().me();
    assert.equal(m.calls, 1);
    assert.equal(bearer(fake.calls[0]), "Bearer tok-1");
    await tick(89_000); // t=89s < renewAt (90s)
    await client().me();
    assert.equal(m.calls, 1, "cached before the window");
    assert.equal(bearer(fake.calls[1]), "Bearer tok-1");
    await tick(1_000); // t=90s: the eager timer renews with no request
    assert.equal(m.calls, 2, "eager timer renewed at expiry - window");
    await client().me();
    assert.equal(bearer(fake.calls[2]), "Bearer tok-2");
    assert.equal(m.calls, 2);
  }));

test("renews lazily inside the window when the timer has not run", () =>
  withRoot(async (root) => {
    fakeClock();
    const fake = fakeFetch(() => json(ME_BODY));
    const m = minter(120_000);
    await mount(root, {
      baseUrl: BASE,
      getSession: m.fn,
      renewBeforeMs: 30_000,
      fetch: fake.fetch,
    });
    await client().me();
    // jump Date without running timers: the supplier's own check must renew
    mock.timers.setTime(T0 + 91_000);
    await client().me();
    assert.equal(m.calls, 2);
    assert.equal(bearer(fake.calls[1]), "Bearer tok-2");
  }));

test("expiresIn bounds a far-future expiresAt (clock skew)", () =>
  withRoot(async (root) => {
    fakeClock();
    const fake = fakeFetch(() => json(ME_BODY));
    const m = minter(3_600_000, { expiresIn: 60 });
    await mount(root, {
      baseUrl: BASE,
      getSession: m.fn,
      renewBeforeMs: 30_000,
      fetch: fake.fetch,
    });
    await client().me();
    mock.timers.setTime(T0 + 40_000); // inside 60s - 30s window, far from expiresAt
    await client().me();
    assert.equal(m.calls, 2, "expiresIn made the session expire first");
    assert.equal(bearer(fake.calls[1]), "Bearer tok-2");
  }));

test("a TTL shorter than 2x the window renews at half-life, not on every request", () =>
  withRoot(async (root) => {
    fakeClock();
    const fake = fakeFetch(() => json(ME_BODY));
    const m = minter(20_000);
    await mount(root, {
      baseUrl: BASE,
      getSession: m.fn,
      renewBeforeMs: 30_000,
      fetch: fake.fetch,
    });
    await client().me();
    mock.timers.setTime(T0 + 5_000);
    await client().me();
    await client().me();
    assert.equal(m.calls, 1, "still cached before half-life");
    mock.timers.setTime(T0 + 11_000);
    await client().me();
    assert.equal(m.calls, 2, "renewed after half-life");
  }));

// ── AC3: single flight ───────────────────────────────────────────────────

test("concurrent requests, refresh() and visibility share one getSession call", () =>
  withRoot(async (root) => {
    const fake = fakeFetch(() => json(ME_BODY));
    const d = deferred<W6WSession>();
    let calls = 0;
    const getSession = () => {
      calls++;
      return d.promise;
    };
    await mount(root, { baseUrl: BASE, getSession, fetch: fake.fetch });
    const reqs = [1, 2, 3, 4, 5].map(() => client().me());
    const r1 = state().refresh();
    const r2 = state().refresh();
    await show(true);
    await settle();
    assert.equal(calls, 1, "one acquisition for 5 requests + 2 refresh() + a visibility check");
    d.resolve({ token: "shared", expiresAt: new Date(Date.now() + 600_000).toISOString() });
    await Promise.all([...reqs, r1, r2]);
    assert.equal(calls, 1);
    assert.equal(fake.calls.length, 5);
    for (const c of fake.calls) assert.equal(bearer(c), "Bearer shared");
  }));

test("a burst of N concurrent 401s causes exactly one extra getSession call", () =>
  withRoot(async (root) => {
    const fake = fakeFetch((call) =>
      bearer(call) === "Bearer tok-1"
        ? json({ error: { code: "unauthorized", message: "revoked" } }, 401)
        : json(ME_BODY),
    );
    let calls = 0;
    let gate: ReturnType<typeof deferred<W6WSession>> | null = null;
    const getSession = (): Promise<W6WSession> => {
      calls++;
      if (calls === 1) {
        return Promise.resolve({
          token: "tok-1",
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
        });
      }
      gate = deferred<W6WSession>();
      return gate.promise;
    };
    await mount(root, {
      baseUrl: BASE,
      getSession,
      refreshOnUnauthorized: true,
      fetch: fake.fetch,
    });
    await state().refresh(); // warm the cache with tok-1
    assert.equal(calls, 1);
    const reqs = [1, 2, 3, 4, 5].map(() => client().me());
    await settle();
    assert.equal(calls, 2, "five 401s -> ONE forced acquisition");
    (gate as unknown as ReturnType<typeof deferred<W6WSession>>).resolve({
      token: "tok-2",
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    });
    await Promise.all(reqs);
    assert.equal(calls, 2);
    assert.equal(fake.calls.length, 10, "5 rejected + 5 retried");
    assert.equal(fake.calls.filter((c) => bearer(c) === "Bearer tok-2").length, 5);
  }));

// ── AC4: tab resume ──────────────────────────────────────────────────────

test("a hidden tab shown after expiry re-acquires on visibilitychange before any request", () =>
  withRoot(async (root) => {
    fakeClock();
    const fake = fakeFetch(() => json(ME_BODY));
    const m = minter(60_000);
    await mount(root, {
      baseUrl: BASE,
      getSession: m.fn,
      renewBeforeMs: 10_000,
      fetch: fake.fetch,
    });
    await client().me();
    assert.equal(m.calls, 1);
    await show(false);
    await tick(120_000); // timers fire while hidden: no acquisition
    assert.equal(m.calls, 1, "hidden tab does not renew");
    assert.equal(state().status, "expired");
    assert.equal(fake.calls.length, 1);
    await show(true);
    assert.equal(m.calls, 2, "visibilitychange re-acquired before any request");
    assert.equal(fake.calls.length, 1);
    await client().me();
    assert.equal(bearer(fake.calls[1]), "Bearer tok-2");
    assert.equal(m.calls, 2);
  }));

// ── AC5: identity switch ─────────────────────────────────────────────────

test("an acquisition started under A and resolved after the switch is never used", () =>
  withRoot(async (root) => {
    const fake = fakeFetch(() => json(ME_BODY));
    const dA = deferred<W6WSession>();
    const soon = () => new Date(Date.now() + 600_000).toISOString();
    await mount(root, {
      baseUrl: BASE,
      identityKey: "A",
      getSession: () => dA.promise,
      fetch: fake.fetch,
    });
    const oldClient = client();
    const aReq = oldClient.me().catch((e: unknown) => e);
    await settle();
    await mount(root, {
      baseUrl: BASE,
      identityKey: "B",
      getSession: () => Promise.resolve({ token: "tok-B", expiresAt: soon() }),
      fetch: fake.fetch,
    });
    assert.notEqual(client(), oldClient);
    dA.resolve({ token: "tok-A-late", expiresAt: soon() });
    await aReq;
    await settle();
    await client().me();
    await client().me();
    await oldClient.me().catch(() => {});
    assert.ok(fake.calls.length >= 2);
    for (const c of fake.calls) assert.equal(bearer(c), "Bearer tok-B");
    assert.equal(state().status, "ready");
  }));

// ── AC6: status walk ─────────────────────────────────────────────────────

test("useW6WSession walks loading -> ready -> renewing -> ready, reaches expired and error, refresh() recovers", () =>
  withRoot(async (root) => {
    fakeClock();
    const fake = fakeFetch(() => json(ME_BODY));
    const seen: string[] = [];
    let gate = deferred<W6WSession>();
    let mode: "defer" | "fail" | "ok" = "defer";
    let calls = 0;
    const getSession = (): Promise<W6WSession> => {
      calls++;
      if (mode === "fail") return Promise.reject(new Error("boom"));
      if (mode === "ok") {
        return Promise.resolve({
          token: "tok-ok",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        });
      }
      gate = deferred<W6WSession>();
      return gate.promise;
    };
    const mint = (token: string) => ({
      token,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    await mount(root, { baseUrl: BASE, getSession, renewBeforeMs: 10_000, fetch: fake.fetch });
    seen.push(state().status);
    assert.equal(state().expiresAt, null);
    const first = client().me();
    await settle();
    seen.push(state().status);
    gate.resolve(mint("tok-1"));
    await first;
    await settle();
    seen.push(state().status);
    assert.equal(state().expiresAt, new Date(T0 + 60_000).toISOString());
    await tick(50_000); // eager renewal starts (deferred)
    seen.push(state().status);
    gate.resolve(mint("tok-2"));
    await settle();
    seen.push(state().status);
    assert.deepEqual(seen, ["loading", "loading", "ready", "renewing", "ready"]);

    await show(false);
    await tick(70_000);
    assert.equal(state().status, "expired");

    mode = "fail";
    await state().refresh();
    assert.equal(state().status, "error");
    assert.match(String((state().error as Error).message), /boom/);
    await assert.rejects(client().me(), (e: unknown) => /boom/.test(String((e as Error).message)));
    const before = calls;
    await show(true); // no auto-retry from the tab either
    assert.equal(calls, before);
    mode = "ok";
    await state().refresh();
    assert.equal(state().status, "ready");
    assert.equal(state().error, null);
    await client().me();
    assert.equal(bearer(fake.calls.at(-1)), "Bearer tok-ok");
  }));

test("a failed renewal keeps serving a still-valid session; a blank token is an error", () =>
  withRoot(async (root) => {
    fakeClock();
    const fake = fakeFetch(() => json(ME_BODY));
    let calls = 0;
    const getSession = (): Promise<W6WSession> => {
      calls++;
      if (calls === 1) {
        return Promise.resolve({
          token: "tok-1",
          expiresAt: new Date(Date.now() + 120_000).toISOString(),
        });
      }
      return calls === 2
        ? Promise.reject(new Error("down"))
        : Promise.resolve({ token: "  ", expiresAt: new Date(Date.now() + 1000).toISOString() });
    };
    await mount(root, { baseUrl: BASE, getSession, renewBeforeMs: 30_000, fetch: fake.fetch });
    await client().me();
    await tick(95_000); // eager renewal fails (calls=2), session valid until 120s
    assert.equal(state().status, "error");
    await client().me();
    assert.equal(bearer(fake.calls.at(-1)), "Bearer tok-1", "still-valid session is served");
    await tick(30_000); // now expired
    await state().refresh(); // blank token
    assert.equal(state().status, "error");
    assert.match(String((state().error as Error).message), /blank token/);
    await assert.rejects(client().me());
    assert.equal(fake.calls.length, 2, "nothing reached the wire with a blank token");
  }));

// ── AC7: 401 on a POST ───────────────────────────────────────────────────

test("a 401 on a POST: fetch is called exactly 2x whether the retry succeeds or also 401s", () =>
  withRoot(async (root) => {
    const unauthorized = () => json({ error: { code: "unauthorized", message: "no" } }, 401);

    const okFetch = fakeFetch((call) =>
      bearer(call) === "Bearer tok-1"
        ? unauthorized()
        : json({ var: { id: "v1", key: "k", value: "v" } }),
    );
    const m1 = minter(600_000);
    await mount(root, {
      baseUrl: BASE,
      getSession: m1.fn,
      refreshOnUnauthorized: true,
      fetch: okFetch.fetch,
    });
    await client().vars.create({ key: "k", value: "v" } as never);
    assert.equal(okFetch.calls.length, 2);
    assert.deepEqual(
      okFetch.calls.map((c) => c.method),
      ["POST", "POST"],
    );
    assert.equal(m1.calls, 2);

    const denied: unknown[] = [];
    const badFetch = fakeFetch(unauthorized);
    const m2 = minter(600_000);
    await mount(root, {
      baseUrl: BASE,
      identityKey: "second",
      getSession: m2.fn,
      refreshOnUnauthorized: true,
      onUnauthorized: (e: unknown) => denied.push(e),
      fetch: badFetch.fetch,
    });
    await assert.rejects(client().vars.create({ key: "k", value: "v" } as never));
    assert.equal(badFetch.calls.length, 2);
    assert.equal(denied.length, 1);
    assert.equal(m2.calls, 2);
  }));
