/**
 * `client.console.credentials.*`, against an injected fake `fetch`.
 *
 * Assertions are on the fake transport's recorded url/method/body and on
 * independent literals. `test` has no envelope and `ok: false` resolves;
 * `delete` never sends a query (no `force`, D-B5) and surfaces a 409 with the
 * server body intact on `raw`.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { W6WClient } from "../../src/client.ts";
import type { FetchLike } from "../../src/config.ts";
import { ApiError } from "../../src/errors.ts";
import type {
  CredentialDependents,
  CredentialErrorCode,
  CredentialStatus,
  CredentialSummary,
  CredentialTestResult,
} from "../../src/console/mod.ts";

interface Call {
  url: string;
  method: string | undefined;
  body: string | null;
}

function client(respond: (call: Call) => Response): { client: W6WClient; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = (input, init) => {
    const call = {
      url: input,
      method: init?.method,
      body: typeof init?.body === "string" ? init.body : null,
    };
    calls.push(call);
    return Promise.resolve(respond(call));
  };
  return {
    client: new W6WClient({ baseUrl: "https://api.example.com", token: "tok_1", fetch }),
    calls,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const CRED: CredentialSummary = {
  id: "cred_1",
  name: "Ops",
  contract: "api_key",
  status: "active",
  revision: 2,
  display: { label: "sk_…1234" },
  private: false,
  connectionCount: 3,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-02T00:00:00.000Z",
};

const BASE = "https://api.example.com";

Deno.test("credentials types: closed unions and no source key", () => {
  const s: CredentialStatus = "revoked";
  const code: CredentialErrorCode = "credential_invalid";
  const result: CredentialTestResult = { ok: false, code };
  const deps: CredentialDependents = { connections: [] };
  // @ts-expect-error the summary never carries a source payload
  const leaked = CRED.source;
  // @ts-expect-error the status union is closed
  const bad: CredentialStatus = "deleted";
  assertEquals([s, result.ok, deps.connections.length, leaked, bad].length, 5);
});

Deno.test("credentials: every method is a function on a constructed client", () => {
  const c = new W6WClient({ baseUrl: BASE, token: "t" });
  const names = [
    "list",
    "get",
    "create",
    "update",
    "rotate",
    "disable",
    "enable",
    "test",
    "dependents",
    "delete",
  ] as const;
  for (const n of names) assertEquals(typeof c.console.credentials[n], "function", n);
});

Deno.test("credentials.list with no filter sends no query string", async () => {
  const c = client(() => json({ credentials: [CRED] }));
  const res = await c.client.console.credentials.list();
  assertEquals(res, [CRED]);
  assertEquals(c.calls[0].method, "GET");
  assertEquals(c.calls[0].url, `${BASE}/credentials`);
});

Deno.test("credentials.list sends exactly the defined filter keys", async () => {
  const c = client(() => json({ credentials: [] }));
  await c.client.console.credentials.list({ appId: "gmail", authKey: "sa" });
  assertEquals(c.calls[0].url, `${BASE}/credentials?appId=gmail&authKey=sa`);
});

Deno.test("credentials.list with {contract} sends only contract", async () => {
  const c = client(() => json({ credentials: [] }));
  await c.client.console.credentials.list({ contract: "api_key", appId: undefined });
  assertEquals(c.calls[0].url, `${BASE}/credentials?contract=api_key`);
});

Deno.test("credentials.get unwraps the credential envelope and encodes the id", async () => {
  const c = client(() => json({ credential: CRED }));
  const res = await c.client.console.credentials.get("cred/x");
  assertEquals(res, CRED);
  assertEquals(c.calls[0].method, "GET");
  assertEquals(c.calls[0].url, `${BASE}/credentials/cred%2Fx`);
});

Deno.test("credentials.create forwards the body byte-equal and unwraps the 201", async () => {
  const c = client(() => json({ credential: CRED }, 201));
  const input = {
    name: "Ops",
    contract: "api_key",
    source: { key: "sk_live", nested: { a: [1] } },
  };
  const res = await c.client.console.credentials.create(input);
  assertEquals(res, CRED);
  assertEquals(c.calls[0].method, "POST");
  assertEquals(c.calls[0].url, `${BASE}/credentials`);
  assertEquals(c.calls[0].body, JSON.stringify(input));
});

Deno.test("credentials.update PATCHes {name} and unwraps credential", async () => {
  const c = client(() => json({ credential: { ...CRED, name: "New" } }));
  const res = await c.client.console.credentials.update("cred_1", { name: "New" });
  assertEquals(res.name, "New");
  assertEquals(c.calls[0].method, "PATCH");
  assertEquals(c.calls[0].url, `${BASE}/credentials/cred_1`);
  assertEquals(c.calls[0].body, '{"name":"New"}');
});

Deno.test("credentials.rotate forwards {source} verbatim", async () => {
  const c = client(() => json({ credential: { ...CRED, revision: 3 } }));
  const res = await c.client.console.credentials.rotate("cred_1", { source: { key: "new" } });
  assertEquals(res.revision, 3);
  assertEquals(c.calls[0].method, "POST");
  assertEquals(c.calls[0].url, `${BASE}/credentials/cred_1/rotate`);
  assertEquals(c.calls[0].body, '{"source":{"key":"new"}}');
});

Deno.test("credentials.disable POSTs /disable", async () => {
  const c = client(() => json({ credential: { ...CRED, status: "disabled" } }));
  const res = await c.client.console.credentials.disable("cred_1");
  assertEquals(res.status, "disabled");
  assertEquals(c.calls[0].method, "POST");
  assertEquals(c.calls[0].url, `${BASE}/credentials/cred_1/disable`);
});

Deno.test("credentials.enable POSTs /enable", async () => {
  const c = client(() => json({ credential: CRED }));
  const res = await c.client.console.credentials.enable("cred_1");
  assertEquals(res, CRED);
  assertEquals(c.calls[0].method, "POST");
  assertEquals(c.calls[0].url, `${BASE}/credentials/cred_1/enable`);
});

Deno.test("credentials.test returns the whole body; ok:false resolves", async () => {
  const body: CredentialTestResult = { ok: false, code: "credential_invalid", message: "nope" };
  const c = client(() => json(body));
  const res = await c.client.console.credentials.test("cred_1");
  assertEquals(res, body);
  assertEquals(c.calls[0].method, "POST");
  assertEquals(c.calls[0].url, `${BASE}/credentials/cred_1/test`);
});

Deno.test("credentials.test still rejects on a 404 unknown_credential", async () => {
  const c = client(() => json({ error: { code: "unknown_credential", message: "x" } }, 404));
  const err = await assertRejects(
    () => c.client.console.credentials.test("cred_9"),
    ApiError,
  );
  assertEquals(err.status, 404);
  assertEquals(err.code, "unknown_credential");
});

Deno.test("credentials.dependents unwraps the dependents envelope", async () => {
  const deps = {
    connections: [{ id: "conn_1", appId: "gmail", authKey: "sa", displayName: "G" }],
  };
  const c = client(() => json({ dependents: deps }));
  const res = await c.client.console.credentials.dependents("cred_1");
  assertEquals(res, deps);
  assertEquals(c.calls[0].method, "GET");
  assertEquals(c.calls[0].url, `${BASE}/credentials/cred_1/dependents`);
});

Deno.test("credentials.delete sends a bare DELETE (no query) and resolves undefined on 204", async () => {
  const c = client(() => new Response(null, { status: 204 }));
  const res = await c.client.console.credentials.delete("cred_1");
  assertEquals(res, undefined);
  assertEquals(c.calls[0].method, "DELETE");
  assertEquals(c.calls[0].url, `${BASE}/credentials/cred_1`);
});

Deno.test("credentials.delete 409 surfaces ApiError with nested dependents on raw", async () => {
  const body = {
    error: {
      code: "credential_in_use",
      message: "in use",
      dependents: {
        connections: [{ id: "conn_1", appId: "gmail", authKey: "sa", displayName: "G" }],
      },
    },
  };
  const c = client(() => json(body, 409));
  const err = await assertRejects(
    () => c.client.console.credentials.delete("cred_1"),
    ApiError,
  );
  assertEquals(err.status, 409);
  assertEquals(err.code, "credential_in_use");
  assertEquals(
    (err.raw as typeof body).error.dependents.connections[0].id,
    "conn_1",
  );
});
