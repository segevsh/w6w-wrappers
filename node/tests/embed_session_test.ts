/**
 * `@w6w/sdk/server`'s `createEmbedSessionClient` (T2.1.1): construction
 * validation, the `create()` refusals, the exact wire shape, the curated
 * result, error/secret hygiene and the subpath-only export boundary.
 *
 * Driven through the real `exchangeToken` + `request` transport with a fake
 * `fetch`, like `tests/exchange_test.ts`.
 */

import { assert, assertEquals, assertInstanceOf, assertRejects, assertThrows } from "@std/assert";
import * as barrel from "../mod.ts";
import * as consoleBarrel from "../src/console/mod.ts";
import { ApiError, ConfigError } from "../src/errors.ts";
import type { FetchLike } from "../src/config.ts";
import { createEmbedSessionClient, type EmbedSessionClientOptions } from "../src/server/mod.ts";

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

const SECRET = "s3cr3t-DO-NOT-LEAK";
const ACCT = "acct_X1y2Z3a4B5c6D7e8";
const BASE = "https://api.example.com";

const SUCCESS_BODY = {
  token: "tok_short_lived",
  user: { subject: "u1", tenant: "tn_1", role: "user", account: ACCT },
  expiresIn: 900,
};

function opts(over: Partial<EmbedSessionClientOptions> & { fetch: FetchLike }) {
  return { baseUrl: BASE, clientId: "client_1", clientSecret: SECRET, ...over };
}

/** Nothing the caller might log may carry the secret. */
function assertNoSecret(err: unknown): void {
  const e = err as Error;
  assert(!e.message.includes(SECRET), "message leaks the secret");
  assert(!String(err).includes(SECRET), "String(err) leaks the secret");
  assert(!JSON.stringify(err).includes(SECRET), "JSON.stringify(err) leaks the secret");
}

// ---------------------------------------------------------------------------
// acc.1 — construction
// ---------------------------------------------------------------------------

const BAD_CONSTRUCTION: Array<[string, Record<string, unknown>]> = [
  ["missing baseUrl", { baseUrl: undefined }],
  ["blank baseUrl", { baseUrl: "   " }],
  ["relative baseUrl", { baseUrl: "/api" }],
  ["blank clientId", { clientId: " " }],
  ["missing clientId", { clientId: undefined }],
  ["blank clientSecret", { clientSecret: "" }],
  ["missing clientSecret", { clientSecret: undefined }],
  ["clientId containing a colon", { clientId: "a:b" }],
  ["non-latin-1 clientId", { clientId: "cli€nt" }],
  ["non-latin-1 clientSecret", { clientSecret: `${SECRET}€` }],
];

for (const [name, over] of BAD_CONSTRUCTION) {
  Deno.test(`createEmbedSessionClient: ${name} throws ConfigError, no request, no secret`, () => {
    const fake = fakeFetch(() => json(SUCCESS_BODY));
    const err = assertThrows(
      () => createEmbedSessionClient({ ...opts({ fetch: fake.fetch }), ...over } as never),
      ConfigError,
    );
    assertNoSecret(err);
    assertEquals(fake.calls.length, 0);
  });
}

Deno.test("createEmbedSessionClient: a missing baseUrl does NOT fall back to W6W_BASE_URL", () => {
  const saved = Deno.env.get("W6W_BASE_URL");
  Deno.env.set("W6W_BASE_URL", "https://env.example.com");
  try {
    const fake = fakeFetch(() => json(SUCCESS_BODY));
    assertThrows(
      () =>
        createEmbedSessionClient({ ...opts({ fetch: fake.fetch }), baseUrl: undefined } as never),
      ConfigError,
      "baseUrl",
    );
    assertEquals(fake.calls.length, 0);
  } finally {
    if (saved === undefined) Deno.env.delete("W6W_BASE_URL");
    else Deno.env.set("W6W_BASE_URL", saved);
  }
});

Deno.test("createEmbedSessionClient: refuses a browser-like runtime (window + document)", () => {
  const g = globalThis as Record<string, unknown>;
  const hadWindow = "window" in g;
  const hadDocument = "document" in g;
  const savedWindow = g.window;
  const savedDocument = g.document;
  const fake = fakeFetch(() => json(SUCCESS_BODY));
  try {
    g.window = {};
    g.document = {};
    const err = assertThrows(
      () => createEmbedSessionClient(opts({ fetch: fake.fetch })),
      ConfigError,
    );
    assertNoSecret(err);
  } finally {
    if (hadWindow) g.window = savedWindow;
    else delete g.window;
    if (hadDocument) g.document = savedDocument;
    else delete g.document;
  }
  // Restored: it constructs again.
  assertEquals(typeof createEmbedSessionClient(opts({ fetch: fake.fetch })).create, "function");
  assertEquals(fake.calls.length, 0);
});

