/**
 * Agent-studio hooks: `useAgents`, `useAgent`, `useSkills` and
 * `useContextCollections` fetch their routes through `@w6w/sdk` with the
 * options on the wire, expose `{data, error, loading}`, and a failure lands in
 * `error` instead of throwing out of the render.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { FetchLike } from "@w6w/sdk";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { W6WProvider } from "../W6WProvider.tsx";
import {
  useAgent,
  useAgents,
  useContextCollections,
  useContextEntries,
  useSkills,
} from "../hooks.ts";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A fetch that records each URL and answers with `respond`'s body (or throws). */
function fakeFetch(respond: (url: string) => { status?: number; body: unknown }) {
  const urls: string[] = [];
  const fetch: FetchLike = (input) => {
    urls.push(input);
    const { status = 200, body } = respond(input);
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
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

const agent = { id: "a1", name: "triage", revision: 3, runnable: false };

/** The server's single-key envelopes, per route. */
function body(url: string): { status?: number; body: unknown } {
  if (url.includes("/agents/")) return { body: { agent } };
  if (url.includes("/agents")) return { body: { agents: [agent] } };
  if (url.includes("/skills")) return { body: { skills: [{ id: "s1", name: "writeup" }] } };
  return { body: { collections: [{ id: "c1", name: "handbook" }] } };
}

test("hooks fetch their routes with options on the wire and expose loading/error/data", () =>
  withRoot(async (root) => {
    const fake = fakeFetch(body);
    const seen: Record<string, unknown> = {};
    let loadingAtFirstRender: Record<string, unknown> = {};
    function Probe() {
      const agents = useAgents({ includeArchived: true });
      const skills = useSkills({ includeArchived: true, limit: 5 });
      const collections = useContextCollections({ limit: 2 });
      if (loadingAtFirstRender.agents === undefined) {
        loadingAtFirstRender = {
          agents: agents.loading,
          skills: skills.loading,
          collections: collections.loading,
        };
      }
      seen.agents = agents.data;
      seen.skills = skills.data;
      seen.collections = collections.data;
      seen.errors = [agents.error, skills.error, collections.error];
      seen.loadingAfter = [agents.loading, skills.loading, collections.loading];
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
    // `loading` is `true` before the first result lands, and every hook reports it.
    assert.deepEqual(loadingAtFirstRender, {
      agents: true,
      skills: true,
      collections: true,
    });
    const a = fake.urls.find((u) => u.includes("/agents"));
    assert.ok(a?.includes("includeArchived=true"), String(a));
    const s = fake.urls.find((u) => u.includes("/skills"));
    assert.ok(s?.includes("includeArchived=true") && s.includes("limit=5"), String(s));
    const c = fake.urls.find((u) => u.includes("/context-collections"));
    assert.ok(c?.includes("limit=2"), String(c));
    assert.deepEqual(seen.agents, [agent]);
    assert.deepEqual(seen.skills, [{ id: "s1", name: "writeup" }]);
    assert.deepEqual(seen.collections, [{ id: "c1", name: "handbook" }]);
    assert.deepEqual(seen.errors, [undefined, undefined, undefined]);
    assert.deepEqual(seen.loadingAfter, [false, false, false]);
  }));

test("useAgent reads one draft and reports it is not runnable (A22)", () =>
  withRoot(async (root) => {
    const fake = fakeFetch(body);
    const seen: Record<string, unknown> = {};
    function Probe() {
      const result = useAgent("a1");
      seen.data = result.data;
      seen.loading = result.loading;
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
    assert.equal(fake.urls.length, 1);
    assert.ok(fake.urls[0]?.endsWith("/agents/a1"), String(fake.urls[0]));
    assert.deepEqual(seen.data, agent);
    assert.equal((seen.data as { runnable: boolean }).runnable, false);
    assert.equal(seen.loading, false);
  }));

test("distinct options make distinct requests (options are in the key)", () =>
  withRoot(async (root) => {
    const fake = fakeFetch(body);
    function A() {
      useAgents({ includeArchived: true });
      useSkills({ limit: 1 });
      useContextCollections({ limit: 1 });
      return null;
    }
    function B() {
      useAgents();
      useSkills({ limit: 2 });
      useContextCollections({ limit: 2 });
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
    // `useAgents()` sends no query at all, so `A` and `B` must still be two
    // distinct flights: the options are part of the key, not just the path.
    assert.equal(fake.urls.length, 6);
    assert.equal(new Set(fake.urls).size, 6);
  }));

test("a rejected read lands in `error`, never thrown out of the render", () =>
  withRoot(async (root) => {
    const fake = fakeFetch((url) =>
      url.includes("/agents/")
        ? { status: 404, body: { error: { code: "not_found", message: "agent not found" } } }
        : body(url),
    );
    const seen: Record<string, unknown> = {};
    function Probe() {
      const result = useAgent("missing");
      seen.data = result.data;
      seen.error = result.error;
      seen.loading = result.loading;
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
    assert.equal(fake.urls.length, 1);
    assert.equal(seen.data, undefined);
    assert.equal(seen.loading, false);
    assert.ok(seen.error instanceof Error, String(seen.error));
    assert.equal((seen.error as { status?: number }).status, 404);
  }));

test("useContextEntries sends its options to the SDK call", () =>
  withRoot(async (root) => {
    const fake = fakeFetch(() => ({ body: { entries: [{ id: "e1" }] } }));
    const seen: Record<string, unknown> = {};
    function Probe() {
      const r = useContextEntries({ collectionId: "c 1", includeArchived: true, project: "p1" });
      seen.data = r.data;
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
    assert.equal(fake.urls.length, 1);
    const u = fake.urls[0] ?? "";
    assert.ok(u.includes("/context-entries?"), u);
    assert.ok(u.includes("collectionId=c%201") || u.includes("collectionId=c+1"), u);
    assert.ok(u.includes("includeArchived=true") && u.includes("project=p1"), u);
    assert.deepEqual(seen.data, [{ id: "e1" }]);
  }));
