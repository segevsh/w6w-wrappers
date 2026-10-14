/**
 * The embed host example (`examples/embed-host/`): the trust rule that the
 * handler mints only from the host's VERIFIED session. Lives in `tests/` so
 * `deno task check` type-checks the example through these imports.
 */

import { assert, assertEquals, assertNotMatch } from "@std/assert";
import { ApiError } from "../src/errors.ts";
import type { FetchLike } from "../src/config.ts";
import {
  createEmbedSessionClient,
  type CreateEmbedSessionInput,
  type EmbedSession,
} from "../src/server/mod.ts";
import { createEmbedSessionHandler, type HostSession } from "../examples/embed-host/handler.ts";
import * as route from "../examples/embed-host/route.ts";

const SECRET = "s3cr3t-DO-NOT-LEAK";
const U1: HostSession = { userId: "u1", companyIds: ["A", "B"], activeCompanyId: "A" };

function recording(fail?: Error) {
  const calls: CreateEmbedSessionInput[] = [];
  const sessions = {
    create(input: CreateEmbedSessionInput): Promise<EmbedSession> {
      calls.push(input);
      if (fail) return Promise.reject(fail);
      return Promise.resolve({
        token: "tok",
        expiresIn: 900,
        expiresAt: "2026-01-01T00:15:00.000Z",
        subject: input.subject,
        tenant: "tn_1",
        account: "acct_X1y2Z3a4B5c6D7e8",
        accountRef: input.accountRef,
      });
    },
  };
  return { sessions, calls };
}

