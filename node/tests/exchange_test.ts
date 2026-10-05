/**
 * `@w6w/sdk/server`'s `exchangeToken` (T1.1.2): the Basic-only credential
 * rule (P-5), the exact body shape, the server error mapping, and the
 * subpath-only export boundary (R-5).
 *
 * Exercised against the real {@linkcode request} transport through a fake
 * `fetch`, exactly like `tests/auth_options_test.ts` — no live server, no new
 * test infrastructure.
 */

import { assertEquals, assertRejects } from "@std/assert";
import * as barrel from "../mod.ts";
import * as consoleBarrel from "../src/console/mod.ts";
import { ConfigError } from "../src/errors.ts";
import { exchangeToken } from "../src/server/mod.ts";
import type { FetchLike } from "../src/config.ts";
import { ApiError } from "../mod.ts";

/** One recorded call to the fake transport. */
interface Call {
  url: string;
  method: string | undefined;
  headers: Headers;
  body: string | null;
}

function fakeFetch(respond: (call: Call) => Response): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = (input, init) => {
    const call: Call = {
      url: input,
      method: init?.method,
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? init.body : null,
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

const SUCCESS_BODY = {
  token: "tok_short_lived",
  user: { subject: "user_1", tenant: "tn_1", role: "user", account: "tn_1" },
  expiresIn: 900,
};

// ---------------------------------------------------------------------------
// acc.1 — the wire shape: Basic header, exact body, no query string
// ---------------------------------------------------------------------------

Deno.test(
  "exchangeToken: POST /auth/exchange, Authorization: Basic, body exactly {subject}, no query string",
  async () => {
    const fake = fakeFetch(() => json(SUCCESS_BODY));

    const result = await exchangeToken({
      baseUrl: "https://api.example.com",
      clientId: "client_1",
      clientSecret: "secret_1",
      subject: "user_1",
      fetch: fake.fetch,
    });

    assertEquals(fake.calls.length, 1);
    assertEquals(fake.calls[0].method, "POST");
    // No query string anywhere — a bare path, nothing appended.
    assertEquals(fake.calls[0].url, "https://api.example.com/auth/exchange");
    // base64("client_1:secret_1"), computed independently (python3 base64.b64encode).
    assertEquals(fake.calls[0].headers.get("authorization"), "Basic Y2xpZW50XzE6c2VjcmV0XzE=");
    assertEquals(fake.calls[0].body, '{"subject":"user_1"}');

    assertEquals(result.token, "tok_short_lived");
    assertEquals(result.user.subject, "user_1");
    assertEquals(result.user.tenant, "tn_1");
    assertEquals(result.user.role, "user");
    assertEquals(result.user.account, "tn_1");
    assertEquals(result.expiresIn, 900);
  },
);

Deno.test(
  "exchangeToken: `account`, when given, is the ONLY extra body key — never null/undefined when omitted",
  async () => {
    const fake = fakeFetch(() => json(SUCCESS_BODY));

    await exchangeToken({
      baseUrl: "https://api.example.com",
      clientId: "client_1",
      clientSecret: "secret_1",
      subject: "user_1",
      account: "acct_9",
      fetch: fake.fetch,
    });

    assertEquals(fake.calls[0].body, '{"subject":"user_1","account":"acct_9"}');
  },
);

// ---------------------------------------------------------------------------
// acc.2, acc.4 — latin-1-only Basic encoding; never UTF-8
// ---------------------------------------------------------------------------

Deno.test(
  "exchangeToken: a latin-1 non-ASCII secret is Basic-encoded as latin-1, never UTF-8",
  async () => {
    const fake = fakeFetch(() => json(SUCCESS_BODY));

    await exchangeToken({
      baseUrl: "https://api.example.com",
      clientId: "client_1",
      clientSecret: "pass_é", // "pass_é" — U+00E9, inside latin-1 (0x00-0xFF)
      subject: "user_1",
      fetch: fake.fetch,
    });

    // base64(latin1("client_1:pass_é")), computed independently (python3
    // base64.b64encode("client_1:pass_é".encode("latin-1"))). The UTF-8
    // encoding of the same string base64s to a DIFFERENT value
    // ("Y2xpZW50XzE6cGFzc1/DqQ=="), so this line is what a UTF-8 regression
    // turns red.
    assertEquals(fake.calls[0].headers.get("authorization"), "Basic Y2xpZW50XzE6cGFzc1/p");
  },
);

Deno.test(
  "exchangeToken: a clientSecret outside latin-1 raises a local ConfigError, never reaching the network",
  async () => {
    const fake = fakeFetch(() => json(SUCCESS_BODY));

    const err = await assertRejects(
      () =>
        exchangeToken({
          baseUrl: "https://api.example.com",
          clientId: "client_1",
          clientSecret: "s3cr3t_DO_NOT_LEAK_中", // U+4E2D is outside latin-1
          subject: "user_1",
          fetch: fake.fetch,
        }),
      ConfigError,
    );
    assertEquals(fake.calls.length, 0);
    assertEquals(err.message.includes("DO_NOT_LEAK"), false);
  },
);

// ---------------------------------------------------------------------------
// acc.2 — clientId/":" rejection, never echoing clientSecret
// ---------------------------------------------------------------------------

Deno.test(
  "exchangeToken: a clientId containing ':' raises a local ConfigError before any network call",
  async () => {
    const fake = fakeFetch(() => json(SUCCESS_BODY));

    const err = await assertRejects(
      () =>
        exchangeToken({
          baseUrl: "https://api.example.com",
          clientId: "tenant:with:colons",
          clientSecret: "s3cr3t_DO_NOT_LEAK",
          subject: "user_1",
          fetch: fake.fetch,
        }),
      ConfigError,
    );
    assertEquals(fake.calls.length, 0);
    assertEquals(err.message.includes("DO_NOT_LEAK"), false);
  },
);

// ---------------------------------------------------------------------------
// acc.2 — blank clientId/clientSecret/subject
// ---------------------------------------------------------------------------

Deno.test("exchangeToken: blank clientId/clientSecret/subject each raise a local ConfigError", async () => {
  const fake = fakeFetch(() => json(SUCCESS_BODY));
  const base = {
    baseUrl: "https://api.example.com",
    clientId: "client_1",
    clientSecret: "secret_1",
    subject: "user_1",
    fetch: fake.fetch,
  };

  await assertRejects(() => exchangeToken({ ...base, clientId: "   " }), ConfigError);
  await assertRejects(() => exchangeToken({ ...base, clientSecret: "" }), ConfigError);
  await assertRejects(() => exchangeToken({ ...base, subject: "  " }), ConfigError);
  assertEquals(fake.calls.length, 0);
});

// ---------------------------------------------------------------------------
// acc.3 — every server error surfaces as ApiError with the server's code;
// exactly ONE transport call (no recovery on a requireAuth:false request)
// ---------------------------------------------------------------------------

for (
  const [status, code] of [
    [401, "invalid_client"],
    [400, "invalid_body"],
    [400, "invalid_subject"],
    [400, "invalid_account"],
  ] as const
) {
  Deno.test(`exchangeToken: server ${code} (${status}) surfaces as ApiError with that code`, async () => {
    const fake = fakeFetch(() => json({ error: { code, message: "nope" } }, status));

    const err = await assertRejects(
      () =>
        exchangeToken({
          baseUrl: "https://api.example.com",
          clientId: "client_1",
          clientSecret: "secret_1",
          subject: "user_1",
          fetch: fake.fetch,
        }),
      ApiError,
    );
    assertEquals(err.status, status);
    assertEquals(err.code, code);
    // No retry, even for the 401: this call always passes requireAuth: false.
    assertEquals(fake.calls.length, 1);
  });
}

// ---------------------------------------------------------------------------
// acc.3/acc.4 — requireAuth: false in practice: no client token is ever
// required or sent, even with zero ambient configuration
// ---------------------------------------------------------------------------

Deno.test(
  "exchangeToken never requires (or sends) a bearer, even with no W6W_TOKEN configured anywhere",
  async () => {
    const saved = Deno.env.get("W6W_TOKEN");
    Deno.env.delete("W6W_TOKEN");
    try {
      const fake = fakeFetch(() => json(SUCCESS_BODY));
      // If `requireAuth` were accidentally left at its default (`true`), this
      // would throw ConfigError ("No w6w API token is configured…") before
      // ever reaching the transport, since no token is configured anywhere.
      const result = await exchangeToken({
        baseUrl: "https://api.example.com",
        clientId: "client_1",
        clientSecret: "secret_1",
        subject: "user_1",
        fetch: fake.fetch,
      });
      assertEquals(result.token, "tok_short_lived");
      assertEquals(fake.calls.length, 1);
      assertEquals(fake.calls[0].headers.has("authorization"), true);
      // Never a bearer — only ever the Basic credential this module built.
      assertEquals(fake.calls[0].headers.get("authorization")?.startsWith("Basic "), true);
    } finally {
      if (saved === undefined) Deno.env.delete("W6W_TOKEN");
      else Deno.env.set("W6W_TOKEN", saved);
    }
  },
);

// ---------------------------------------------------------------------------
// acc.5 — subpath-only: not on the root barrel, not on the console barrel
// ---------------------------------------------------------------------------

Deno.test("exchangeToken is not a key of ../mod.ts", () => {
  assertEquals("exchangeToken" in barrel, false);
});

Deno.test("exchangeToken is not a key of ../src/console/mod.ts", () => {
  assertEquals("exchangeToken" in consoleBarrel, false);
});

Deno.test("exchangeToken is reachable from its own subpath module and is a function", () => {
  assertEquals(typeof exchangeToken, "function");
});
