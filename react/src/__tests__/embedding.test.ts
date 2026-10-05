/**
 * T2.1.1's five pinned behaviours beyond the native-token-supplier floor
 * already covered by `provider.test.ts`: `ready`, `identityKey`
 * (rebuild + reset + real cancellation), overlapping-fetch sequencing on the
 * SAME client, unmount cancellation, and the `refreshOnUnauthorized` /
 * `onUnauthorized` / `headers` passthrough plus the no-rebuild-on-equal-input
 * memoization policy.
 *
 * Same harness as `provider.test.ts` (fake `fetch` injected via the `fetch`
 * prop, real jsdom + `react-dom/client` + `act` reconciliation) plus one
 * addition: `controlledFetch()`, whose calls resolve on demand — needed to
 * observe an in-flight request's state (its `AbortSignal`, whether it has
 * been superseded) before letting it settle.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { FetchLike, W6WClient } from "@w6w/sdk";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { W6WProvider, useW6WClient } from "../W6WProvider.tsx";
import { useMe } from "../hooks.ts";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** One recorded call to a fake transport. */
interface Call {
  url: string;
  headers: Headers;
  signal: AbortSignal | undefined;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A `fetch`-shaped fake that answers immediately. `respond` defaults to `200 {}`. */
function fakeFetch(respond?: (call: Call) => Response): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = (input, init) => {
    const call: Call = { url: input, headers: new Headers(init?.headers), signal: init?.signal };
    calls.push(call);
    return Promise.resolve(respond ? respond(call) : json({}));
  };
  return { fetch, calls };
}

/**
 * A `fetch`-shaped fake whose calls resolve only when `resolve(i, …)` is
 * called explicitly — needed to inspect an in-flight call (its `signal`,
 * whether a newer call has superseded it) before it settles.
 */
function controlledFetch(): {
  fetch: FetchLike;
  calls: Call[];
  resolve: (index: number, body: unknown, status?: number) => void;
} {
  const calls: Call[] = [];
  const resolvers: Array<(res: Response) => void> = [];
  const fetch: FetchLike = (input, init) => {
    calls.push({ url: input, headers: new Headers(init?.headers), signal: init?.signal });
    return new Promise<Response>((resolve) => {
      resolvers.push(resolve);
    });
  };
  return {
    fetch,
    calls,
    resolve: (index, body, status = 200) => resolvers[index]?.(json(body, status)),
  };
}

/** A fresh jsdom document + root per test, auto-unmounted in a `finally`. */
function withRoot<T>(run: (root: Root) => Promise<T> | T): Promise<T> {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
  (globalThis as unknown as { window: unknown }).window = dom.window;
  (globalThis as unknown as { document: Document }).document = dom.window.document;
  Object.defineProperty(globalThis, "navigator", {
    value: dom.window.navigator,
    configurable: true,
  });
  const container = dom.window.document.getElementById("root") as unknown as Element;
  const root = createRoot(container);
  return Promise.resolve(run(root)).finally(() => {
    act(() => {
      root.unmount();
    });
  });
}

/**
 * Same as {@linkcode withRoot}, except the test itself decides when to
 * unmount (to observe the unmount-time abort) via the returned `cleanup`; the
 * `finally` only unmounts if the test never did.
 */
function withManualRoot<T>(run: (root: Root, cleanup: () => void) => Promise<T> | T): Promise<T> {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
  (globalThis as unknown as { window: unknown }).window = dom.window;
  (globalThis as unknown as { document: Document }).document = dom.window.document;
  Object.defineProperty(globalThis, "navigator", {
    value: dom.window.navigator,
    configurable: true,
  });
  const container = dom.window.document.getElementById("root") as unknown as Element;
  const root = createRoot(container);
  let unmounted = false;
  const cleanup = () => {
    if (unmounted) return;
    unmounted = true;
    act(() => {
      root.unmount();
    });
  };
  return Promise.resolve(run(root, cleanup)).finally(cleanup);
}

const ME_BODY = { tenant: "t1", subject: "s1", account: "a1", role: "owner" };

// ── ready ────────────────────────────────────────────────────────────────