function post(body?: unknown, raw?: string): Request {
  return new Request("http://host/api/w6w-session", {
    method: "POST",
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
}

function handlerFor(session: HostSession | null, fail?: Error) {
  const rec = recording(fail);
  const handle = createEmbedSessionHandler({
    sessions: rec.sessions,
    authenticate: () => session,
  });
  return { ...rec, handle };
}

async function errorCode(res: Response): Promise<string> {
  return (await res.json()).error.code;
}

Deno.test("anonymous caller -> 401, no create, no-store", async () => {
  const h = handlerFor(null);
  const res = await h.handle(post({ company: "A" }));
  assertEquals(res.status, 401);
  assertEquals(await errorCode(res), "unauthenticated");
  assertEquals(res.headers.get("cache-control"), "no-store");
  assertEquals(h.calls.length, 0);
});

Deno.test("company the user does not belong to -> 403, no create", async () => {
  const h = handlerFor(U1);
  const res = await h.handle(post({ company: "C" }));
  assertEquals(res.status, 403);
  assertEquals(await errorCode(res), "company_forbidden");
  assertEquals(res.headers.get("cache-control"), "no-store");
  assertEquals(h.calls.length, 0);
});

Deno.test("no company anywhere -> 400, no create", async () => {
  const h = handlerFor({ userId: "u1", companyIds: ["A"] });
  for (const req of [post(), post(undefined, "{not json"), post({ company: "  " })]) {
    const res = await h.handle(req);
    assertEquals(res.status, 400);
    assertEquals(await errorCode(res), "company_required");
    assertEquals(res.headers.get("cache-control"), "no-store");
  }
  assertEquals(h.calls.length, 0);
});

Deno.test("non-POST -> 405, no create, authenticate not consulted", async () => {
  let authCalls = 0;
  const rec = recording();
  const handle = createEmbedSessionHandler({
    sessions: rec.sessions,
    authenticate: () => {
      authCalls++;
      return U1;
    },
  });
  for (const method of ["GET", "PUT", "DELETE"]) {
    const res = await handle(new Request("http://host/api/w6w-session", { method }));
    assertEquals(res.status, 405);
    assertEquals(res.headers.get("cache-control"), "no-store");
  }
  assertEquals(rec.calls.length, 0);
  assertEquals(authCalls, 0);
});

Deno.test("forged body subject/accountRef/account are never read", async () => {
  const h = handlerFor(U1);
  const res = await h.handle(
    post({ company: "B", subject: "admin", accountRef: "X", account: "X" }),
  );
  assertEquals(res.status, 200);
  assertEquals(h.calls, [{ subject: "u1", accountRef: "B" }]);
  assertEquals(res.headers.get("cache-control"), "no-store");
  const body = await res.json();
  assertEquals(body.accountRef, "B");
  assertEquals(body.subject, "u1");
  assertEquals("secret" in body, false);
});

Deno.test("forged account without a company hint falls back to the active company", async () => {
  const h = handlerFor(U1);
  const res = await h.handle(post({ subject: "admin", account: "X", company: 7 }));
  assertEquals(res.status, 200);
  assertEquals(h.calls, [{ subject: "u1", accountRef: "A" }]);
});

Deno.test("a forged account does not rescue a non-member company", async () => {
  const h = handlerFor(U1);
  const res = await h.handle(post({ company: "C", accountRef: "A", account: "A" }));
  assertEquals(res.status, 403);
  assertEquals(h.calls.length, 0);
});

Deno.test("create failure -> opaque 502 with no upstream detail", async () => {
  const err = new ApiError(401, "invalid_client", `Unknown client ${SECRET}`);
  const h = handlerFor(U1, err);
  const res = await h.handle(post({ company: "A" }));
  const raw = await res.text();
  assertEquals(res.status, 502);
  assertEquals(JSON.parse(raw), { error: { code: "session_unavailable" } });
  assertEquals(res.headers.get("cache-control"), "no-store");
  assertNotMatch(raw, /invalid_client|Unknown client|s3cr3t/);
  assertEquals(h.calls.length, 1);
});

Deno.test("authenticate throwing -> opaque 502, no create", async () => {
  const rec = recording();
  const handle = createEmbedSessionHandler({
    sessions: rec.sessions,
    authenticate: () => Promise.reject(new Error(`db down ${SECRET}`)),
  });
  const res = await handle(post({ company: "A" }));
  const raw = await res.text();
  assertEquals(res.status, 502);
  assertNotMatch(raw, /db down|s3cr3t/);
  assertEquals(rec.calls.length, 0);
});

Deno.test("switching companies mints one session per company, nothing cached", async () => {
  const h = handlerFor(U1);
  await h.handle(post({ company: "A" }));
  await h.handle(post({ company: "B" }));
  await h.handle(post({ company: "A" }));
  await h.handle(post({ company: "A" }));
  assertEquals(h.calls.map((c) => c.accountRef), ["A", "B", "A", "A"]);
});

Deno.test("real client at wire level: one exchange per POST, later expiresAt on renewal", async () => {
  const wire: { auth: string | null; body: string | null }[] = [];
  const fetch: FetchLike = (_url, init) => {
    wire.push({
      auth: new Headers(init?.headers).get("authorization"),
      body: typeof init?.body === "string" ? init.body : null,
    });
    return Promise.resolve(
      new Response(
        JSON.stringify({
          token: `tok_${wire.length}`,
          user: { subject: "u1", tenant: "tn_1", role: "user", account: "acct_X1y2Z3a4B5c6D7e8" },
          expiresIn: 900,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
  };
  let clock = Date.parse("2026-01-01T00:00:00.000Z");
  const handle = createEmbedSessionHandler({
    sessions: createEmbedSessionClient({
      baseUrl: "https://api.example.com",
      clientId: "client_1",
      clientSecret: SECRET,
      fetch,
      now: () => clock,
    }),
    authenticate: () => U1,
  });

  const first = await (await handle(post({ company: "B", subject: "admin", account: "X" }))).json();
  clock += 600_000;
  const second = await (await handle(post({ company: "B" }))).json();

  assertEquals(wire.length, 2);
  assertEquals(wire[0].body, JSON.stringify({ subject: "u1", account: "B" }));
  assert(wire[0].auth?.startsWith("Basic "));
  assertEquals(first.token, "tok_1");
  assertEquals(second.token, "tok_2");
  assert(Date.parse(second.expiresAt) > Date.parse(first.expiresAt));
  assertEquals(second.expiresAt, "2026-01-01T00:25:00.000Z");
});

const W6W_ENV = ["W6W_BASE_URL", "W6W_TENANT_CLIENT_ID", "W6W_TENANT_CLIENT_SECRET"];

/** Run `fn` with the W6W_* variables set to `values` (or all unset), then restore them. */
async function withW6wEnv(values: Record<string, string> | null, fn: () => Promise<void>) {
  const saved = W6W_ENV.map((k) => [k, Deno.env.get(k)] as const);
  try {
    for (const k of W6W_ENV) Deno.env.delete(k);
    for (const [k, v] of Object.entries(values ?? {})) Deno.env.set(k, v);
    await fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
  }
}

Deno.test("route.ts imports without throwing and exports POST", async () => {
  assertEquals(typeof route.POST, "function");
  // Without credentials in the environment the lazy build fails closed, opaquely.
  await withW6wEnv(null, async () => {
    const res = await route.POST(post({ company: "A" }));
    assertEquals(res.status, 502);
    assertEquals(await errorCode(res), "session_unavailable");
    assertEquals(res.headers.get("cache-control"), "no-store");
  });
});

Deno.test("route.ts configured: the stub authenticate refuses with 401 and never calls w6w", async () => {
  const realFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = (() => {
    fetches++;
    return Promise.reject(new Error("must not be called"));
  }) as typeof fetch;
  try {
    await withW6wEnv(
      {
        W6W_BASE_URL: "http://w6w.invalid",
        W6W_TENANT_CLIENT_ID: "client-id",
        W6W_TENANT_CLIENT_SECRET: SECRET,
      },
      async () => {
        const res = await route.POST(post({ company: "A" }));
        assertEquals(res.status, 401);
        assertEquals(await errorCode(res), "unauthenticated");
        assertEquals(res.headers.get("cache-control"), "no-store");
      },
    );
  } finally {
    globalThis.fetch = realFetch;
  }
  assertEquals(fetches, 0);
});

Deno.test("membership is exact: case and surrounding whitespace do not match", async () => {
  const h = handlerFor({ userId: "u1", companyIds: ["A"] });
  for (const company of ["a", " A", "A "]) {
    const res = await h.handle(post({ company }));
    assertEquals(res.status, 403, company);
    assertEquals(await errorCode(res), "company_forbidden");
  }
  assertEquals(h.calls.length, 0);
});

Deno.test("a blank hint falls back to the active company", async () => {
  const h = handlerFor(U1);
  for (const body of [{ company: "" }, { company: "   " }, { company: 7 }, {}]) {
    const res = await h.handle(post(body));
    assertEquals(res.status, 200);
  }
  assertEquals(h.calls, Array(4).fill({ subject: "u1", accountRef: "A" }));
});
