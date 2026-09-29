/**
 * `client.console.commerce.*`, against an injected fake `fetch`.
 *
 * Beyond the per-operation assertions, this suite pins the two things that
 * matter most: `plans()` is PUBLIC — it must never send a bearer, even on a
 * client that holds one, and it must succeed on a tokenless client rather
 * than throwing `ConfigError` (the actual bug `requireAuth: false` fixes,
 * mirroring `console.auth`'s public trio); `subscription()` is GUARDED and
 * must send the bearer like any other request. Both responses carry an
 * envelope key, unlike `console.dashboard`, so both methods must peel it via
 * `unwrap()` rather than returning `res.body` verbatim.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { W6WClient } from "../../src/client.ts";
import type { FetchLike } from "../../src/config.ts";
import type {
  AccountAllowance,
  AccountAllowanceCredits,
  AccountAllowanceLimits,
  CommerceSubscription,
  Invoice,
  Plan,
  PlanCapabilities,
  SupportLevel,
} from "../../src/console/commerce.ts";
import { ApiError } from "../../src/errors.ts";

/**
 * Compile-time-only: the exported `Invoice` type must carry EXACTLY the ten
 * pinned wire keys, no eleventh (in particular, never `raw`). A runtime test
 * cannot see an interface field — a `raw` field added to `Invoice` makes this
 * object literal fail `deno task check` with an excess-property error, since
 * `Record<keyof Invoice, true>` would then require (and this literal would
 * then over-supply) an eleventh key.
 */
const _INVOICE_KEYS: Record<keyof Invoice, true> = {
  id: true,
  number: true,
  status: true,
  amountDueCents: true,
  amountPaidCents: true,
  currency: true,
  hostedInvoiceUrl: true,
  issuedAt: true,
  dueAt: true,
  createdAt: true,
};
void _INVOICE_KEYS;

/**
 * Compile-time-only, mirroring `_INVOICE_KEYS`: `PlanCapabilities` must carry
 * EXACTLY these eleven keys, no twelfth and none dropped — a capability added
 * to control's wire type and not mirrored here (or vice versa) fails
 * `deno task check` with an excess/missing-property error.
 */
const _CAPABILITY_KEYS: Record<keyof PlanCapabilities, true> = {
  catalogImport: true,
  privateRegistry: true,
  implSwapAndConfig: true,
  versionPinsAndBlocks: true,
  egressCaptureExport: true,
  embeddedWhiteLabel: true,
  sso: true,
  auditLog: true,
  rbac: true,
  dataResidency: true,
  selfHostLicence: true,
};
void _CAPABILITY_KEYS;

/**
 * Compile-time-only: `SupportLevel` must carry EXACTLY these four literals —
 * a dropped, added or renamed arm fails `deno task check` here rather than
 * surfacing later as a blank/wrong Support row in Studio.
 */
const _SUPPORT_LEVELS: Record<SupportLevel, true> = {
  community: true,
  email: true,
  "email-1-business-day": true,
  "sla-named-contact-dpa": true,
};
void _SUPPORT_LEVELS;

/**
 * Compile-time-only, mirroring `_INVOICE_KEYS`: `AccountAllowance` must carry
 * EXACTLY these seven top-level keys, nested exactly as W-12 states them — a
 * flattened `credits`/`limits`, a dropped key, or an added key (e.g.
 * `reason?`) at this level fails `deno task check` with an excess/missing-
 * property error rather than surfacing later as a leaked operator-internal
 * field.
 */
const _ALLOWANCE_KEYS: Record<keyof AccountAllowance, true> = {
  month: true,
  executions: true,
  included: true,
  overage: true,
  credits: true,
  limits: true,
  customTerms: true,
};
void _ALLOWANCE_KEYS;

/**
 * Compile-time-only: `AccountAllowanceCredits` must carry EXACTLY these
 * three keys — an added `grants?`/`setBy?`/`grantedBy?` (operator-internal,
 * egress-pinned) fails `deno task check` here.
 */
const _ALLOWANCE_CREDIT_KEYS: Record<keyof AccountAllowanceCredits, true> = {
  granted: true,
  consumed: true,
  balance: true,
};
void _ALLOWANCE_CREDIT_KEYS;

/**
 * Compile-time-only: `AccountAllowanceLimits` must carry EXACTLY these eight
 * dimensions — a dropped one (e.g. `seats`) fails `deno task check` here.
 */
const _ALLOWANCE_LIMIT_KEYS: Record<keyof AccountAllowanceLimits, true> = {
  runs: true,
  parallelExecutions: true,
  monitors: true,
  monitorMinCadenceMinutes: true,
  retentionBodiesDays: true,
  retentionMetadataDays: true,
  projects: true,
  seats: true,
};
void _ALLOWANCE_LIMIT_KEYS;