test("ready=false blocks every read hook; flipping to true fetches exactly once", () =>
  withRoot(async (root) => {
    const fake = fakeFetch(() => json(ME_BODY));
    let captured: ReturnType<typeof useMe> | null = null;
    function Probe() {
      captured = useMe();
      return null;
    }

    await act(async () => {
      root.render(
        createElement(
          W6WProvider,
          { baseUrl: "https://api.example.com", token: "t", ready: false, fetch: fake.fetch },
          createElement(Probe),
        ),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.equal(fake.calls.length, 0, "ready: false must send no request");
    assert.equal(captured?.loading, true);
    assert.equal(captured?.error, undefined);

    await act(async () => {
      root.render(
        createElement(
          W6WProvider,
          { baseUrl: "https://api.example.com", token: "t", ready: true, fetch: fake.fetch },
          createElement(Probe),
        ),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.equal(fake.calls.length, 1, "flipping ready to true must fetch exactly once");
    assert.equal(captured?.loading, false);
    assert.equal(captured?.data?.tenant, "t1");
  }));

// ── identityKey ──────────────────────────────────────────────────────────

test("identityKey switch aborts the in-flight call; data is undefined until the new identity resolves; a late resolution from the old identity never renders", () =>
  withRoot(async (root) => {
    const ctl = controlledFetch();
    let captured: ReturnType<typeof useMe> | null = null;
    function Probe() {
      captured = useMe();
      return null;
    }

    await act(async () => {
      root.render(
        createElement(
          W6WProvider,
          { baseUrl: "https://api.example.com", token: "t", identityKey: "A", fetch: ctl.fetch },
          createElement(Probe),
        ),
      );
      await Promise.resolve();
    });
    assert.equal(ctl.calls.length, 1);
    assert.equal(ctl.calls[0]?.signal?.aborted, false);

    await act(async () => {
      root.render(
        createElement(
          W6WProvider,
          { baseUrl: "https://api.example.com", token: "t", identityKey: "B", fetch: ctl.fetch },
          createElement(Probe),
        ),
      );
      await Promise.resolve();
    });
    assert.equal(ctl.calls.length, 2, "the identity switch must issue a new request");
    assert.equal(ctl.calls[0]?.signal?.aborted, true, "A's request must be aborted");
    assert.equal(captured?.data, undefined, "no stale data between the switch and B's response");

    // A resolves LATE — must never render.
    await act(async () => {
      ctl.resolve(0, { ...ME_BODY, tenant: "A" });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.equal(captured?.data, undefined, "A's late resolution must never commit");

    await act(async () => {
      ctl.resolve(1, { ...ME_BODY, tenant: "B" });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.equal(captured?.data?.tenant, "B", "the final data must be B's");
  }));

// ── overlapping fetches on the SAME client ──────────────────────────────

test("same client: refetch while the first call is pending — the first never commits, even resolving last", () =>
  withRoot(async (root) => {
    const ctl = controlledFetch();
    let captured: ReturnType<typeof useMe> | null = null;
    function Probe() {
      captured = useMe();
      return null;
    }

    await act(async () => {
      root.render(
        createElement(
          W6WProvider,
          { baseUrl: "https://api.example.com", token: "t", fetch: ctl.fetch },
          createElement(Probe),
        ),
      );
      await Promise.resolve();
    });
    assert.equal(ctl.calls.length, 1);

    await act(async () => {
      captured?.refetch();
      await Promise.resolve();
    });
    assert.equal(ctl.calls.length, 2, "refetch must issue a second request");
    assert.equal(ctl.calls[0]?.signal?.aborted, true, "the superseded first call must be aborted");

    // The first call resolves LAST — must never commit over the second.
    await act(async () => {
      ctl.resolve(1, { ...ME_BODY, tenant: "second" });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.equal(captured?.data?.tenant, "second");

    await act(async () => {
      ctl.resolve(0, { ...ME_BODY, tenant: "first" });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.equal(
      captured?.data?.tenant,
      "second",
      "the superseded first call must never commit, even resolving last",
    );
  }));

test("unmount aborts the in-flight signal", () =>
  withManualRoot(async (root, cleanup) => {
    const ctl = controlledFetch();
    function Probe() {
      useMe();
      return null;
    }

    await act(async () => {
      root.render(
        createElement(
          W6WProvider,
          { baseUrl: "https://api.example.com", token: "t", fetch: ctl.fetch },
          createElement(Probe),
        ),
      );
      await Promise.resolve();
    });
    assert.equal(ctl.calls.length, 1);
    assert.equal(ctl.calls[0]?.signal?.aborted, false);

    cleanup();

    assert.equal(ctl.calls[0]?.signal?.aborted, true, "unmount must abort the in-flight signal");
  }));

// ── refreshOnUnauthorized / onUnauthorized / headers passthrough ────────

test("refreshOnUnauthorized retries once via the supplier's forceRefresh ctx, and the retry succeeds", () =>
  withRoot(async (root) => {
    let n = 0;
    const fake = fakeFetch(() => {
      n++;
      return n === 1
        ? json({ error: { code: "unauthorized", message: "expired" } }, 401)
        : json(ME_BODY);
    });

    let seenCtx: { forceRefresh?: boolean } | undefined;
    const supplier = (ctx?: { forceRefresh?: boolean }) => {
      seenCtx = ctx;
      return ctx?.forceRefresh ? "fresh-token" : "stale-token";
    };

    let captured: ReturnType<typeof useMe> | null = null;
    function Probe() {
      captured = useMe();
      return null;
    }

    await act(async () => {
      root.render(
        createElement(
          W6WProvider,
          {
            baseUrl: "https://api.example.com",
            token: supplier,
            refreshOnUnauthorized: true,
            fetch: fake.fetch,
          },
          createElement(Probe),
        ),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    assert.equal(fake.calls.length, 2, "one failed request plus one retry");
    assert.equal(fake.calls[0]?.headers.get("authorization"), "Bearer stale-token");
    assert.equal(fake.calls[1]?.headers.get("authorization"), "Bearer fresh-token");
    assert.deepEqual(seenCtx, { forceRefresh: true });
    assert.equal(captured?.loading, false);
    assert.equal(captured?.error, undefined);
    assert.equal(captured?.data?.tenant, "t1");
  }));

test("onUnauthorized — the LATEST prop — is called exactly once when recovery fails", () =>
  withRoot(async (root) => {
    const fake = fakeFetch(() => json({ error: { code: "unauthorized", message: "nope" } }, 401));
    let calls1 = 0;
    let calls2 = 0;

    function Probe() {
      useMe();
      return null;
    }

    act(() => {
      root.render(
        createElement(
          W6WProvider,
          {
            baseUrl: "https://api.example.com",
            token: () => "t",
            refreshOnUnauthorized: true,
            onUnauthorized: () => {
              calls1++;
            },
            fetch: fake.fetch,
          },
          createElement(Probe),
        ),
      );
    });

    // Re-render with a NEW onUnauthorized identity before the recovery
    // sequence (both awaited `fetch`es) has had a chance to settle — the
    // LATEST prop, read through a ref exactly like `token`/`fetch`, must be
    // the one invoked.
    act(() => {
      root.render(
        createElement(
          W6WProvider,
          {
            baseUrl: "https://api.example.com",
            token: () => "t",
            refreshOnUnauthorized: true,
            onUnauthorized: () => {
              calls2++;
            },
            fetch: fake.fetch,
          },
          createElement(Probe),
        ),
      );
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    assert.equal(fake.calls.length, 2, "one failed request plus one failed retry");
    assert.equal(calls1, 0, "the stale onUnauthorized must not be called");
    assert.equal(calls2, 1, "the latest onUnauthorized must be called exactly once");
  }));

test("headers reach a typed read; a new-but-equal headers object or a new token-function identity does not rebuild the client", () =>
  withRoot(async (root) => {
    const fake = fakeFetch();
    let captured: W6WClient | null = null;
    function Capture() {
      captured = useW6WClient();
      return null;
    }

    act(() => {
      root.render(
        createElement(
          W6WProvider,
          {
            baseUrl: "https://api.example.com",
            token: () => "t1",
            headers: { "X-W6W-Tenant": "t1" },
            fetch: fake.fetch,
          },
          createElement(Capture),
        ),
      );
    });
    assert.ok(captured);
    const first = captured as W6WClient;

    await first.me();
    assert.equal(fake.calls.length, 1);
    assert.equal(fake.calls[0]?.headers.get("x-w6w-tenant"), "t1");

    act(() => {
      root.render(
        createElement(
          W6WProvider,
          {
            baseUrl: "https://api.example.com",
            // A NEW token-function identity, and a NEW-BUT-EQUAL headers
            // object — neither is a memo dependency.
            token: () => "t2",
            headers: { "X-W6W-Tenant": "t1" },
            fetch: fake.fetch,
          },
          createElement(Capture),
        ),
      );
    });

    assert.equal(captured, first, "the client must be the SAME reference across the re-render");
    assert.equal(fake.calls.length, 1, "the re-render itself must not trigger a new fetch");
  }));
