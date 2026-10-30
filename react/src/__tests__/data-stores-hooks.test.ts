/**
 * Data-store hooks: each of the 13 hooks sends the contract's route (method,
 * pathname, query, body) through exactly one SDK method, and read hooks
 * single-flight on EVERY argument, `where` included.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { FetchLike } from "@w6w/sdk";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  W6WProvider,
  useArchiveDataStore,
  useCreateDataStore,
  useDataStore,
  useDataStoreEntries,
  useDataStoreEntry,
  useDataStoreQuery,
  useDataStores,
  useDeleteDataStoreEntry,
  useImportDataStoreCsv,
  useIncrementDataStoreEntry,
  useInsertDataStoreRow,
  useSetDataStoreEntry,
  useUpdateDataStore,
} from "../../mod.ts";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Seen {
  method: string;
  pathname: string;
  params: URLSearchParams;
  contentType: string | null;
  raw: string | undefined;
  json: unknown;
}

function fakeFetch() {
  const calls: Seen[] = [];
  const fetch: FetchLike = (input, init) => {
    const url = new URL(input);
    const raw = typeof init?.body === "string" ? init.body : undefined;
    const contentType = new Headers(init?.headers).get("content-type");
    calls.push({
      method: String(init?.method),
      pathname: url.pathname,
      params: url.searchParams,
      contentType,
      raw,
      json: raw !== undefined && contentType === "application/json" ? JSON.parse(raw) : undefined,
    });
    if (init?.method === "DELETE") return Promise.resolve(new Response(null, { status: 204 }));
    return Promise.resolve(
      new Response(JSON.stringify({ id: "ds_1", items: [] }), {
        status: 200,
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

async function mount(root: Root, fetch: FetchLike, ...probes: Array<() => unknown>): Promise<void> {
  await act(async () => {
    root.render(
      createElement(
        W6WProvider,
        { baseUrl: "https://x.test", token: "t", fetch },
        ...probes.map((p, i) =>
          createElement(
            () => {
              p();
              return null;
            },
            { key: i },
          ),
        ),
      ),
    );
  });
  await settle();
}

/** Mount one read hook and return the single request it sent. */
async function readOnce(probe: () => unknown): Promise<Seen> {
  return withRoot(async (root) => {
    const fake = fakeFetch();
    await mount(root, fake.fetch, probe);
    assert.equal(fake.calls.length, 1);
    return fake.calls[0] as Seen;
  });
}

/** Mount one mutation hook, call it, and return the single request it sent. */
async function mutateOnce<A extends unknown[]>(
  hook: () => { call: (...a: A) => Promise<unknown> },
  ...args: A
): Promise<Seen> {
  return withRoot(async (root) => {
    const fake = fakeFetch();
    let call: ((...a: A) => Promise<unknown>) | undefined;
    await mount(root, fake.fetch, () => {
      call = hook().call;
    });
    await act(async () => {
      await call?.(...args);
    });
    assert.equal(fake.calls.length, 1);
    return fake.calls[0] as Seen;
  });
}

test("useDataStores: GET /data-stores with kind, limit and project", async () => {
  const c = await readOnce(() => useDataStores({ kind: "table", limit: 5, project: "p1" }));
  assert.equal(c.method, "GET");
  assert.equal(c.pathname, "/data-stores");
  assert.equal(c.params.get("project"), "p1");
  assert.equal(c.params.get("kind"), "table");
  assert.equal(c.params.get("limit"), "5");
});

test("useDataStores: no options sends no query at all", async () => {
  const c = await readOnce(() => useDataStores());
  assert.equal(c.pathname, "/data-stores");
  assert.equal([...c.params.keys()].length, 0);
});

test("useDataStore: GET /data-stores/ds_1?project=p1", async () => {
  const c = await readOnce(() => useDataStore("ds_1", { project: "p1" }));
  assert.equal(c.method, "GET");
  assert.equal(c.pathname, "/data-stores/ds_1");
  assert.equal(c.params.get("project"), "p1");
});

test("useDataStoreEntries: GET .../entries with prefix and no where[...]", async () => {
  const c = await readOnce(() => useDataStoreEntries("ds_1", { prefix: "user:", limit: 10 }));
  assert.equal(c.method, "GET");
  assert.equal(c.pathname, "/data-stores/ds_1/entries");
  assert.equal(c.params.get("prefix"), "user:");
  assert.equal(c.params.get("limit"), "10");
  assert.deepEqual(
    [...c.params.keys()].filter((k) => k.startsWith("where[")),
    [],
  );
});

test("useDataStoreEntry: GET .../entries/k1 percent-encodes the key", async () => {
  const c = await readOnce(() => useDataStoreEntry("ds_1", "k 1/x", { project: "p1" }));
  assert.equal(c.method, "GET");
  assert.equal(c.pathname, "/data-stores/ds_1/entries/k%201%2Fx");
  assert.equal(c.params.get("project"), "p1");
});

test("useDataStoreQuery: GET .../entries with where[status]=open, order, limit", async () => {
  const c = await readOnce(() =>
    useDataStoreQuery("ds_1", {
      where: { status: "open", n: 3 },
      order: "-n",
      limit: 7,
      project: "p1",
    }),
  );
  assert.equal(c.method, "GET");
  assert.equal(c.pathname, "/data-stores/ds_1/entries");
  assert.equal(c.params.get("where[status]"), "open");
  assert.equal(c.params.get("where[n]"), "3");
  assert.equal(c.params.get("order"), "-n");
  assert.equal(c.params.get("limit"), "7");
  assert.equal(c.params.get("project"), "p1");
});

