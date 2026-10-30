/**
 * `client.dataStores.*`, against an injected fake `fetch`.
 *
 * Each case pins method, path, query and body as INDEPENDENT literals (never
 * re-derived from the implementation), for the per-call project AND the client
 * default. No live server is needed (`docs/implementation.md` §9).
 */

import { assert, assertEquals, assertInstanceOf, assertRejects } from "@std/assert";
import { W6WClient } from "../src/client.ts";
import type { FetchLike } from "../src/config.ts";
import { ApiError } from "../src/errors.ts";

interface Call {
  url: URL;
  method: string | undefined;
  headers: Headers;
  body: string | null;
  signal: AbortSignal | null | undefined;
}

function fakeFetch(respond: (call: Call) => Response): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = (input, init) => {
    const call: Call = {
      url: new URL(input),
      method: init?.method,
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? init.body : null,
      signal: init?.signal,
    };
    calls.push(call);
    return Promise.resolve(respond(call));
  };
  return { fetch, calls };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type Opts = { project?: string; signal?: AbortSignal };
type Run = (c: W6WClient, o: Opts) => Promise<unknown>;

interface Case {
  name: string;
  run: Run;
  method: string;
  path: string;
  /** Query pairs other than `project`. */
  query: [string, string][];
  /** The parsed JSON body, or `null` for no body. */
  body: unknown;
  /** Status the mock answers. */
  status?: number;
  reads?: boolean;
}

const CASES: Case[] = [
  {
    name: "list",
    run: (c, o) => c.dataStores.list({ kind: "table", cursor: "cur1", limit: 5, ...o }),
    method: "GET",
    path: "/data-stores",
    query: [["kind", "table"], ["cursor", "cur1"], ["limit", "5"]],
    body: null,
    reads: true,
  },
  {
    name: "get",
    run: (c, o) => c.dataStores.get("ds_1", o),
    method: "GET",
    path: "/data-stores/ds_1",
    query: [],
    body: null,
    reads: true,
  },
  {
    name: "create",
    run: (c, o) =>
      c.dataStores.create({
        kind: "table",
        name: "people",
        description: "d",
        schema: { columns: [{ name: "age", type: "integer", required: true }] },
      }, o),
    method: "POST",
    path: "/data-stores",
    query: [],
    body: {
      kind: "table",
      name: "people",
      description: "d",
      schema: { columns: [{ name: "age", type: "integer", required: true }] },
    },
    status: 201,
  },
  {
    name: "update",
    run: (c, o) => c.dataStores.update("ds_1", { name: "renamed" }, o),
    method: "PATCH",
    path: "/data-stores/ds_1",
    query: [],
    body: { name: "renamed" },
  },
  {
    name: "archive",
    run: (c, o) => c.dataStores.archive("ds_1", o),
    method: "DELETE",
    path: "/data-stores/ds_1",
    query: [],
    body: null,
    status: 204,
  },
  {
    name: "importCsv",
    run: (c, o) => c.dataStores.importCsv("ds_1", "name,age\nann,3\n", o),
    method: "POST",
    path: "/data-stores/ds_1/import",
    query: [],
    body: "RAW:name,age\nann,3\n",
  },
  {
    name: "exportCsv",
    run: (c, o) => c.dataStores.exportCsv("ds_1", o),
    method: "GET",
    path: "/data-stores/ds_1/export",
    query: [],
    body: null,
    reads: true,
  },
  {
    name: "entries.list",
    run: (c, o) =>
      c.dataStores.entries.list("ds_1", { prefix: "u:", cursor: "c2", limit: 10, ...o }),
    method: "GET",
    path: "/data-stores/ds_1/entries",
    query: [["prefix", "u:"], ["cursor", "c2"], ["limit", "10"]],
    body: null,
    reads: true,
  },
  {
    name: "entries.get",
    run: (c, o) => c.dataStores.entries.get("ds_1", "a/b c", o),
    method: "GET",
    path: "/data-stores/ds_1/entries/a%2Fb%20c",
    query: [],
    body: null,
    reads: true,
  },
  {
    name: "entries.set",
    run: (c, o) =>
      c.dataStores.entries.set("ds_1", "k", { value: { n: 1 }, ifVersion: 3, ttlSeconds: 60 }, o),
    method: "PUT",
    path: "/data-stores/ds_1/entries/k",
    query: [],
    body: { value: { n: 1 }, ifVersion: 3, ttlSeconds: 60 },
  },
  {
    name: "entries.set (value only)",
    run: (c, o) => c.dataStores.entries.set("ds_1", "k", { value: "v" }, o),
    method: "PUT",
    path: "/data-stores/ds_1/entries/k",
    query: [],
    body: { value: "v" },
  },
  {
    name: "entries.insert",
    run: (c, o) => c.dataStores.entries.insert("ds_1", { name: "ann", age: 3 }, o),
    method: "POST",
    path: "/data-stores/ds_1/entries",
    query: [],
    body: { value: { name: "ann", age: 3 } },
    status: 201,
  },
  {
    name: "entries.increment (by 5)",
    run: (c, o) => c.dataStores.entries.increment("ds_1", "a/b c", 5, o),
    method: "POST",
    path: "/data-stores/ds_1/entries/a%2Fb%20c/increment",
    query: [],
    body: { by: 5 },
  },
  {
    name: "entries.increment (no by)",
    run: (c, o) => c.dataStores.entries.increment("ds_1", "a/b c", undefined, o),
    method: "POST",
    path: "/data-stores/ds_1/entries/a%2Fb%20c/increment",
    query: [],
    body: null,
  },
  {
    name: "entries.delete",
    run: (c, o) => c.dataStores.entries.delete("ds_1", "a/b c", o),
    method: "DELETE",
    path: "/data-stores/ds_1/entries/a%2Fb%20c",
    query: [],
    body: null,
    status: 204,
  },
  {
    name: "entries.query",
    run: (c, o) =>
      c.dataStores.entries.query("ds_1", {
        where: { age: 3, city: "x y" },
        order: "-age",
        limit: 7,
      }, o),
    method: "GET",
    path: "/data-stores/ds_1/entries",
    query: [["where[age]", "3"], ["where[city]", "x y"], ["order", "-age"], ["limit", "7"]],
    body: null,
    reads: true,
  },
];

