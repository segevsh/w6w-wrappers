/**
 * Model hooks: `useModels`, `useModelRoutes`, `useModelUsage` hit the right
 * routes with the options on the wire, and distinct options never share a
 * single-flighted request.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { FetchLike } from "@w6w/sdk";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { W6WProvider } from "../W6WProvider.tsx";
import { useModelRoutes, useModelUsage, useModels } from "../hooks.ts";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function fakeFetch(respond: (url: string) => unknown) {
  const urls: string[] = [];
  const fetch: FetchLike = (input) => {
    urls.push(input);
    return Promise.resolve(
      new Response(JSON.stringify(respond(input)), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  };
  return { fetch, urls };
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

function body(url: string): unknown {
  if (url.includes("/model-usage")) return { totals: {}, items: [], nextCursor: null };
  if (url.includes("/model-routes")) return [{ name: "r1" }];
  return { models: [{ id: "m1" }], nextCursor: null };
}

test("hooks fetch their routes with options on the wire and expose data", () =>
  withRoot(async (root) => {
    const fake = fakeFetch(body);
    const seen: Record<string, unknown> = {};
    function Probe() {
      seen.models = useModels({ provider: "openai", limit: 5 }).data;
      seen.routes = useModelRoutes({ project: "p1" }).data;
      seen.usage = useModelUsage({ groupBy: "day", route: "r1" }).data;
      return null;
    }
    await act(async () => {
      root.render(
        createElement(
          W6WProvider,
          { baseUrl: "https://x.test", token: "t", fetch: fake.fetch },
          createElement(Probe),
        ),
      );
    });
    await settle();
    assert.equal(fake.urls.length, 3);
    const m = fake.urls.find((u) => u.includes("/models"));
    assert.ok(m?.includes("provider=openai") && m.includes("limit=5"), String(m));
    const r = fake.urls.find((u) => u.includes("/model-routes"));
    assert.ok(r?.includes("project=p1"), String(r));
    const u = fake.urls.find((u) => u.includes("/model-usage"));
    assert.ok(u?.includes("groupBy=day") && u.includes("route=r1"), String(u));
    assert.deepEqual(seen.models, { models: [{ id: "m1" }], nextCursor: null });
    assert.deepEqual(seen.routes, [{ name: "r1" }]);
    assert.deepEqual(seen.usage, { totals: {}, items: [], nextCursor: null });
  }));

test("distinct options make distinct requests (options are in the key)", () =>
  withRoot(async (root) => {
    const fake = fakeFetch(body);
    function A() {
      useModels({ provider: "a" });
      useModelUsage({ route: "a" });
      return null;
    }
    function B() {
      useModels({ provider: "b" });
      useModelUsage({ route: "b" });
      return null;
    }
    await act(async () => {
      root.render(
        createElement(
          W6WProvider,
          { baseUrl: "https://x.test", token: "t", fetch: fake.fetch },
          createElement(A),
          createElement(B),
        ),
      );
    });
    await settle();
    assert.equal(fake.urls.length, 4);
    assert.equal(new Set(fake.urls).size, 4);
  }));