test("useCreateDataStore: POST /data-stores with the body and project", async () => {
  const c = await mutateOnce(
    useCreateDataStore,
    { kind: "kv", name: "counters", description: "d" },
    { project: "p1" },
  );
  assert.equal(c.method, "POST");
  assert.equal(c.pathname, "/data-stores");
  assert.equal(c.params.get("project"), "p1");
  assert.deepEqual(c.json, { kind: "kv", name: "counters", description: "d" });
});

test("useUpdateDataStore: PATCH /data-stores/ds_1 with the patch", async () => {
  const c = await mutateOnce(useUpdateDataStore, "ds_1", { name: "renamed" }, { project: "p1" });
  assert.equal(c.method, "PATCH");
  assert.equal(c.pathname, "/data-stores/ds_1");
  assert.equal(c.params.get("project"), "p1");
  assert.deepEqual(c.json, { name: "renamed" });
});

test("useArchiveDataStore: DELETE /data-stores/ds_1", async () => {
  const c = await mutateOnce(useArchiveDataStore, "ds_1", { project: "p1" });
  assert.equal(c.method, "DELETE");
  assert.equal(c.pathname, "/data-stores/ds_1");
  assert.equal(c.params.get("project"), "p1");
  assert.equal(c.raw, undefined);
});

test("useSetDataStoreEntry: PUT .../entries/k1 with ifVersion in the body", async () => {
  const c = await mutateOnce(
    useSetDataStoreEntry,
    "ds_1",
    "k1",
    { value: { a: 1 }, ifVersion: 3, ttlSeconds: 60 },
    { project: "p1" },
  );
  assert.equal(c.method, "PUT");
  assert.equal(c.pathname, "/data-stores/ds_1/entries/k1");
  assert.equal(c.params.get("project"), "p1");
  assert.deepEqual(c.json, { value: { a: 1 }, ifVersion: 3, ttlSeconds: 60 });
});

test("useInsertDataStoreRow: POST .../entries with {value: row}", async () => {
  const c = await mutateOnce(useInsertDataStoreRow, "ds_1", { name: "a" }, { project: "p1" });
  assert.equal(c.method, "POST");
  assert.equal(c.pathname, "/data-stores/ds_1/entries");
  assert.equal(c.params.get("project"), "p1");
  assert.deepEqual(c.json, { value: { name: "a" } });
});

test("useIncrementDataStoreEntry: POST .../entries/k1/increment with by, or no body", async () => {
  const withBy = await mutateOnce(useIncrementDataStoreEntry, "ds_1", "k1", 5, { project: "p1" });
  assert.equal(withBy.method, "POST");
  assert.equal(withBy.pathname, "/data-stores/ds_1/entries/k1/increment");
  assert.equal(withBy.params.get("project"), "p1");
  assert.deepEqual(withBy.json, { by: 5 });
  const bare = await mutateOnce(useIncrementDataStoreEntry, "ds_1", "k1");
  assert.equal(bare.raw, undefined);
});

test("useDeleteDataStoreEntry: DELETE .../entries/k1", async () => {
  const c = await mutateOnce(useDeleteDataStoreEntry, "ds_1", "k1", { project: "p1" });
  assert.equal(c.method, "DELETE");
  assert.equal(c.pathname, "/data-stores/ds_1/entries/k1");
  assert.equal(c.params.get("project"), "p1");
});

test("useImportDataStoreCsv: POST .../import as text/csv with the raw body", async () => {
  const csv = 'name,n\n"a, b",1\n';
  const c = await mutateOnce(useImportDataStoreCsv, "ds_1", csv, { project: "p1" });
  assert.equal(c.method, "POST");
  assert.equal(c.pathname, "/data-stores/ds_1/import");
  assert.equal(c.params.get("project"), "p1");
  assert.equal(c.contentType, "text/csv");
  assert.equal(c.raw, csv);
});

test("query hooks: different where send 2 requests, identical ones send 1", async () => {
  await withRoot(async (root) => {
    const fake = fakeFetch();
    await mount(
      root,
      fake.fetch,
      () => useDataStoreQuery("ds_1", { where: { status: "open" } }),
      () => useDataStoreQuery("ds_1", { where: { status: "closed" } }),
    );
    assert.equal(fake.calls.length, 2);
    assert.deepEqual(fake.calls.map((c) => c.params.get("where[status]")).sort(), [
      "closed",
      "open",
    ]);
  });
  await withRoot(async (root) => {
    const fake = fakeFetch();
    await mount(
      root,
      fake.fetch,
      () => useDataStoreQuery("ds_1", { where: { status: "open" } }),
      () => useDataStoreQuery("ds_1", { where: { status: "open" } }),
    );
    assert.equal(fake.calls.length, 1);
  });
});

test("entry and store reads are keyed on every argument", async () => {
  await withRoot(async (root) => {
    const fake = fakeFetch();
    await mount(
      root,
      fake.fetch,
      () => useDataStoreEntry("ds_1", "a"),
      () => useDataStoreEntry("ds_1", "b"),
      () => useDataStoreEntries("ds_1", { prefix: "a" }),
      () => useDataStoreEntries("ds_1", { prefix: "b" }),
    );
    assert.equal(fake.calls.length, 4);
  });
});