function answer(c: Case, call: Call): Response {
  if (c.status === 204) return new Response(null, { status: 204 });
  if (call.url.pathname.endsWith("/export")) return new Response("a,b\r\n1,2\r\n", { status: 200 });
  return json({ items: [] }, c.status ?? 200);
}

function checkCall(c: Case, call: Call, project: string | undefined) {
  assertEquals(call.method, c.method, `${c.name}: method`);
  assertEquals(call.url.pathname, c.path, `${c.name}: path`);
  const want = [...c.query, ...(project === undefined ? [] : [["project", project]])];
  const got = [...call.url.searchParams.entries()];
  assertEquals(got.sort(), want.sort(), `${c.name}: query`);
  if (typeof c.body === "string" && c.body.startsWith("RAW:")) {
    assertEquals(call.body, c.body.slice(4), `${c.name}: raw body`);
    assertEquals(call.headers.get("content-type"), "text/csv", `${c.name}: media type`);
  } else if (c.body === null) {
    assert(call.body === null || call.body === "{}", `${c.name}: no body, got ${call.body}`);
    if (c.name !== "entries.increment (no by)") assertEquals(call.body, null, `${c.name}: body`);
  } else {
    assertEquals(JSON.parse(call.body as string), c.body, `${c.name}: body`);
    assertEquals(call.headers.get("content-type"), "application/json");
  }
}

for (const c of CASES) {
  Deno.test(`dataStores ${c.name}: per-call project beats the client default`, async () => {
    const { fetch, calls } = fakeFetch((call) => answer(c, call));
    const client = new W6WClient({
      baseUrl: "https://api.example.com",
      token: "t",
      project: "prj_default",
      fetch,
    });
    await c.run(client, { project: "prj_call" });
    assertEquals(calls.length, 1);
    checkCall(c, calls[0], "prj_call");
  });

  Deno.test(`dataStores ${c.name}: client default project is used`, async () => {
    const { fetch, calls } = fakeFetch((call) => answer(c, call));
    const client = new W6WClient({
      baseUrl: "https://api.example.com",
      token: "t",
      project: "prj_default",
      fetch,
    });
    await c.run(client, {});
    checkCall(c, calls[0], "prj_default");
  });

  Deno.test(`dataStores ${c.name}: no project anywhere sends none`, async () => {
    const { fetch, calls } = fakeFetch((call) => answer(c, call));
    const client = new W6WClient({ baseUrl: "https://api.example.com", token: "t", fetch });
    await c.run(client, {});
    checkCall(c, calls[0], undefined);
  });

  if (c.reads) {
    Deno.test(`dataStores ${c.name}: forwards signal`, async () => {
      const { fetch, calls } = fakeFetch((call) => answer(c, call));
      const client = new W6WClient({ baseUrl: "https://api.example.com", token: "t", fetch });
      const ac = new AbortController();
      await c.run(client, { signal: ac.signal });
      assertEquals(calls[0].signal, ac.signal);
    });
  }
}