/** One recorded call to the fake transport. */
interface Call {
  url: string;
  method: string | undefined;
  headers: Headers;
  body: string | null;
}

/** A `fetch`-shaped fake; `respond` produces the `Response` to hand back. */
function fakeFetch(respond: (call: Call) => Response): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = (input, init) => {
    calls.push({
      url: input,
      method: init?.method,
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? init.body : null,
    });
    return Promise.resolve(respond(calls[calls.length - 1]));
  };
  return { fetch, calls };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A realistic plan, matching every required field of `Plan`/`PlanLimits`. */
const PLAN: Plan = {
  key: "free",
  name: "Free",
  description: "Get started",
  rank: 0,
  retired: false,
  features: ["catalog"],
  limits: {
    quotas: {
      runs: { kind: "metered", included: 1000, per: 1000, unitAmount: 5 },
      parallelExecutions: { kind: "capped", included: 1 },
      monitors: { quota: { kind: "capped", included: 5 }, minCadenceMinutes: 15 },
      retention: { bodiesDays: 7, metadataDays: 30 },
      projects: { kind: "capped", included: 1 },
      seats: { kind: "capped", included: 1 },
    },
    capabilities: {
      catalogImport: false,
      privateRegistry: false,
      implSwapAndConfig: false,
      versionPinsAndBlocks: false,
      egressCaptureExport: false,
      embeddedWhiteLabel: false,
      sso: false,
      auditLog: false,
      rbac: false,
      dataResidency: false,
      selfHostLicence: { available: false, annualSurcharge: null },
    },
    support: "community",
  },
  price: { kind: "none" },
};

const SUBSCRIPTION: CommerceSubscription = { plan: "team", status: "active", canUpgrade: true };

/** A realistic invoice, matching every one of `Invoice`'s ten pinned fields. */
const INVOICE: Invoice = {
  id: "inv_5f3c",
  number: "A1B2C3-0001",
  status: "paid",
  amountDueCents: 4900,
  amountPaidCents: 4900,
  currency: "usd",
  hostedInvoiceUrl: "https://invoice.stripe.com/abc",
  issuedAt: "2026-09-01T00:00:00.000Z",
  dueAt: "2026-10-01T00:00:00.000Z",
  createdAt: "2026-09-01T00:00:00.000Z",
};

/** A realistic allowance, matching every one of W-12's seven pinned fields. */
const ALLOWANCE: AccountAllowance = {
  month: "2026-09",
  executions: 1234,
  included: 5000,
  overage: 0,
  credits: { granted: 1000000, consumed: 1500, balance: 998500 },
  limits: {
    runs: 5000,
    parallelExecutions: 1,
    monitors: 3,
    monitorMinCadenceMinutes: 60,
    retentionBodiesDays: 3,
    retentionMetadataDays: 30,
    projects: 1,
    seats: 2,
  },
  customTerms: true,
};

/** A client wired to a fake transport, WITH a token — the interesting case for `requireAuth`. */
function client(respond: (call: Call) => Response): { client: W6WClient; calls: Call[] } {
  const fake = fakeFetch(respond);
  return {
    client: new W6WClient({
      baseUrl: "https://api.example.com",
      token: "tok_1",
      fetch: fake.fetch,
    }),
    calls: fake.calls,
  };
}

Deno.test("console.commerce.plans() hits GET /commerce/plans and returns the ARRAY, not the envelope", async () => {
  const c = client(() => json({ plans: [PLAN] }));

  const result = await c.client.console.commerce.plans();

  // A `return res.body` implementation (no envelope peel) would resolve
  // `{ plans: [...] }` here — an object, not an array — and this fails.
  assertEquals(Array.isArray(result), true);
  assertEquals(result[0].key, "free");
  assertEquals(c.calls[0].method, "GET");
  assertEquals(c.calls[0].url, "https://api.example.com/commerce/plans");
});

Deno.test("console.commerce.plans() on a client WITH a token sends NO authorization header", async () => {
  const c = client(() => json({ plans: [PLAN] }));

  await c.client.console.commerce.plans();

  // A `requireAuth: true` (or omitted) implementation passes "returns the
  // plans" and dies precisely here.
  assertEquals(c.calls[0].headers.has("authorization"), false);
});

Deno.test("console.commerce.plans() on a TOKENLESS client succeeds rather than throwing ConfigError", async () => {
  const fake = fakeFetch(() => json({ plans: [PLAN] }));
  const anon = new W6WClient({ baseUrl: "https://api.example.com", fetch: fake.fetch }); // no token

  const result = await anon.console.commerce.plans();

  assertEquals(Array.isArray(result), true);
  assertEquals(result[0].key, "free");
});