Deno.test("createEmbedSessionClient: only window (no document) is not a browser", () => {
  const g = globalThis as Record<string, unknown>;
  const hadWindow = "window" in g;
  const savedWindow = g.window;
  try {
    g.window = {};
    createEmbedSessionClient(opts({ fetch: fakeFetch(() => json(SUCCESS_BODY)).fetch }));
  } finally {
    if (hadWindow) g.window = savedWindow;
    else delete g.window;
  }
});

// ---------------------------------------------------------------------------
// acc.2 — create() refusals
// ---------------------------------------------------------------------------

const BAD_REFS: Array<[string, unknown]> = [
  ["undefined", undefined],
  ["empty", ""],
  ["whitespace", "   "],
  ["a number", 7],
  ["null", null],
  ["an object", {}],
];

for (const [name, ref] of BAD_REFS) {
  Deno.test(`create(): accountRef ${name} throws ConfigError with zero requests`, async () => {
    const fake = fakeFetch(() => json(SUCCESS_BODY));
    const client = createEmbedSessionClient(opts({ fetch: fake.fetch }));
    const err = await assertRejects(
      () => client.create({ subject: "u1", accountRef: ref as string }),
      ConfigError,
    );
    assertNoSecret(err);
    assertEquals(fake.calls.length, 0);
  });
}

for (const subject of ["", "  ", undefined, 5]) {
  Deno.test(`create(): subject ${JSON.stringify(subject) ?? "undefined"} throws ConfigError with zero requests`, async () => {
    const fake = fakeFetch(() => json(SUCCESS_BODY));
    const client = createEmbedSessionClient(opts({ fetch: fake.fetch }));
    const err = await assertRejects(
      () => client.create({ subject: subject as string, accountRef: "co-9" }),
      ConfigError,
    );
    assertNoSecret(err);
    assertEquals(fake.calls.length, 0);
  });
}

Deno.test("create(): a missing input object is a ConfigError, not a TypeError", async () => {
  const fake = fakeFetch(() => json(SUCCESS_BODY));
  const client = createEmbedSessionClient(opts({ fetch: fake.fetch }));
  await assertRejects(() => client.create(undefined as never), ConfigError);
  assertEquals(fake.calls.length, 0);
});

// ---------------------------------------------------------------------------
// acc.3 — wire + shape
// ---------------------------------------------------------------------------

Deno.test("create(): one POST /auth/exchange, Basic header, exact body, curated 7-key result", async () => {
  const fake = fakeFetch(() =>
    json({ ...SUCCESS_BODY, user: { ...SUCCESS_BODY.user, subject: "u1" } })
  );
  const client = createEmbedSessionClient(
    opts({ fetch: fake.fetch, now: () => 1_700_000_000_000 }),
  );

  const session = await client.create({ subject: "u1", accountRef: "  co-9  " });

  assertEquals(fake.calls.length, 1);
  assertEquals(fake.calls[0].method, "POST");
  assertEquals(fake.calls[0].url, `${BASE}/auth/exchange`);
  assertEquals(
    fake.calls[0].headers.get("authorization"),
    `Basic ${btoa(`client_1:${SECRET}`)}`,
  );
  assertEquals(fake.calls[0].body, '{"subject":"u1","account":"co-9"}');

  assertEquals(Object.keys(session).sort(), [
    "account",
    "accountRef",
    "expiresAt",
    "expiresIn",
    "subject",
    "tenant",
    "token",
  ]);
  assertEquals(session, {
    token: "tok_short_lived",
    expiresIn: 900,
    expiresAt: "2023-11-14T22:28:20.000Z",
    subject: "u1",
    tenant: "tn_1",
    account: ACCT,
    accountRef: "co-9",
  });
  assert(!JSON.stringify(session).includes(SECRET));
});

Deno.test("create(): subject is sent verbatim, never trimmed", async () => {
  const fake = fakeFetch(() => json(SUCCESS_BODY));
  const client = createEmbedSessionClient(opts({ fetch: fake.fetch }));
  await client.create({ subject: " u1 ", accountRef: "co-9" });
  assertEquals(fake.calls[0].body, '{"subject":" u1 ","account":"co-9"}');
});