Deno.test("dataStores: every one of the 14 methods is covered by a case", () => {
  const covered = new Set(CASES.map((c) => c.name.replace(/ \(.*\)$/, "")));
  assertEquals(
    [...covered].sort(),
    [
      "archive",
      "create",
      "entries.delete",
      "entries.get",
      "entries.increment",
      "entries.insert",
      "entries.list",
      "entries.query",
      "entries.set",
      "exportCsv",
      "get",
      "importCsv",
      "list",
      "update",
    ].sort(),
  );
});

Deno.test("dataStores.exportCsv returns the body verbatim", async () => {
  const { fetch } = fakeFetch(() => new Response('"name"\r\n1\r\n', { status: 200 }));
  const client = new W6WClient({ baseUrl: "https://api.example.com", token: "t", fetch });
  assertEquals(await client.dataStores.exportCsv("ds_1"), '"name"\r\n1\r\n');
});

Deno.test("dataStores.importCsv returns { imported }", async () => {
  const { fetch } = fakeFetch(() => json({ imported: 2 }));
  const client = new W6WClient({ baseUrl: "https://api.example.com", token: "t", fetch });
  assertEquals(await client.dataStores.importCsv("ds_1", "a\n1\n2\n"), { imported: 2 });
});

Deno.test("dataStores.list returns the page with nextCursor absent when the server omits it", async () => {
  const { fetch } = fakeFetch(() => json({ items: [] }));
  const client = new W6WClient({ baseUrl: "https://api.example.com", token: "t", fetch });
  const page = await client.dataStores.list();
  assertEquals(page, { items: [] });
  assertEquals("nextCursor" in page, false);
});

// ── Errors: status + code passthrough, extras on raw (W-4) ───────────────────

const invalidValue = {
  error: { code: "invalid_value", message: "bad age", field: "value", row: 2, column: "age" },
};

for (
  const [label, run] of [
    ["entries.set", (c: W6WClient) => c.dataStores.entries.set("ds_1", "k", { value: 1 })],
    ["importCsv", (c: W6WClient) => c.dataStores.importCsv("ds_1", "age\nx\n")],
  ] as [string, (c: W6WClient) => Promise<unknown>][]
) {
  Deno.test(`dataStores ${label}: 400 invalid_value keeps field/row/column on raw`, async () => {
    const { fetch } = fakeFetch(() => json(invalidValue, 400));
    const client = new W6WClient({ baseUrl: "https://api.example.com", token: "t", fetch });
    const err = await assertRejects(() => run(client), ApiError);
    assertInstanceOf(err, ApiError);
    assertEquals(err.status, 400);
    assertEquals(err.code, "invalid_value");
    const raw = err.raw as typeof invalidValue;
    assertEquals(raw.error.row, 2);
    assertEquals(raw.error.column, "age");
    assertEquals(raw.error.field, "value");
  });
}

for (
  const [status, code, run] of [
    [400, "invalid_key", (c: W6WClient) => c.dataStores.entries.set("ds_1", "", { value: 1 })],
    [400, "invalid_cursor", (c: W6WClient) => c.dataStores.list({ cursor: "zz" })],
    [400, "unknown_project", (c: W6WClient) => c.dataStores.list({ project: "nope" })],
    [404, "data_store_not_found", (c: W6WClient) => c.dataStores.exportCsv("ds_x")],
  ] as [number, string, (c: W6WClient) => Promise<unknown>][]
) {
  Deno.test(`dataStores: ${status} ${code} passes through as ApiError`, async () => {
    const { fetch } = fakeFetch(() => json({ error: { code, message: "m" } }, status));
    const client = new W6WClient({ baseUrl: "https://api.example.com", token: "t", fetch });
    const err = await assertRejects(() => run(client), ApiError);
    assertEquals(err.status, status);
    assertEquals(err.code, code);
  });
}