Deno.test(
  "console.commerce.subscription() hits GET /commerce/subscription, DOES send the bearer, and unwraps",
  async () => {
    const c = client(() => json({ subscription: SUBSCRIPTION }));

    const result = await c.client.console.commerce.subscription();

    assertEquals(c.calls[0].method, "GET");
    assertEquals(c.calls[0].url, "https://api.example.com/commerce/subscription");
    assertEquals(c.calls[0].headers.get("authorization"), "Bearer tok_1");
    assertEquals(result.canUpgrade, true);
    assertEquals(result.plan, "team");
    assertEquals(result.status, "active");
  },
);

Deno.test(
  "console.commerce.invoices() hits GET /commerce/invoices (exact path) and unwraps the invoices envelope",
  async () => {
    const c = client(() => json({ invoices: [INVOICE] }));

    const result = await c.client.console.commerce.invoices();

    // Asserted against literals written independently of the method's own
    // return value — a `return res.body` implementation (no envelope peel)
    // or a wrong envelope key (`unwrap(res, "data")`) both fail here, either
    // by shape (not an array) or by throwing `ApiError` (missing key).
    assertEquals(Array.isArray(result), true);
    assertEquals(result.length, 1);
    assertEquals(result[0].id, "inv_5f3c");
    assertEquals(result[0].number, "A1B2C3-0001");
    assertEquals(result[0].status, "paid");
    assertEquals(result[0].amountDueCents, 4900);
    assertEquals(result[0].amountPaidCents, 4900);
    assertEquals(result[0].currency, "usd");
    assertEquals(result[0].hostedInvoiceUrl, "https://invoice.stripe.com/abc");
    assertEquals(result[0].issuedAt, "2026-09-01T00:00:00.000Z");
    assertEquals(result[0].dueAt, "2026-10-01T00:00:00.000Z");
    assertEquals(result[0].createdAt, "2026-09-01T00:00:00.000Z");
    assertEquals(c.calls[0].method, "GET");
    // Exact path, not a substring — `/commerce/invoice` (singular) must fail.
    assertEquals(c.calls[0].url, "https://api.example.com/commerce/invoices");
  },
);

Deno.test(
  "console.commerce.invoices() DOES send the bearer — default requireAuth, never public",
  async () => {
    const c = client(() => json({ invoices: [INVOICE] }));

    await c.client.console.commerce.invoices();

    // A `requireAuth: false` implementation (copying `plans()` instead of
    // `subscription()`) dies precisely here.
    assertEquals(c.calls[0].headers.get("authorization"), "Bearer tok_1");
  },
);

Deno.test("console.commerce: plans, subscription and invoices are functions on a constructed client", () => {
  // Runtime, not type-level: a namespace that silently lost a method would
  // still typecheck everywhere else in this suite.
  const c = new W6WClient({ baseUrl: "https://api.example.com", token: "t" });
  assertEquals(typeof c.console.commerce.plans, "function");
  assertEquals(typeof c.console.commerce.subscription, "function");
  assertEquals(typeof c.console.commerce.invoices, "function");
});

Deno.test(
  "console.commerce.allowance() hits GET /commerce/allowance, DOES send the bearer, sends no body, and unwraps",
  async () => {
    const c = client(() => json({ allowance: ALLOWANCE }));

    const result = await c.client.console.commerce.allowance();

    assertEquals(c.calls[0].method, "GET");
    assertEquals(c.calls[0].url, "https://api.example.com/commerce/allowance");
    assertEquals(c.calls[0].headers.get("authorization"), "Bearer tok_1");
    assertEquals(c.calls[0].body, null);
    // Asserted against an INDEPENDENT literal, never the `ALLOWANCE` fixture
    // variable — a `return res.body` implementation (no envelope peel) or a
    // wrong envelope key (`unwrap(res, "data")`) both fail here.
    assertEquals(result, {
      month: "2026-09",
      executions: 1234,
      included: 5000,
      overage: 0,
      credits: { granted: 1000000, consumed: 1500, balance: 998500 },
      limits: {
        runs: 5000,
        parallelExecutions: 1,
        monitors: 3,
        monitorMinCadenceMinutes: 60,
        retentionBodiesDays: 3,
        retentionMetadataDays: 30,
        projects: 1,
        seats: 2,
      },
      customTerms: true,
    });
  },
);

Deno.test(
  "console.commerce.allowance() rejects with ApiError on a 424 JSON reply and on a 404 text/plain reply",
  async () => {
    const c424 = client(() => json({ error: { code: "control_unavailable" } }, 424));
    const err424 = await assertRejects(
      () => c424.client.console.commerce.allowance(),
      ApiError,
    );
    assertEquals(err424.status, 424);
    assertEquals(err424.code, "control_unavailable");

    const c404 = client(() =>
      new Response("404 Not Found", { status: 404, headers: { "content-type": "text/plain" } })
    );
    const err404 = await assertRejects(
      () => c404.client.console.commerce.allowance(),
      ApiError,
    );
    assertEquals(err404.status, 404);
    assertEquals(err404.code, "bad_response");
  },
);
