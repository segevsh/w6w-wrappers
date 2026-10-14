/**
 * `<W6WProvider>`'s native token-supplier mechanism (T2.1.1 — no placeholder,
 * no header patching: the supplier goes straight to `@w6w/sdk`'s own
 * per-request `token`), plus one read hook and two mutation hooks exercised
 * end-to-end through it (A11) — every request goes through a fake `fetch`
 * injected via the `fetch` prop, mirroring the pattern
 * `node/tests/http_test.ts`/`client_test.ts` use for the SDK's own transport
 * tests (read-only reference, transcribed here, never imported). The
 * `useRunWorkflow` case (T1.1.2) pins its `wait: true` default — and that a
 * caller's explicit `wait: false` survives it — by reading the `?wait=`
 * query param on the wire, since that is the only externally observable
 * effect of what gets passed to `client.workflows.run`. The
 * `useUpdateWorkflow` case reads the precondition HEADER for the same reason:
 * the hook's whole job is passing its third argument through to the SDK, and
 * the wire is where that is observable.
 *
 * Real React reconciliation (jsdom + `react-dom/client` + `act`) is used
 * deliberately for the memoization test below: it asserts the SAME
 * `W6WClient` reference survives a genuine RE-RENDER of the same component
 * instance, which `renderToStaticMarkup` (a fresh mount every call) cannot
 * exercise.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { FetchLike, W6WClient } from "@w6w/sdk";
import { JSDOM } from "jsdom";
import { StrictMode, act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { W6WProvider, useW6WClient } from "../W6WProvider.tsx";
import {
  useConnections,
  useCreateVar,
  useDocument,
  useDocumentByKey,
  useDocuments,
  useFunction,
  useFunctions,
  useMe,
  useRunWorkflow,
  useUpdateWorkflow,
  useVar,
  useVars,
  useWorkflow,
  useWorkflows,
} from "../hooks.ts";
import { subscribe } from "../single-flight.ts";

// React 18.3+'s `act` warns ("not configured to support act(...)") unless this
// flag is set — required once per process, not per test.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** One recorded call to the fake transport. */
interface Call {
  url: string;
  headers: Headers;
  signal?: AbortSignal | null;
}

/** A `fetch`-shaped fake. `respond` defaults to answering `200 {}`. */
function fakeFetch(respond?: (call: Call) => Response): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = (input, init) => {
    const call: Call = {
      url: input,
      headers: new Headers(init?.headers),
      signal: init?.signal,
    };
    calls.push(call);
    return Promise.resolve(
      respond
        ? respond(call)
        : new Response(JSON.stringify({}), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
    );
  };
  return { fetch, calls };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A fresh jsdom document + root per test, so no test leaks state into another. */
function withRoot<T>(run: (root: Root) => Promise<T> | T): Promise<T> {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
  (globalThis as unknown as { window: unknown }).window = dom.window;
  (globalThis as unknown as { document: Document }).document = dom.window.document;
  // Node 24 already defines a getter-only `globalThis.navigator` (its own Web
  // API shim) — a plain assignment throws, so this needs a real property
  // redefinition to point react-dom at jsdom's `navigator` instead.
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

test("token supplier is re-read per request, not captured at construction", () =>
  withRoot(async (root) => {
    const fake = fakeFetch();
    let n = 0;
    const tokenSupplier = () => (n++ === 0 ? "token-a" : "token-b");

    let captured: W6WClient | null = null;
    function Capture() {
      captured = useW6WClient();
      return null;
    }

    act(() => {
      root.render(
        createElement(
          W6WProvider,
          { baseUrl: "https://api.example.com", token: tokenSupplier, fetch: fake.fetch },
          createElement(Capture),
        ),
      );
    });
    assert.ok(captured, "useW6WClient did not resolve a client");
    const client = captured as W6WClient;

    await client.me();
    await client.me();

    assert.equal(fake.calls.length, 2, "expected exactly two requests");
    assert.equal(fake.calls[0]?.headers.get("authorization"), "Bearer token-a");
    assert.equal(fake.calls[1]?.headers.get("authorization"), "Bearer token-b");
  }));

test("a nullish token supplier sends no request and the SDK rejects with ConfigError", () =>
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
          { baseUrl: "https://api.example.com", token: () => null, fetch: fake.fetch },
          createElement(Capture),
        ),
      );
    });
    assert.ok(captured);
    const client = captured as W6WClient;

    await assert.rejects(
      () => client.me(),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.name, "ConfigError");
        return true;
      },
    );
    assert.equal(fake.calls.length, 0, "a nullish token must never reach the wire");
  }));

