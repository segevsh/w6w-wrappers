/**
 * The stale-write token on `client.functions.*` — `update` sends it as a header
 * only when given, and `create`/`update`/`get` hand the new token back.
 *
 * Fixtures carry `updatedAt` TOP-LEVEL ONLY, exactly as the server does: it is a
 * sibling of the `function` envelope, never a field inside it.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { W6WClient } from "../src/client.ts";
import type { FetchLike } from "../src/config.ts";
import { ApiError } from "../src/errors.ts";

const H = "x-w6w-if-unmodified-since";
const TOKEN = "2026-10-17T01:00:00.000Z";

interface Call {
  headers: Headers;
  body: string | null;
}

function client(respond: () => Response): { client: W6WClient; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = (_input, init) => {
    calls.push({
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? init.body : null,
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

const SAVED = { function: { id: "fn_1", key: "send-email" }, updatedAt: TOKEN };

Deno.test("functions.update sends the precondition header only when given", async () => {
  const c = client(() => json(SAVED, 201));
  const def = { key: "send-email", inputs: [] };

  await c.client.functions.update("fn_1", def);
  await c.client.functions.update("fn_1", def, {});
  await c.client.functions.update("fn_1", def, { ifUnmodifiedSince: null });
  await c.client.functions.update("fn_1", def, { ifUnmodifiedSince: "" });
  await c.client.functions.update("fn_1", def, { ifUnmodifiedSince: TOKEN });

  assertEquals(c.calls.map((x) => x.headers.get(H)), [null, null, null, null, TOKEN]);
});

Deno.test("functions.create and update return the TOP-LEVEL updatedAt with {id, key}", async () => {
  const c = client(() => json(SAVED, 201));

  const created = await c.client.functions.create({ key: "send-email", inputs: [] });
  const updated = await c.client.functions.update("fn_1", { key: "send-email", inputs: [] });

  assertEquals(created, { id: "fn_1", key: "send-email", updatedAt: TOKEN });
  assertEquals(updated, { id: "fn_1", key: "send-email", updatedAt: TOKEN });
});

Deno.test("functions.create never sends the precondition header", async () => {
  const c = client(() => json(SAVED, 201));

  await c.client.functions.create({ key: "send-email", inputs: [] });

  assertEquals(c.calls[0].headers.get(H), null);
});

Deno.test("functions.get exposes updatedAt as a sibling of valid, outside the definition", async () => {
  const stored = { key: "send-email", inputs: [] };
  const c = client(() => json({ function: stored, valid: true, updatedAt: TOKEN }));

  const res = await c.client.functions.get("fn_1");

  assertEquals(res, { function: stored, valid: true, updatedAt: TOKEN });
  assertEquals(Object.hasOwn(res.function, "updatedAt"), false);
});

Deno.test("functions.update rejects a stale write as ApiError 409 function_stale", async () => {
  const c = client(() =>
    json({ error: { code: "function_stale", message: "The Function changed." } }, 409)
  );

  const err = await assertRejects(
    () => c.client.functions.update("fn_1", { key: "k", inputs: [] }, { ifUnmodifiedSince: TOKEN }),
    ApiError,
  );

  assertEquals([err.status, err.code], [409, "function_stale"]);
});

Deno.test("functions.update surfaces 400 invalid_precondition as ApiError", async () => {
  const c = client(() => json({ error: { code: "invalid_precondition", message: "Bad." } }, 400));

  const err = await assertRejects(
    () => c.client.functions.update("fn_1", { key: "k", inputs: [] }, { ifUnmodifiedSince: "x" }),
    ApiError,
  );

  assertEquals([err.status, err.code], [400, "invalid_precondition"]);
});
