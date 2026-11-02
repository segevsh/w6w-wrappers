/**
 * `client.appManagement.*` against a fake server: method, path (with `a/b`
 * encoded), query or exact body, return value, and the typed 409.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { W6WClient } from "../src/client.ts";
import type { FetchLike } from "../src/config.ts";
import { ApiError } from "../src/errors.ts";
import type { SourceInput } from "../mod.ts";

interface Call {
  method: string;
  url: URL;
  raw: string | null;
  body: unknown;
}

function setup(reply: unknown, status = 200): { client: W6WClient; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = (input, init) => {
    const raw = typeof init?.body === "string" ? init.body : null;
    calls.push({
      method: init?.method ?? "GET",
      url: new URL(String(input)),
      raw,
      body: raw === null ? null : JSON.parse(raw),
    });
    return Promise.resolve(
      new Response(JSON.stringify(reply), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
  };
  return {
    client: new W6WClient({ baseUrl: "https://api.example.com", token: "t", fetch }),
    calls,
  };
}

Deno.test("list: all options forwarded under their own names, body returned as sent", async () => {
  const page = { apps: [], scope: "tenant", snapshot: "s", total: 0, offset: 0, limit: 5 };
  const { client, calls } = setup(page);
  const got = await client.appManagement.list({
    scope: "tenant",
    q: "mail",
    sort: "-recent",
    compact: true,
    snapshot: "snap1",
    cursor: "cur1",
    offset: 10,
    limit: 5,
  });
  assertEquals(got, page as unknown);
  assertEquals(calls[0].method, "GET");
  assertEquals(calls[0].url.pathname, "/app-management/apps");
  assertEquals(Object.fromEntries(calls[0].url.searchParams), {
    scope: "tenant",
    q: "mail",
    sort: "-recent",
    compact: "true",
    snapshot: "snap1",
    cursor: "cur1",
    offset: "10",
    limit: "5",
  });
  assertEquals(calls[0].raw, null);
});

Deno.test("list: falsy offset and compact are sent; omitted options are absent", async () => {
  const { client, calls } = setup({ apps: [] });
  await client.appManagement.list({ offset: 0, compact: false });
  assertEquals(Object.fromEntries(calls[0].url.searchParams), { offset: "0", compact: "false" });
  await client.appManagement.list();
  assertEquals(calls[1].url.search, "");
});

Deno.test("get: GET with the id encoded", async () => {
  const detail = { app: { id: "a/b" }, management: { class: "tenant" } };
  const { client, calls } = setup(detail);
  assertEquals(await client.appManagement.get("a/b"), detail as unknown);
  assertEquals(calls[0].method, "GET");
  assertEquals(calls[0].url.pathname, "/app-management/apps/a%2Fb");
  assertEquals(calls[0].raw, null);
});

Deno.test("preview: POST with exactly {source, target}; extra keys are not sent", async () => {
  const reply = { kind: "app", sourceRef: "github:o/r", app: { id: "x" } };
  const { client, calls } = setup(reply);
  const input = { source: "github:o/r", target: "tenant", extra: 1 } as unknown as {
    source: SourceInput;
    target: "tenant";
  };
  assertEquals(await client.appManagement.preview(input), reply as unknown);
  assertEquals(calls[0].method, "POST");
  assertEquals(calls[0].url.pathname, "/app-management/preview");
  assertEquals(calls[0].body, { source: "github:o/r", target: "tenant" });
});

Deno.test("register: no paths key unless given; folder source passes through; extra key dropped", async () => {
  const reply = { kind: "app", target: "personal", registered: true };
  const { client, calls } = setup(reply);
  const folder: SourceInput = { folder: { grant: "sgr_1", path: "./x/y" } };
  assertEquals(
    await client.appManagement.register({ target: "personal", source: folder }),
    reply as unknown,
  );
  assertEquals(calls[0].method, "POST");
  assertEquals(calls[0].url.pathname, "/app-management/apps");
  assertEquals(calls[0].body, {
    target: "personal",
    source: { folder: { grant: "sgr_1", path: "./x/y" } },
  });
  assertEquals(Object.keys(calls[0].body as object).includes("paths"), false);

  await client.appManagement.register({
    target: "account",
    source: "github:o/pack",
    paths: ["a", "b"],
    owner: "x",
  } as never);
  assertEquals(calls[1].body, { target: "account", source: "github:o/pack", paths: ["a", "b"] });
});

Deno.test("updateSource: PUT with exactly {source, expectedRevision}; 0 is sent", async () => {
  const reply = { appId: "a/b", outcome: "registry_updated" };
  const { client, calls } = setup(reply);
  const input = { source: "github:o/r@main", expectedRevision: 0, extra: true } as never;
  assertEquals(await client.appManagement.updateSource("a/b", input), reply as unknown);
  assertEquals(calls[0].method, "PUT");
  assertEquals(calls[0].url.pathname, "/app-management/apps/a%2Fb/source");
  assertEquals(calls[0].body, { source: "github:o/r@main", expectedRevision: 0 });
});

Deno.test("sync: {} by default, {expectedRevision} when given (0 included)", async () => {
  const reply = { appId: "a/b", outcome: "failed", error: { code: "fetch_failed", message: "m" } };
  const { client, calls } = setup(reply);
  assertEquals(await client.appManagement.sync("a/b"), reply as unknown);
  assertEquals(calls[0].method, "POST");
  assertEquals(calls[0].url.pathname, "/app-management/apps/a%2Fb/sync");
  assertEquals(calls[0].body, {});
  await client.appManagement.sync("a/b", { expectedRevision: 0 });
  assertEquals(calls[1].body, { expectedRevision: 0 });
  await client.appManagement.sync("a/b", { expectedRevision: 3 });
  assertEquals(calls[2].body, { expectedRevision: 3 });
});

Deno.test("remove: DELETE, no body, returns {removed}", async () => {
  const { client, calls } = setup({ removed: 2 });
  assertEquals(await client.appManagement.remove("a/b"), { removed: 2 });
  assertEquals(calls[0].method, "DELETE");
  assertEquals(calls[0].url.pathname, "/app-management/apps/a%2Fb");
  assertEquals(calls[0].raw, null);
});

Deno.test("a 409 stale_source rejects as ApiError carrying the code", async () => {
  const { client } = setup({ error: { code: "stale_source", message: "stale" } }, 409);
  const err = await assertRejects(
    () => client.appManagement.sync("a", { expectedRevision: 1 }),
    ApiError,
  );
  assertEquals(err.code, "stale_source");
  assertEquals(err.status, 409);
});