test("a nullish token supplier is reported by useMe as loading, never as error, with zero requests", () =>
  withRoot(async (root) => {
    const fake = fakeFetch();

    let captured: ReturnType<typeof useMe> | null = null;
    function Probe() {
      captured = useMe();
      return null;
    }

    await act(async () => {
      root.render(
        createElement(
          W6WProvider,
          { baseUrl: "https://api.example.com", token: () => null, fetch: fake.fetch },
          createElement(Probe),
        ),
      );
      // Give useMe's effect + the rejected ConfigError promise a tick to settle.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    assert.ok(captured);
    const result = captured as ReturnType<typeof useMe>;
    assert.equal(
      result.loading,
      true,
      "a nullish supplier must leave the hook in loading, not settled",
    );
    assert.equal(
      result.error,
      undefined,
      "a nullish supplier's ConfigError must never surface as error",
    );
    assert.equal(
      fake.calls.length,
      0,
      "a nullish token must never reach the wire, even through useMe",
    );
  }));

test("an async token supplier is awaited before the bearer is attached", () =>
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
            token: () => Promise.resolve("t"),
            fetch: fake.fetch,
          },
          createElement(Capture),
        ),
      );
    });
    assert.ok(captured);
    const client = captured as W6WClient;

    await client.me();

    assert.equal(fake.calls.length, 1);
    assert.equal(fake.calls[0]?.headers.get("authorization"), "Bearer t");
  }));

test("the client is memoized across re-renders on baseUrl, not on token", () =>
  withRoot((root) => {
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
          { baseUrl: "https://api.example.com", token: "token-a", fetch: fake.fetch },
          createElement(Capture),
        ),
      );
    });
    const first = captured;
    assert.ok(first, "first render did not capture a client");

    act(() => {
      root.render(
        createElement(
          W6WProvider,
          { baseUrl: "https://api.example.com", token: "token-b", fetch: fake.fetch },
          createElement(Capture),
        ),
      );
    });
    const second = captured;

    assert.equal(first, second, "the client must be the SAME reference across re-renders");
  }));

test("useW6WClient throws a helpful error outside <W6WProvider>", () =>
  withRoot((root) => {
    function Capture() {
      useW6WClient();
      return null;
    }
    assert.throws(() => {
      act(() => {
        root.render(createElement(Capture));
      });
    }, /useW6WClient must be used inside <W6WProvider>/);
  }));

