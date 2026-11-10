/**
 * Callable-actions surface of `@w6w/react`: tag-filtered list hooks, `useCallables`,
 * `useRunCallable`, `useCallableBinding`, and the adapter's four optional W6WApi members.
 *
 * Every run/binding assertion is on the OUTGOING request recorded by the fake transport (method,
 * URL, parsed body), never on what a hook hands back.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { FetchLike } from "@w6w/sdk";
import { W6WClient } from "@w6w/sdk";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { W6WProvider } from "../W6WProvider.tsx";
import { createW6WUiAdapter } from "../adapter.ts";
import {
  useCallableBinding,
  useCallables,
  useEndpoints,
  useFunctions,
  useRunCallable,
  useWorkflows,
} from "../hooks.ts";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Call {
  method: string;
  url: string;
  body: unknown;
}

type Responder = (call: Call) => { status?: number; body: unknown };

function fakeFetch(respond: Responder) {
  const calls: Call[] = [];
  const fetch: FetchLike = (input, init) => {
    const call: Call = {
      method: init?.method ?? "GET",
      url: input.replace("https://x.test", ""),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
    };
    calls.push(call);
    const { status = 200, body } = respond(call);
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
  };
  return { fetch, calls };
}

function withRoot<T>(run: (root: Root) => Promise<T>): Promise<T> {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
  (globalThis as unknown as { window: unknown }).window = dom.window;
  (globalThis as unknown as { document: Document }).document = dom.window.document;
  Object.defineProperty(globalThis, "navigator", {
    value: dom.window.navigator,
    configurable: true,
  });
  const root = createRoot(dom.window.document.getElementById("root") as unknown as Element);
  return run(root).finally(() => {
    act(() => {
      root.unmount();
    });
  });
}

const settle = () => act(async () => await new Promise((r) => setTimeout(r, 20)));

function mount(root: Root, fetch: FetchLike, child: () => null) {
  return act(async () => {
    root.render(
      createElement(
        W6WProvider,
        { baseUrl: "https://x.test", token: "t", fetch },
        createElement(child),
      ),
    );
  });
}

const wf = { id: "wf_1", key: null, name: "wf", displayName: "Order WF", tags: ["action.order"] };
const fn = { id: "fn_1", key: "fn-one", displayName: "Order Fn", tags: ["action.order.x"] };
const ep = { id: "ep_1", key: "ep-one", displayName: "Order Ep", tags: ["action.order"] };

function listResponder(call: Call): { status?: number; body: unknown } {
  const path = call.url.split("?")[0];
  if (path === "/workflows") return { body: { workflows: [wf] } };
  if (path === "/functions") return { body: { functions: [fn] } };
  if (path === "/endpoints") return { body: { endpoints: [ep] } };
  return { status: 404, body: { error: "not_found" } };
}

test("each list hook sends ?tag= and the tag is part of the cache key", () =>
  withRoot(async (root) => {
    const fake = fakeFetch(listResponder);
    let tag = "action.order";
    function Probe() {
      useWorkflows({ tag });
      useFunctions({ tag });
      useEndpoints({ tag });
      return null;
    }
    await mount(root, fake.fetch, Probe);
    await settle();
    for (const p of ["/workflows", "/functions", "/endpoints"]) {
      const c = fake.calls.filter((x) => x.url === `${p}?tag=action.order`);
      assert.equal(c.length, 1, `${p}: ${JSON.stringify(fake.calls.map((x) => x.url))}`);
    }
    // Same hook instance, new tag -> a NEW request.
    const before = fake.calls.length;
    tag = "action.invoice";
    await mount(root, fake.fetch, Probe);
    await settle();
    assert.equal(fake.calls.length, before + 3);
    for (const p of ["/workflows", "/functions", "/endpoints"]) {
      assert.ok(
        fake.calls.some((x) => x.url === `${p}?tag=action.invoice`),
        p,
      );
    }
  }));

test("useCallables merges the three tag-filtered lists with kind", () =>
  withRoot(async (root) => {
    const fake = fakeFetch(listResponder);
    let data: unknown;
    function Probe() {
      data = useCallables({ tag: "action.order" }).data;
      return null;
    }
    await mount(root, fake.fetch, Probe);
    await settle();
    assert.deepEqual(data, [
      { kind: "workflow", id: "wf_1", name: "Order WF", tags: ["action.order"] },
      { kind: "function", id: "fn_1", name: "Order Fn", tags: ["action.order.x"] },
      { kind: "endpoint", id: "ep_1", name: "Order Ep", tags: ["action.order"] },
    ]);
    assert.equal(fake.calls.length, 3);
    assert.ok(fake.calls.every((c) => c.url.endsWith("?tag=action.order")));
  }));

/** Drive `useRunCallable().call(...)` and return the recorded run request. */
async function runVia(
  kind: "workflow" | "function" | "endpoint",
  id: string,
  input: Record<string, unknown>,
  entry?: string,
): Promise<Call[]> {
  const fake = fakeFetch((c) => {
    if (c.url.startsWith("/workflows/")) return { body: { runId: "r1", status: "succeeded" } };
    if (c.url.startsWith("/functions/")) return { body: { output: 1 } };
    return { body: { kind: "action", value: 1 } };
  });
  await withRoot(async (root) => {
    let call:
      | ((...a: [typeof kind, string, typeof input, string?]) => Promise<unknown>)
      | undefined;
    function Probe() {
      call = useRunCallable().call;
      return null;
    }
    await mount(root, fake.fetch, Probe);
    await act(async () => {
      await call?.(kind, id, input, entry);
    });
  });
  return fake.calls;
}

