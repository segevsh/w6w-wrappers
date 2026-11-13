/**
 * `client.console.aiKeys.*`, against an injected fake `fetch`: the request each
 * method builds (method, path, exact body) and its response handling.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { W6WClient } from "../../src/client.ts";
import type { FetchLike } from "../../src/config.ts";
import { ApiError } from "../../src/errors.ts";

interface Call {
  url: string;
  method: string | undefined;
  body: string | null;
}

function setup(respond: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetch: FetchLike = (input, init) => {
    calls.push({
      url: input,
      method: init?.method,
      body: typeof init?.body === "string" ? init.body : null,
    });
    return Promise.resolve(respond(calls[calls.length - 1]));
  };
  const client = new W6WClient({ baseUrl: "https://api.example.com", token: "tok", fetch });
  return { client, calls };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const BASE = "https://api.example.com";

const DEF = { providerAppId: "openai", connectionId: "conn_1", status: "active" };

Deno.test("aiKeys.defaults GETs /me/ai-keys/defaults and unwraps `defaults`", async () => {
  const c = setup(() => json({ defaults: [DEF] }));
  const res = await c.client.console.aiKeys.defaults();
  assertEquals(res, [DEF]);
  assertEquals(c.calls[0].method, "GET");
  assertEquals(c.calls[0].url, `${BASE}/me/ai-keys/defaults`);
  assertEquals(c.calls[0].body, null);
});

Deno.test("aiKeys.setDefault PUTs exactly {connectionId} and unwraps `default`", async () => {
  const c = setup(() => json({ default: DEF }));
  const res = await c.client.console.aiKeys.setDefault("open/ai", "conn_1");
  assertEquals(res, DEF);
  assertEquals(c.calls[0].method, "PUT");
  assertEquals(c.calls[0].url, `${BASE}/me/ai-keys/defaults/open%2Fai`);
  assertEquals(c.calls[0].body, JSON.stringify({ connectionId: "conn_1" }));
});

Deno.test("aiKeys.clearDefault DELETEs and resolves on 204", async () => {
  const c = setup(() => new Response(null, { status: 204 }));
  assertEquals(await c.client.console.aiKeys.clearDefault("openai"), undefined);
  assertEquals(c.calls[0].method, "DELETE");
  assertEquals(c.calls[0].url, `${BASE}/me/ai-keys/defaults/openai`);
  assertEquals(c.calls[0].body, null);
});

for (
  const [status, code] of [
    [403, "user_context_required"],
    [409, "credential_scope_mismatch"],
    [403, "ai_credential_policy_denied"],
  ] as const
) {
  Deno.test(`aiKeys.setDefault propagates ${code} unchanged`, async () => {
    const c = setup(() => json({ error: { code, message: "no" } }, status));
    const err = await assertRejects(
      () => c.client.console.aiKeys.setDefault("openai", "conn_1"),
      ApiError,
    );
    assertEquals(err.code, code);
    assertEquals(err.status, status);
  });
}
