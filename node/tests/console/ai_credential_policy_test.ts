/**
 * `client.console.aiCredentialPolicy.*`, against an injected fake `fetch`.
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

const BODY = { policy: { mode: "user_only" }, effect: { accountRoutes: 3 } };

Deno.test("aiCredentialPolicy.get GETs the path and returns the body unchanged", async () => {
  const c = setup(() => json(BODY));
  assertEquals(await c.client.console.aiCredentialPolicy.get(), BODY);
  assertEquals(c.calls[0].method, "GET");
  assertEquals(c.calls[0].url, `${BASE}/tenant/ai-credential-policy`);
  assertEquals(c.calls[0].body, null);
});

Deno.test("aiCredentialPolicy.put sends exactly {mode} and returns the body unchanged", async () => {
  const c = setup(() => json(BODY));
  assertEquals(await c.client.console.aiCredentialPolicy.put({ mode: "user_only" }), BODY);
  assertEquals(c.calls[0].method, "PUT");
  assertEquals(c.calls[0].url, `${BASE}/tenant/ai-credential-policy`);
  assertEquals(c.calls[0].body, JSON.stringify({ mode: "user_only" }));
});

Deno.test("aiCredentialPolicy.put drops a smuggled extra key", async () => {
  const c = setup(() => json(BODY));
  const widened = { mode: "both", tenant: "other", ownerSubject: "x" } as { mode: "both" };
  await c.client.console.aiCredentialPolicy.put(widened);
  assertEquals(c.calls[0].body, JSON.stringify({ mode: "both" }));
});

Deno.test("aiCredentialPolicy.put propagates a 403 ApiError unchanged", async () => {
  const c = setup(() =>
    json({ error: { code: "ai_credential_policy_denied", message: "x" } }, 403)
  );
  const err = await assertRejects(
    () => c.client.console.aiCredentialPolicy.put({ mode: "both" }),
    ApiError,
  );
  assertEquals(err.code, "ai_credential_policy_denied");
});