test("useRunCallable workflow: wait, caller-supplied entry and input reach the body verbatim", async () => {
  const calls = await runVia("workflow", "wf_1", { shipment: { id: 7 } }, "node_manual_2");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.method, "POST");
  assert.equal(calls[0]?.url, "/workflows/wf_1/run?wait=true");
  const body = calls[0]?.body as Record<string, unknown>;
  assert.equal(body.entry, "node_manual_2");
  assert.deepEqual(body.input, { shipment: { id: 7 } });
  assert.equal(body.allowUnpublished, undefined);
});

test("useRunCallable function: payload goes as inputs", async () => {
  const calls = await runVia("function", "fn_1", { shipment: { id: 7 } });
  assert.equal(calls[0]?.method, "POST");
  assert.equal(calls[0]?.url, "/functions/fn_1/invoke");
  assert.deepEqual(calls[0]?.body, { inputs: { shipment: { id: 7 } } });
});

test("useRunCallable endpoint: payload goes as input", async () => {
  const calls = await runVia("endpoint", "ep_1", { shipment: { id: 7 } });
  assert.equal(calls[0]?.method, "POST");
  assert.equal(calls[0]?.url, "/endpoints/ep_1/invoke");
  assert.deepEqual(calls[0]?.body, { input: { shipment: { id: 7 } } });
});

function adapterOver(respond: Responder) {
  const fake = fakeFetch(respond);
  const client = new W6WClient({ baseUrl: "https://x.test", token: "t", fetch: fake.fetch });
  return { adapter: createW6WUiAdapter(client), calls: fake.calls };
}

test("adapter listCallables / invokeEndpoint / runWorkflow send P4's requests", async () => {
  const { adapter, calls } = adapterOver((c) => {
    if (c.url.startsWith("/endpoints/")) return { body: { kind: "action", value: 1 } };
    if (c.url.startsWith("/workflows/") && c.method === "POST") {
      return { body: { runId: "r1", status: "succeeded" } };
    }
    return listResponder(c);
  });
  const refs = await adapter.listCallables?.({ tag: "action.order" });
  assert.deepEqual(
    refs?.map((r) => r.kind),
    ["workflow", "function", "endpoint"],
  );
  assert.deepEqual(calls.map((c) => c.url).sort(), [
    "/endpoints?tag=action.order",
    "/functions?tag=action.order",
    "/workflows?tag=action.order",
  ]);

  calls.length = 0;
  await adapter.invokeEndpoint?.("ep_1", { shipment: { id: 7 } });
  assert.equal(calls[0]?.url, "/endpoints/ep_1/invoke");
  assert.deepEqual(calls[0]?.body, { input: { shipment: { id: 7 } } });

  calls.length = 0;
  await adapter.runWorkflow("wf_1", { input: { shipment: { id: 7 } }, entry: "n_m" });
  const body = calls[0]?.body as Record<string, unknown>;
  assert.equal(body.entry, "n_m");
  assert.deepEqual(body.input, { shipment: { id: 7 } });
  assert.equal(body.allowUnpublished, undefined);
});

const binding = { kind: "workflow", callableId: "wf_1", entry: "n_m", field: "order" } as const;
const doc = (content: string) => ({
  id: "doc_1",
  key: "callable-binding/order-details.confirm",
  content,
  format: "json",
  description: "",
  createdAt: "t",
  updatedAt: "t",
});