Deno.test("create(): the clock is sampled BEFORE the request", async () => {
  let t = 1_700_000_000_000;
  const fake = fakeFetch(() => {
    t += 60_000; // the exchange "takes" a minute; expiresAt must not include it
    return json(SUCCESS_BODY);
  });
  const client = createEmbedSessionClient(opts({ fetch: fake.fetch, now: () => t }));
  const session = await client.create({ subject: "u1", accountRef: "co-9" });
  assertEquals(session.expiresAt, "2023-11-14T22:28:20.000Z");
});

Deno.test("create(): the default clock is Date.now", async () => {
  const fake = fakeFetch(() => json(SUCCESS_BODY));
  const client = createEmbedSessionClient(opts({ fetch: fake.fetch }));
  const before = Date.now();
  const session = await client.create({ subject: "u1", accountRef: "co-9" });
  const at = Date.parse(session.expiresAt);
  assert(at >= before + 900_000 && at <= Date.now() + 900_000);
});

for (
  const [name, body] of [
    ["no user", { token: "t", expiresIn: 900 }],
    ["non-numeric expiresIn", { ...SUCCESS_BODY, expiresIn: "900" }],
    ["absurd expiresIn", { ...SUCCESS_BODY, expiresIn: 1e300 }],
    ["no token", { ...SUCCESS_BODY, token: undefined }],
  ] as Array<[string, unknown]>
) {
  Deno.test(`create(): a malformed exchange response (${name}) is an ApiError bad_response`, async () => {
    const fake = fakeFetch(() => json(body));
    const client = createEmbedSessionClient(opts({ fetch: fake.fetch }));
    const err = await assertRejects(
      () => client.create({ subject: "u1", accountRef: "co-9" }),
      ApiError,
    );
    assertEquals(err.code, "bad_response");
    assertNoSecret(err);
  });
}

// ---------------------------------------------------------------------------
// acc.4 — errors and secrets
// ---------------------------------------------------------------------------

for (
  const [status, code] of [
    [401, "invalid_client"],
    [401, "tenant_disabled"],
    [400, "invalid_account"],
    [429, "rate_limited"],
  ] as Array<[number, string]>
) {
  Deno.test(`create(): server ${code} (${status}) surfaces as ApiError with that status+code`, async () => {
    const fake = fakeFetch(() => json({ error: { code, message: `server says ${code}` } }, status));
    const client = createEmbedSessionClient(opts({ fetch: fake.fetch }));
    const err = await assertRejects(
      () => client.create({ subject: "u1", accountRef: "co-9" }),
      ApiError,
    );
    assertInstanceOf(err, ApiError);
    assertEquals(err.status, status);
    assertEquals(err.code, code);
    assertNoSecret(err);
    assertEquals(fake.calls.length, 1);
  });
}

Deno.test("create(): a network failure is an ApiError that does not carry the secret", async () => {
  const fetch: FetchLike = () => Promise.reject(new TypeError(`boom`));
  const client = createEmbedSessionClient(opts({ fetch }));
  const err = await assertRejects(
    () => client.create({ subject: "u1", accountRef: "co-9" }),
    ApiError,
  );
  assertEquals(err.status, 0);
  assertNoSecret(err);
});

Deno.test("two instances with different credentials, called interleaved, each send their own header", async () => {
  const fake = fakeFetch(() => json(SUCCESS_BODY));
  const a = createEmbedSessionClient(
    opts({ fetch: fake.fetch, clientId: "client_a", clientSecret: "secret_a" }),
  );
  const b = createEmbedSessionClient(
    opts({ fetch: fake.fetch, clientId: "client_b", clientSecret: "secret_b" }),
  );

  await a.create({ subject: "u1", accountRef: "co-1" });
  await b.create({ subject: "u1", accountRef: "co-2" });
  await a.create({ subject: "u2", accountRef: "co-1" });

  const auth = fake.calls.map((c) => c.headers.get("authorization"));
  assertEquals(auth, [
    `Basic ${btoa("client_a:secret_a")}`,
    `Basic ${btoa("client_b:secret_b")}`,
    `Basic ${btoa("client_a:secret_a")}`,
  ]);
});

// ---------------------------------------------------------------------------
// acc.6 — barrels
// ---------------------------------------------------------------------------

Deno.test("createEmbedSessionClient is not a key of ../mod.ts or ../src/console/mod.ts", () => {
  assertEquals("createEmbedSessionClient" in barrel, false);
  assertEquals("createEmbedSessionClient" in consoleBarrel, false);
});

Deno.test("createEmbedSessionClient is a function on its own subpath module", () => {
  assertEquals(typeof createEmbedSessionClient, "function");
});
