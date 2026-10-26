/**
 * `client.skills.*`, `client.context.*`, `client.agents.*` against a fake server:
 * paths, methods, envelopes, the precondition header + body `revision`, and the
 * typed 409 / 428 errors.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { W6WClient } from "../src/client.ts";
import type { FetchLike } from "../src/config.ts";
import { ApiError } from "../src/errors.ts";

const H = "x-w6w-if-unmodified-since";
const TOKEN = "2026-10-24T01:00:00.000Z";

interface Call {
  method: string;
  url: string;
  headers: Headers;
  body: unknown;
}

function setup(respond: () => Response): { client: W6WClient; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = (input, init) => {
    calls.push({
      method: init?.method ?? "GET",
      url: String(input),
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
    });
    return Promise.resolve(respond());
  };
  return {
    client: new W6WClient({ baseUrl: "https://api.example.com", token: "t", fetch }),
    calls,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

Deno.test("skills.* paths, methods and unwrapping", async () => {
  const s = setup(() =>
    json({ skills: [{ id: "s1" }], skill: { id: "s1" }, versions: [{ id: "v1" }] })
  );
  assertEquals(
    await s.client.skills.list({ includeArchived: true, limit: 5 }),
    [{ id: "s1" }] as never,
  );
  assertEquals(await s.client.skills.get("s/1"), { id: "s1" } as never);
  assertEquals(await s.client.skills.versions("s1"), [{ id: "v1" }] as never);
  await s.client.skills.archive("s1");
  assertEquals(s.calls.map((c) => `${c.method} ${new URL(c.url).pathname}`), [
    "GET /skills",
    "GET /skills/s%2F1",
    "GET /skills/s1/versions",
    "POST /skills/s1/archive",
  ]);
  const q = new URL(s.calls[0].url).searchParams;
  assertEquals([q.get("includeArchived"), q.get("limit")], ["true", "5"]);
});

Deno.test("context.* paths, methods and unwrapping", async () => {
  const s = setup(() =>
    json({ collections: [], collection: { id: "c1" }, entries: [], entry: { id: "e1" } })
  );
  await s.client.context.list();
  await s.client.context.create({ name: "n", visibility: "private" } as never);
  await s.client.context.get("c1");
  await s.client.context.update("c1", { name: "m" });
  await s.client.context.archive("c1");
  await s.client.context.entries.list("c1", { includeArchived: true });
  await s.client.context.entries.create("c1", { name: "a", text: "t" });
  assertEquals(s.calls.map((c) => `${c.method} ${new URL(c.url).pathname}`), [
    "GET /context-collections",
    "POST /context-collections",
    "GET /context-collections/c1",
    "PATCH /context-collections/c1",
    "POST /context-collections/c1/archive",
    "GET /context-collections/c1/entries",
    "POST /context-collections/c1/entries",
  ]);
  assertEquals(s.calls[3].body, { name: "m" });
  assertEquals(s.calls[6].body, { name: "a", text: "t" });
});

Deno.test("agents.* paths, methods, unwrapping", async () => {
  const agent = { id: "a1", runnable: false };
  const s = setup(() => json({ agents: [agent], agent }));
  assertEquals(await s.client.agents.list(), [agent] as never);
  await s.client.agents.create({ name: "x" });
  await s.client.agents.create();
  const got = await s.client.agents.get("a1");
  assertEquals(got.runnable, false);
  await s.client.agents.archive("a1");
  assertEquals(s.calls.map((c) => `${c.method} ${new URL(c.url).pathname}`), [
    "GET /agents",
    "POST /agents",
    "POST /agents",
    "GET /agents/a1",
    "POST /agents/a1/archive",
  ]);
  assertEquals(s.calls[1].body, { name: "x" });
  assertEquals(s.calls[2].body, {});
});

Deno.test("agents.update sends the precondition header only when given, and body revision", async () => {
  const s = setup(() => json({ agent: { id: "a1" } }));
  await s.client.agents.update("a1", { name: "n", revision: 3 });
  await s.client.agents.update("a1", { name: "n", revision: 3 }, { ifUnmodifiedSince: TOKEN });
  assertEquals(s.calls.map((c) => c.headers.get(H)), [null, TOKEN]);
  assertEquals(s.calls.map((c) => c.method), ["PATCH", "PATCH"]);
  assertEquals(s.calls[1].body, { name: "n", revision: 3 });
});

Deno.test("context.entries.update sends the precondition header and body revision", async () => {
  const s = setup(() => json({ entry: { id: "e1" } }));
  await s.client.context.entries.update("c1", "e1", { text: "t", revision: 2 }, {
    ifUnmodifiedSince: TOKEN,
  });
  await s.client.context.entries.update("c1", "e1", { text: "t", revision: 2 });
  assertEquals(new URL(s.calls[0].url).pathname, "/context-collections/c1/entries/e1");
  assertEquals(s.calls[0].method, "PUT");
  assertEquals(s.calls[0].headers.get(H), TOKEN);
  assertEquals(s.calls[0].body, { text: "t", revision: 2 });
  assertEquals(s.calls[1].headers.get(H), null);
});

Deno.test("409 is a typed conflict carrying the current revision; 428 a typed precondition error", async () => {
  const conflict = setup(() =>
    json({ error: { code: "revision_conflict", message: "stale", currentRevision: 7 } }, 409)
  );
  const e409 = await assertRejects(
    () => conflict.client.agents.update("a1", { revision: 1 }, { ifUnmodifiedSince: TOKEN }),
    ApiError,
  );
  assertEquals(e409.status, 409);
  assertEquals(e409.code, "revision_conflict");
  assertEquals(JSON.stringify(e409.raw).includes('"currentRevision":7'), true);

  const pre = setup(() =>
    json({ error: { code: "precondition_required", message: "need header" } }, 428)
  );
  const e428 = await assertRejects(
    () => pre.client.context.entries.update("c1", "e1", { text: "t", revision: 1 }),
    ApiError,
  );
  assertEquals([e428.status, e428.code], [428, "precondition_required"]);
  const e428b = await assertRejects(
    () => pre.client.agents.update("a1", { revision: 1 }),
    ApiError,
  );
  assertEquals(e428b.status, 428);
});

const ENTRY = { id: "e/1", collectionIds: ["c1"], visibility: "private", project: null };

Deno.test("contextEntries.list sends GET /context-entries with collectionId, includeArchived, project", async () => {
  const s = setup(() => json({ entries: [ENTRY] }));
  assertEquals(
    await s.client.contextEntries.list({
      collectionId: "c 1",
      includeArchived: true,
      project: "p1",
    }),
    [ENTRY] as never,
  );
  const u = new URL(s.calls[0].url);
  assertEquals([s.calls[0].method, u.pathname], ["GET", "/context-entries"]);
  assertEquals(Object.fromEntries(u.searchParams), {
    collectionId: "c 1",
    includeArchived: "true",
    project: "p1",
  });
  await s.client.contextEntries.list();
  assertEquals(new URL(s.calls[1].url).search, "");
});

Deno.test("contextEntries.create sends POST /context-entries with the body", async () => {
  const s = setup(() => json({ entry: ENTRY }, 201));
  const input = { name: "doc", text: "hi", collectionIds: ["c1"], visibility: "private" } as never;
  assertEquals(await s.client.contextEntries.create(input), ENTRY as never);
  assertEquals([s.calls[0].method, new URL(s.calls[0].url).pathname], ["POST", "/context-entries"]);
  assertEquals(s.calls[0].body, input);
});

Deno.test("contextEntries.get sends GET /context-entries/:id, id URL-encoded", async () => {
  const s = setup(() => json({ entry: ENTRY }));
  assertEquals(await s.client.contextEntries.get("e/1"), ENTRY as never);
  assertEquals(s.calls[0].method, "GET");
  assertEquals(new URL(s.calls[0].url).pathname, "/context-entries/e%2F1");
});

Deno.test("contextEntries.update sends PUT with body and precondition header", async () => {
  const s = setup(() => json({ entry: ENTRY }));
  await s.client.contextEntries.update("e/1", { text: "t", revision: 2 }, {
    ifUnmodifiedSince: TOKEN,
  });
  await s.client.contextEntries.update("e1", { text: "t", revision: 1 });
  assertEquals(s.calls[0].method, "PUT");
  assertEquals(new URL(s.calls[0].url).pathname, "/context-entries/e%2F1");
  assertEquals(s.calls[0].body, { text: "t", revision: 2 });
  assertEquals(s.calls[0].headers.get(H), TOKEN);
  assertEquals(s.calls[1].headers.get(H), null);
});

Deno.test("contextEntries.archive sends POST /context-entries/:id/archive", async () => {
  const s = setup(() => json({ entry: ENTRY }));
  assertEquals(await s.client.contextEntries.archive("e/1"), ENTRY as never);
  assertEquals(s.calls[0].method, "POST");
  assertEquals(new URL(s.calls[0].url).pathname, "/context-entries/e%2F1/archive");
});

Deno.test("contextEntries.addToCollection sends PUT /context-entries/:id/collections/:cid", async () => {
  const s = setup(() => json({ entry: ENTRY }));
  assertEquals(await s.client.contextEntries.addToCollection("e/1", "c/2"), ENTRY as never);
  assertEquals(s.calls[0].method, "PUT");
  assertEquals(new URL(s.calls[0].url).pathname, "/context-entries/e%2F1/collections/c%2F2");
});

Deno.test("contextEntries.removeFromCollection sends DELETE /context-entries/:id/collections/:cid", async () => {
  const s = setup(() => json({ entry: ENTRY }));
  assertEquals(await s.client.contextEntries.removeFromCollection("e/1", "c/2"), ENTRY as never);
  assertEquals(s.calls[0].method, "DELETE");
  assertEquals(new URL(s.calls[0].url).pathname, "/context-entries/e%2F1/collections/c%2F2");
});

Deno.test("ContextPin without collectionId and modelOptions typecheck", () => {
  const pin: import("../mod.ts").ContextPin = { entryId: "e1", assetVersionId: "v1" };
  const opts: import("../mod.ts").ModelOptions = { temperature: 0.2, stop: ["x"] };
  assertEquals([pin.collectionId, opts.temperature], [undefined, 0.2]);
});