test("useMe (read hook) fetches through the provider's client and resolves {data, loading}", () =>
  withRoot(async (root) => {
    const fake = fakeFetch(() =>
      json({ tenant: "t1", subject: "s1", account: "a1", role: "owner" }),
    );

    let captured: ReturnType<typeof useMe> | null = null;
    function Probe() {
      captured = useMe();
      return null;
    }

    await act(async () => {
      root.render(
        createElement(
          W6WProvider,
          { baseUrl: "https://api.example.com", token: "tok_1", fetch: fake.fetch },
          createElement(Probe),
        ),
      );
      // Let the fetch stub's promise (and the resulting state update) settle
      // while still inside this async `act` scope.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    assert.ok(captured);
    const result = captured as ReturnType<typeof useMe>;
    assert.equal(result.loading, false);
    assert.equal(result.error, undefined);
    assert.equal(result.data?.tenant, "t1");
  }));

test("useCreateVar (mutation hook) calls through the provider's client and returns the created row", () =>
  withRoot(async (root) => {
    const fake = fakeFetch(() =>
      json(
        {
          var: {
            id: "var_1",
            name: "x",
            type: "string",
            value: "a",
            description: "",
            createdAt: "t",
            updatedAt: "t",
          },
        },
        201,
      ),
    );

    let captured: ReturnType<typeof useCreateVar> | null = null;
    function Probe() {
      captured = useCreateVar();
      return null;
    }

    act(() => {
      root.render(
        createElement(
          W6WProvider,
          { baseUrl: "https://api.example.com", token: "tok_1", fetch: fake.fetch },
          createElement(Probe),
        ),
      );
    });
    assert.ok(captured);

    let created: { id: string } | undefined;
    await act(async () => {
      created = await (captured as ReturnType<typeof useCreateVar>).call({
        name: "x",
        type: "string",
        value: "a",
      });
    });

    assert.equal(created?.id, "var_1");
    assert.equal(fake.calls.length, 1);
  }));

test("useRunWorkflow defaults to wait: true, but does not clobber an explicit wait: false", () =>
  withRoot(async (root) => {
    const fake = fakeFetch(() => json({ runId: "run_1", status: "succeeded" }));

    let captured: ReturnType<typeof useRunWorkflow> | null = null;
    function Probe() {
      captured = useRunWorkflow();
      return null;
    }

    act(() => {
      root.render(
        createElement(
          W6WProvider,
          { baseUrl: "https://api.example.com", token: "tok_1", fetch: fake.fetch },
          createElement(Probe),
        ),
      );
    });
    assert.ok(captured);
    const hook = captured as ReturnType<typeof useRunWorkflow>;

    // No options: the omitted `wait` must default to `true` — sent on the wire
    // as `?wait=true` (`node/src/workflows.ts` only ever emits `?wait=true` or
    // no `wait` param at all).
    await act(async () => {
      await hook.call("wf_1");
    });
    assert.equal(fake.calls.length, 1);
    assert.match(
      new URL(fake.calls[0]?.url as string).search,
      /(?:^\?|&)wait=true(?:&|$)/,
      "expected ?wait=true when the caller omits `wait`",
    );

    // Explicit `wait: false` must survive, not be overwritten by the default —
    // which shows up on the wire as NO `wait` param at all (the server treats
    // `?wait=false` the same as its absence, so the transport never sends it).
    await act(async () => {
      await hook.call("wf_1", { wait: false });
    });
    assert.equal(fake.calls.length, 2);
    assert.doesNotMatch(
      new URL(fake.calls[1]?.url as string).search,
      /wait=true/,
      "an explicit wait: false must not be clobbered into ?wait=true",
    );
  }));

test("useUpdateWorkflow passes its options through — the precondition reaches the wire", () =>
  withRoot(async (root) => {
    // The definition lifecycle's one non-obvious hook. A pass-through that
    // dropped `options` would look identical from the component's side — the
    // save still succeeds — and would silently turn every optimistic-concurrency
    // save into a last-write-wins one. The header is where that shows.
    const fake = fakeFetch(() =>
      json({ workflow: { id: "wf_1", name: "nightly" }, scheduled: false, updatedAt: "t2" }, 201),
    );

    let captured: ReturnType<typeof useUpdateWorkflow> | null = null;
    function Probe() {
      captured = useUpdateWorkflow();
      return null;
    }

    act(() => {
      root.render(
        createElement(
          W6WProvider,
          { baseUrl: "https://api.example.com", token: "tok_1", fetch: fake.fetch },
          createElement(Probe),
        ),
      );
    });
    assert.ok(captured);

    let saved: { updatedAt: string } | undefined;
    await act(async () => {
      saved = await (captured as ReturnType<typeof useUpdateWorkflow>).call(
        "wf_1",
        { manifestVersion: "2", name: "nightly", steps: [] },
        { ifUnmodifiedSince: "t1" },
      );
    });

    assert.equal(saved?.updatedAt, "t2");
    assert.equal(fake.calls.length, 1);
    assert.equal(fake.calls[0]?.headers.get("x-w6w-if-unmodified-since"), "t1");
  }));

// ── dedup: single-flight read hooks ──────────────────────────────────────

const macrotask = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Let pending microtasks, timers and React commits settle. */
const settle = () =>
  act(async () => {
    await macrotask();
  });

/** A fake whose calls resolve/reject on demand (`respondWith` picks the body per call). */
function heldFetch(): {
  fetch: FetchLike;
  calls: Call[];
  resolve: (index: number, body: unknown) => void;
  fail: (index: number, status: number) => void;
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
    resolve: (i, body) => resolvers[i]?.(json(body)),
    fail: (i, status) => resolvers[i]?.(json({ error: { code: "boom", message: "boom" } }, status)),
  };
}

const BASE = "https://api.example.com";

function provider(fetch: FetchLike, token: string, ...children: unknown[]) {
  return createElement(W6WProvider, { baseUrl: BASE, token, fetch }, ...(children as never[]));
}

test("dedup: D1 two useConnections consumers under StrictMode make one fetch and abort none", () =>
  withRoot(async (root) => {
    const held = heldFetch();
    const seen: unknown[] = [];
    function Probe() {
      seen.push(useConnections().data);
      return null;
    }
    await act(async () => {
      root.render(
        createElement(
          StrictMode,
          null,
          provider(held.fetch, "t", createElement(Probe), createElement(Probe)),
        ),
      );
    });
    await settle();
    assert.equal(held.calls.length, 1);
    assert.equal(held.calls[0]?.url, `${BASE}/connections`);
    assert.equal(held.calls[0]?.signal?.aborted, false);
    await act(async () => {
      held.resolve(0, { connections: [{ id: "c1" }] });
      await macrotask();
    });
    assert.deepEqual(seen.at(-1), [{ id: "c1" }]);
    assert.equal(held.calls.length, 1);
    assert.equal(held.calls.filter((c) => c.signal?.aborted).length, 0);
  }));

test("dedup: D2 two providers with the same baseUrl and different tokens do not share", () =>
  withRoot(async (root) => {
    const fake = fakeFetch((c) =>
      json({ connections: [{ id: `for-${c.headers.get("authorization")}` }] }),
    );
    const out: Record<string, unknown> = {};
    const probe = (name: string) =>
      function Probe() {
        out[name] = useConnections().data;
        return null;
      };
    await act(async () => {
      root.render(
        createElement(
          "div",
          null,
          provider(fake.fetch, "tok_a", createElement(probe("a"))),
          provider(fake.fetch, "tok_b", createElement(probe("b"))),
        ),
      );
    });
    await settle();
    assert.equal(fake.calls.length, 2);
    assert.deepEqual(out.a, [{ id: "for-Bearer tok_a" }]);
    assert.deepEqual(out.b, [{ id: "for-Bearer tok_b" }]);
  }));

test("dedup: D3 a consumer mounting after the flight settled sends a new request", () =>
  withRoot(async (root) => {
    const fake = fakeFetch(() => json([]));
    function Probe() {
      useConnections();
      return null;
    }
    await act(async () => {
      root.render(provider(fake.fetch, "t", createElement(Probe)));
    });
    await settle();
    assert.equal(fake.calls.length, 1);
    await act(async () => {
      root.render(
        provider(fake.fetch, "t", createElement(Probe), createElement(Probe, { key: "b" })),
      );
    });
    await settle();
    assert.equal(fake.calls.length, 2);
  }));

test("dedup: D4 all 11 read hooks, each mounted twice, make 11 requests to 11 distinct URLs", () =>
  withRoot(async (root) => {
    const fake = fakeFetch(() => json({}));
    function All() {
      useMe();
      useDocuments();
      useDocument("d1");
      useDocumentByKey("k1");
      useVars();
      useVar("v1");
      useConnections();
      useWorkflows();
      useWorkflow("w1");
      useFunctions();
      useFunction("f1");
      return null;
    }
    await act(async () => {
      root.render(provider(fake.fetch, "t", createElement(All), createElement(All, { key: "b" })));
    });
    await settle();
    assert.equal(fake.calls.length, 11);
    assert.equal(new Set(fake.calls.map((c) => c.url)).size, 11);
  }));

const VARIATIONS: Array<[string, () => unknown, () => unknown]> = [
  [
    "documents.project",
    () => useDocuments({ project: "p1" }),
    () => useDocuments({ project: "p2" }),
  ],
  [
    "document.id",
    () => useDocument("d1", { project: "p" }),
    () => useDocument("d2", { project: "p" }),
  ],
  [
    "document.project",
    () => useDocument("d1", { project: "p1" }),
    () => useDocument("d1", { project: "p2" }),
  ],
  [
    "byKey.key",
    () => useDocumentByKey("k1", { project: "p" }),
    () => useDocumentByKey("k2", { project: "p" }),
  ],
  [
    "byKey.project",
    () => useDocumentByKey("k1", { project: "p1" }),
    () => useDocumentByKey("k1", { project: "p2" }),
  ],
  ["var.id", () => useVar("v1"), () => useVar("v2")],
  [
    "workflows.project",
    () => useWorkflows({ project: "p1" }),
    () => useWorkflows({ project: "p2" }),
  ],
  ["workflow.id", () => useWorkflow("w1"), () => useWorkflow("w2")],
  ["function.id", () => useFunction("f1"), () => useFunction("f2")],
];

for (const [name, a, b] of VARIATIONS) {
  test(`dedup: D5 ${name}`, () =>
    withRoot(async (root) => {
      const fake = fakeFetch(() => json({}));
      function A() {
        a();
        return null;
      }
      function B() {
        b();
        return null;
      }
      await act(async () => {
        root.render(provider(fake.fetch, "t", createElement(A), createElement(B)));
      });
      await settle();
      assert.equal(fake.calls.length, 2);
      assert.notEqual(fake.calls[0]?.url, fake.calls[1]?.url);
    }));
}

test("dedup: D6 abort only when the last subscriber detaches, and nothing refires", () =>
  withRoot(async (root) => {
    const held = heldFetch();
    function Probe() {
      useConnections();
      return null;
    }
    const tree = (n: number) =>
      provider(held.fetch, "t", ...[0, 1].slice(0, n).map((i) => createElement(Probe, { key: i })));
    await act(async () => {
      root.render(tree(2));
    });
    await settle();
    assert.equal(held.calls.length, 1);
    await act(async () => {
      root.render(tree(1));
    });
    await settle();
    assert.equal(held.calls[0]?.signal?.aborted, false);
    await act(async () => {
      root.render(tree(0));
    });
    await settle();
    assert.equal(held.calls[0]?.signal?.aborted, true);
    assert.equal(held.calls.length, 1);
  }));

test("dedup: D7 a shared rejection reaches every subscriber and the next mount refires", () =>
  withRoot(async (root) => {
    const held = heldFetch();
    const errors: unknown[] = [];
    function Probe() {
      errors.push(useConnections().error);
      return null;
    }
    const tree = (n: number) =>
      provider(
        held.fetch,
        "t",
        ...Array.from({ length: n }, (_, i) => createElement(Probe, { key: i })),
      );
    await act(async () => {
      root.render(tree(2));
    });
    await settle();
    assert.equal(held.calls.length, 1);
    errors.length = 0;
    await act(async () => {
      held.fail(0, 500);
      await macrotask();
    });
    assert.equal(held.calls.length, 1);
    // Both subscribers' last render carries the (same) rejection.
    assert.ok(errors.slice(-2).every((e) => e instanceof Error));
    await act(async () => {
      root.render(tree(3));
    });
    await settle();
    assert.equal(held.calls.length, 2);
  }));

test("dedup: D8 one subscriber's refetch starts a new request and never aborts the held flight", () =>
  withRoot(async (root) => {
    const held = heldFetch();
    let refetchA: (() => void) | undefined;
    function A() {
      refetchA = useConnections().refetch;
      return null;
    }
    function B() {
      useConnections();
      return null;
    }
    await act(async () => {
      root.render(provider(held.fetch, "t", createElement(A), createElement(B)));
    });
    await settle();
    assert.equal(held.calls.length, 1);
    await act(async () => {
      refetchA?.();
      await macrotask();
    });
    assert.equal(held.calls.length, 2);
    assert.equal(held.calls[0]?.signal?.aborted, false);
  }));

test("dedup: D9 an old flight settling after a refetch does not evict the new flight", () =>
  withRoot(async (root) => {
    const held = heldFetch();
    let refetchA: (() => void) | undefined;
    function A() {
      refetchA = useConnections().refetch;
      return null;
    }
    function C() {
      useConnections();
      return null;
    }
    const tree = (withC: boolean) =>
      provider(
        held.fetch,
        "t",
        createElement(A, { key: "a" }),
        ...(withC ? [createElement(C, { key: "c" })] : []),
      );
    await act(async () => {
      root.render(tree(false));
    });
    await settle();
    assert.equal(held.calls.length, 1);
    await act(async () => {
      refetchA?.();
      await macrotask();
    });
    assert.equal(held.calls.length, 2);
    // F1 settles after F2 has started; F2 is still pending.
    await act(async () => {
      held.resolve(0, { connections: [] });
      await macrotask();
    });
    await act(async () => {
      root.render(tree(true));
    });
    await settle();
    assert.equal(held.calls.length, 2);
  }));

test("dedup: D10 a mount after the last detach sends a new request even if abort is ignored", () =>
  withRoot(async (root) => {
    const held = heldFetch(); // never reacts to `signal`: the first promise stays pending
    function Probe() {
      useConnections();
      return null;
    }
    await act(async () => {
      root.render(provider(held.fetch, "t", createElement(Probe)));
    });
    await settle();
    assert.equal(held.calls.length, 1);
    await act(async () => {
      root.render(provider(held.fetch, "t"));
    });
    await settle();
    await act(async () => {
      root.render(provider(held.fetch, "t", createElement(Probe)));
    });
    await settle();
    assert.equal(held.calls.length, 2);
  }));

test("dedup: D11 keys differing only across a | boundary do not share a flight", () =>
  withRoot(async (root) => {
    const held = heldFetch();
    function P1() {
      useDocumentByKey("a|b", { project: "c" });
      return null;
    }
    function P2() {
      useDocumentByKey("a", { project: "b|c" });
      return null;
    }
    await act(async () => {
      root.render(provider(held.fetch, "t", createElement(P1), createElement(P2)));
    });
    await settle();
    assert.equal(held.calls.length, 2);
  }));

test("dedup: D12 detach is idempotent: a double detach leaves the other holder's flight alive", async () => {
  const client = {};
  let signal: AbortSignal | undefined;
  let release: ((v: string) => void) | undefined;
  const start = (s: AbortSignal) => {
    signal = s;
    return new Promise<string>((resolve) => {
      release = resolve;
    });
  };
  const first = subscribe(client, "k", start);
  const second = subscribe(client, "k", start);
  first.detach();
  first.detach();
  await macrotask();
  assert.equal(signal?.aborted, false);
  release?.("value");
  assert.equal(await second.promise, "value");
});