test("binding: missing -> null; first save creates; second save updates, never a 2nd POST", async () => {
  let stored: string | null = null;
  const { adapter, calls } = adapterOver((c) => {
    if (c.method === "GET" && c.url.startsWith("/documents/by-key/")) {
      return stored === null
        ? { status: 404, body: { error: "unknown_document" } }
        : { body: { document: doc(stored) } };
    }
    if (c.method === "POST" && c.url === "/documents") {
      stored = (c.body as { content: string }).content;
      return { status: 201, body: { document: doc(stored) } };
    }
    if (c.method === "PATCH" && c.url === "/documents/doc_1") {
      stored = (c.body as { content: string }).content;
      return { body: { document: doc(stored) } };
    }
    return { status: 500, body: { error: "unexpected" } };
  });
  const keyUrl = "/documents/by-key/callable-binding%2Forder-details.confirm";

  assert.equal(await adapter.getCallableBinding?.("order-details.confirm"), null);
  assert.equal(calls[0]?.url, keyUrl);

  calls.length = 0;
  await adapter.saveCallableBinding?.("order-details.confirm", binding);
  const posts = calls.filter((c) => c.method === "POST");
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0]?.body, {
    key: "callable-binding/order-details.confirm",
    content: JSON.stringify(binding),
    format: "json",
  });

  assert.deepEqual(await adapter.getCallableBinding?.("order-details.confirm"), binding);

  calls.length = 0;
  const next = { ...binding, field: "orderDetails" };
  await adapter.saveCallableBinding?.("order-details.confirm", next);
  assert.equal(calls.filter((c) => c.method === "POST").length, 0);
  const patches = calls.filter((c) => c.method === "PATCH");
  assert.equal(patches.length, 1);
  assert.deepEqual(patches[0]?.body, { content: JSON.stringify(next), format: "json" });
  assert.deepEqual(await adapter.getCallableBinding?.("order-details.confirm"), next);
});

test("useCallableBinding: null when missing, save then persists under the namespaced key", () =>
  withRoot(async (root) => {
    let stored: string | null = null;
    const fake = fakeFetch((c) => {
      if (c.method === "GET") {
        return stored === null
          ? { status: 404, body: { error: "unknown_document" } }
          : { body: { document: doc(stored) } };
      }
      stored = (c.body as { content: string }).content;
      return { status: 201, body: { document: doc(stored) } };
    });
    let state: ReturnType<typeof useCallableBinding> | undefined;
    function Probe() {
      state = useCallableBinding("order-details.confirm");
      return null;
    }
    await mount(root, fake.fetch, Probe);
    await settle();
    assert.equal(state?.data, null);
    assert.equal(state?.loading, false);
    await act(async () => {
      await state?.save(binding);
    });
    const post = fake.calls.find((c) => c.method === "POST");
    assert.equal((post?.body as { key: string }).key, "callable-binding/order-details.confirm");
    assert.equal((post?.body as { content: string }).content, JSON.stringify(binding));
  }));

test("concurrent list hooks with different tags do not share one in-flight request", () =>
  withRoot(async (root) => {
    const fake = fakeFetch(listResponder);
    const seen: Record<string, unknown> = {};
    function Probe() {
      seen.wa = useWorkflows({ tag: "a" }).data;
      seen.wb = useWorkflows({ tag: "b" }).data;
      seen.fa = useFunctions({ tag: "a" }).data;
      seen.fb = useFunctions({ tag: "b" }).data;
      seen.ea = useEndpoints({ tag: "a" }).data;
      seen.eb = useEndpoints({ tag: "b" }).data;
      return null;
    }
    await mount(root, fake.fetch, Probe);
    await settle();
    const urls = fake.calls.map((c) => c.url).sort();
    assert.deepEqual(urls, [
      "/endpoints?tag=a",
      "/endpoints?tag=b",
      "/functions?tag=a",
      "/functions?tag=b",
      "/workflows?tag=a",
      "/workflows?tag=b",
    ]);
  }));

test("concurrent useCallables with different tags do not share one in-flight request", () =>
  withRoot(async (root) => {
    const fake = fakeFetch(listResponder);
    function Probe() {
      useCallables({ tag: "a" });
      useCallables({ tag: "b" });
      return null;
    }
    await mount(root, fake.fetch, Probe);
    await settle();
    assert.deepEqual(fake.calls.map((c) => c.url).sort(), [
      "/endpoints?tag=a",
      "/endpoints?tag=b",
      "/functions?tag=a",
      "/functions?tag=b",
      "/workflows?tag=a",
      "/workflows?tag=b",
    ]);
  }));

test("concurrent useCallableBinding for different host keys do not share one request", () =>
  withRoot(async (root) => {
    const fake = fakeFetch(() => ({ status: 404, body: { error: "unknown_document" } }));
    function Probe() {
      useCallableBinding("screen-a");
      useCallableBinding("screen-b");
      return null;
    }
    await mount(root, fake.fetch, Probe);
    await settle();
    assert.deepEqual(fake.calls.map((c) => c.url).sort(), [
      "/documents/by-key/callable-binding%2Fscreen-a",
      "/documents/by-key/callable-binding%2Fscreen-b",
    ]);
  }));

test("getCallableBinding rejects on a non-404 error instead of reporting 'no binding'", async () => {
  const { adapter } = adapterOver(() => ({ status: 500, body: { error: "boom" } }));
  await assert.rejects(
    () => adapter.getCallableBinding?.("order-details.confirm") ?? Promise.resolve(),
  );
});
