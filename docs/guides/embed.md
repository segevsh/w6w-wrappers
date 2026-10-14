---
id: null
key: "embed"
title: "Embed w6w in your product"
section: "guides"
description: "Mint an account-scoped w6w session for each signed-in user on your backend, hand it to the client, and renew it before it expires."
format: "markdown"
shared: true
sourceRepo: null
sourcePath: null
sourceSha: null
sourceRefSha: null
sourceUrl: null
syncedAt: null
createdAt: null
updatedAt: null
---

# Embed w6w in your product

When w6w runs inside your own product, each of your users calls it with their own short-lived
session token instead of one shared API token. This page shows how to mint those sessions on your
backend, hand them to the browser, and renew them before they expire.

A session is scoped to one **account**: the w6w account that holds one of your customers'
companies. Your backend names that account with your own company id (the `accountRef`), and w6w
answers with its own `acct_` id.

## Before you start

- Your organisation is set up as a w6w tenant, and you have its **client id** and **client
  secret**. These are issued when your tenant is provisioned.
- A backend you control. The client secret must never reach a browser or mobile app.
- `@w6w/sdk` installed on that backend. See the [Node SDK](/clients/node/) page. The session
  client, `createEmbedSessionClient`, ships in the first release after 0.9.10 that includes it.
  Earlier releases only have `exchangeToken` (see [the lower-level call](#the-lower-level-call)).
- Coming from an existing integration that already minted tokens with `exchangeToken`? Read
  [Migrating to embed sessions](/guides/embed-session-migration/) before you switch.

## 1. Add a session endpoint on your backend

`createEmbedSessionClient` holds your tenant credentials and mints one account-scoped session per
`create()` call. Import it from `@w6w/sdk/server`, which is meant for backends only; it refuses to
be created in a browser. Put it behind an endpoint that decides **who the user is and which company
they may act in from your own session**, never from what the browser sends.

The example in the SDK repository ([`node/examples/embed-host/`](https://github.com/w6w-io/w6w-wrappers/tree/main/node/examples/embed-host)) is a framework-neutral
`(Request) => Promise<Response>` handler plus a Next.js App Router adapter. The handler:

```ts
// handler.ts: builds no client, so importing it never reads the environment.
import type { EmbedSessionClient } from "@w6w/sdk/server";

// What YOUR sign-in knows about the caller. Build it from your server-side session.
interface HostSession {
  userId: string;
  companyIds: readonly string[]; // every company this user may act in
  activeCompanyId?: string;
}

export function createEmbedSessionHandler(o: {
  sessions: Pick<EmbedSessionClient, "create">;
  authenticate(req: Request): HostSession | null | Promise<HostSession | null>;
}) {
  return async (req: Request): Promise<Response> => {
    const reply = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      });
    if (req.method !== "POST") return reply(405, { error: { code: "method_not_allowed" } });
    try {
      const session = await o.authenticate(req);
      if (!session) return reply(401, { error: { code: "unauthenticated" } });

      // The browser's `company` is a hint, checked below. Never its subject or account.
      const hint = await req.json().then((b) => b?.company, () => undefined);
      const company = (typeof hint === "string" && hint.trim() !== "" ? hint : undefined) ??
        session.activeCompanyId;
      if (!company?.trim()) return reply(400, { error: { code: "company_required" } });
      if (!session.companyIds.includes(company)) {
        return reply(403, { error: { code: "company_forbidden" } });
      }

      return reply(200, await o.sessions.create({ subject: session.userId, accountRef: company }));
    } catch {
      // Opaque: no upstream message, code or secret reaches the browser. Log it here.
      return reply(502, { error: { code: "session_unavailable" } });
    }
  };
}
```

That listing is a condensed excerpt. The tested version is `node/examples/embed-host/handler.ts`,
and its tests pin every refusal below. Copy the file rather than retyping this one. Two edits make
the copied files work in a real Next.js app: in `route.ts`, import `./handler` without the `.ts`
extension (a default Next tsconfig rejects it with TS5097), and in `handler.ts`, change the
repo-relative type import (`../../src/server/mod.ts`) to the one shown above, from
`@w6w/sdk/server`.

On Next.js, the adapter is a `route.ts` that builds the client on the first request, so importing
it (for example during `next build`) never reads the environment, and exports `POST`:

```ts
// app/api/w6w-session/route.ts
import { createEmbedSessionClient } from "@w6w/sdk/server";
import { createEmbedSessionHandler } from "./handler"; // handler.ts, the file above

let handler: ReturnType<typeof createEmbedSessionHandler> | undefined;

export function POST(req: Request) {
  try {
    handler ??= createEmbedSessionHandler({
      sessions: createEmbedSessionClient({
        baseUrl: process.env.W6W_BASE_URL!,
        clientId: process.env.W6W_TENANT_CLIENT_ID!,
        clientSecret: process.env.W6W_TENANT_CLIENT_SECRET!, // stays on the server
      }),
      authenticate: yourSessionLookup, // replace with your session lookup
    });
  } catch {
    // Missing or malformed credentials: log the ConfigError on your server.
    return Promise.resolve(
      Response.json({ error: { code: "session_unavailable" } }, {
        status: 502,
        headers: { "cache-control": "no-store" },
      }),
    );
  }
  return handler(req);
}
```

See [Next.js and token minting](/clients/react/nextjs/) for the full walk-through. The handler
refuses, in this order and before it ever contacts w6w:

| Step | Refusal | Status |
| --- | --- | --- |
| Method is not `POST` | `method_not_allowed` | 405 |
| No signed-in user | `unauthenticated` | 401 |
| No company in the hint or the session | `company_required` | 400 |
| Company is not one of the user's `companyIds` | `company_forbidden` | 403 |

A successful call returns the session: `{ token, expiresIn, expiresAt, subject, tenant, account,
accountRef }`. `expiresAt` is an ISO-8601 string computed on your host. It holds no client secret
and no role, so it is safe to hand to the browser. Every response carries `Cache-Control:
no-store`.

> **Good to know:** w6w trusts the `accountRef` you pass. Look the company up from your own
> records for the signed-in user. Never take it, or the `subject`, from a value the browser sends
> you without checking it. The `company` hint is accepted only if it is one of the user's
> `companyIds`, and the `subject` always comes from your session.

`create()` raises `ConfigError` before any request when `subject` or `accountRef` is blank, so a
missing company can never fall back to your tenant's default account.

### `accountRef` and the account it resolves to

`accountRef` is **your external company id**. Send it stable and verbatim: the same id always
resolves to the same w6w account, and a different spelling is a different account. The server
trims surrounding whitespace on the reference and nothing else.

The first time w6w sees an `accountRef` for your tenant, it **provisions an empty account** for it.
That is how a new customer company is onboarded, and also why a typo silently creates a new, empty
account instead of failing. The same `accountRef` under another tenant is a different account.

The `account` in the session is w6w's own id for it, an `acct_…` value. Persist it next to your
company record and compare it later, for example to confirm that a reference still points at the
account you expect.

### Company switching

A user who belongs to several companies switches by calling your endpoint with the other company
in the body: `{ "company": "B" }`. Your endpoint validates it against `companyIds` and returns a
session for the new account. Each company gets its own session; replace the browser's cached one
when the user switches.

### Renewal

Session tokens are not refreshable. When one expires, call your host endpoint again for a new one;
every call is a fresh exchange, so do not cache sessions on the server. The lifetime is the server's
`AUTH_EXCHANGE_TTL_SEC`, **900 seconds by default**, and it applies to the whole deployment. Read
`expiresAt` rather than assuming a number.

### Credentials and rotation

The issued client id and client secret stay on your server, in environment variables that are never
exposed to client code. When the secret is rotated, the previous secret keeps working for
`TENANT_SECRET_ROTATION_OVERLAP_SEC`, **86400 seconds (24 hours) by default**, so you can roll it
out without downtime. Update `W6W_TENANT_CLIENT_SECRET` within that window.

Malformed credentials (a blank value, or a client id containing `:`) raise `ConfigError` when you
create the client, before any request is sent.

### What a session token can do

- It acts as one user (`subject`) inside one account.
- Most data is **account-scoped**: a session for another account, even of the same tenant, cannot
  see it. That is not true of every record. Some belong to the `subject` and are not filtered by
  account, for example invocation records (the run record behind each `invocationId`, including the
  call's inputs) and the API-call log (each outbound request an app action makes, with its redacted
  request and response bodies). A user who holds sessions for two of your companies can read their
  own such records from either, so do not treat the account as a confidentiality wall between
  companies that share a user.
- Inside one account, the server decides **per resource class** whether a resource is shared by
  the account's users or private to the subject that created it, and you cannot configure that.
  Today, for example, workflows and functions are shared by every user of the account, while
  variables and documents that they create are visible only to the subject that created them (another user of the
  same account gets a `404`). Do not build on this split: it can change per class.
- There are **no fine-grained grants**: the session does not carry per-resource permissions.
- There is **no per-user privacy promise**. Do not store anything in an account that one of its
  other users must not see.

### The lower-level call

`exchangeToken` is still available from `@w6w/sdk/server`. It makes the same `POST /auth/exchange`
call but returns the raw `{ token, user, expiresIn }`, and its `account` is optional: leaving it
out lands the token in your tenant's default account. Use it when you deliberately want that. For
anything per-company, use the session client, which has no such fallback.

OIDC sign-in remains supported as the other way to get a user's token; it is documented with your
tenant's identity-provider setup.

## 2. Give the client a token supplier

Instead of a fixed string, pass `token` a function. The client calls it for each request that starts,
so a renewed session is picked up on the next call without rebuilding the client. Requests in flight
at the same time share ONE supplier call, but nothing is cached once it settles, so **memoize your
supplier** (as below) rather than minting a token on every call:

```ts
import { W6WClient } from "@w6w/sdk";

type Cached = { token: string; expiresAt: string };
let cached: Cached | undefined;

const client = new W6WClient({
  baseUrl: process.env.W6W_BASE_URL,
  token: async ({ forceRefresh } = {}) => {
    if (forceRefresh || !cached || Date.parse(cached.expiresAt) - Date.now() < 30_000) {
      // Calls YOUR host endpoint from section 1. It returns the session JSON.
      const res = await fetch("/api/w6w-session", { method: "POST" });
      if (!res.ok) return null;
      cached = (await res.json()) as Cached;
    }
    return cached.token;
  },
});
```

The supplier can be sync or async. If it returns `null`, `undefined` or an empty string, the call
raises `ConfigError` instead of being sent without a credential.

## 3. Recover from an expired token

Turn on `refreshOnUnauthorized` to retry once when a token turns out to be expired. When a request
fails with `401 unauthorized`, the client calls your supplier again with `{ forceRefresh: true }`
and resends the same request with the new token. For an embedded session that means calling your
host endpoint again (see [Renewal](#renewal)). Use `onUnauthorized` to react when that doesn't
help:

```ts
const client = new W6WClient({
  baseUrl: process.env.W6W_BASE_URL,
  token: supplier,
  refreshOnUnauthorized: true,
  onUnauthorized: (err) => {
    console.warn("w6w rejected the token:", err.message);
    // for example, sign the user out
  },
});
```

The retry happens at most once per call, and only for `401` with code `unauthorized`. Nothing else
is retried. `onUnauthorized` runs at most once per call: after a failed retry, or straight away
when the token is a plain string or `refreshOnUnauthorized` is off.

## 4. Send extra headers on every request

If your tenant uses a custom authorizer, it may expect a header of its own on each request. Set
default headers once on the client:

```ts
const client = new W6WClient({
  baseUrl: process.env.W6W_BASE_URL,
  token: supplier,
  headers: { "X-W6W-Tenant": "<your-tenant-id>" },
});
```

A header you pass to a single `client.request()` call overrides a default with the same name.
Neither can replace the `Authorization` header the client sets from your token.

## 5. Show connection icons without walking the app catalog

Each connection the client returns can carry its app's display data inline, as `app`:
`{ displayName, iconSvg?, iconSvgDark?, brandColor?, brandColorDark? }` (or `null`). Render names
and icons straight from it. Do not call `apps.list()` on mount just to find icons: that walks the
whole catalog. For the rows that come back without `app`, fetch only those apps with
`client.console.apps.listPage({ ids })`.

In React, hooks that ask for the same thing while a request is in flight share one request, so
two components calling `useConnections()` (or StrictMode's double mount) send a single fetch.

## In the browser

Keep the session client and the client secret on your backend. In a React app, use
[`@w6w/react`](/clients/react/): its provider takes the same token supplier, and your supplier
fetches a session from your backend endpoint. See [Next.js and token minting](/clients/react/nextjs/).

## Troubleshooting

| Symptom | Cause | What to do |
| --- | --- | --- |
| `401 invalid_client` from `create()` | The client id or secret is wrong or unknown, or the tenant is disabled. The server gives one message for all of these on purpose, so a disabled tenant with valid credentials gets this too. | Check `W6W_TENANT_CLIENT_ID` and `W6W_TENANT_CLIENT_SECRET` against what you were issued, then check with w6w that the tenant is active. |
| `401 tenant_disabled` | Mostly on an API call made with a session token you already minted, once the tenant has been disabled. `create()` can also return it for a short while after a tenant is re-enabled, because w6w remembers a tenant's status for up to 30 seconds. | Nothing to change on your side. If the tenant was just re-enabled, retry in under a minute. If it stays, the tenant is disabled: new sessions fail with `invalid_client` (above), so check with w6w. |
| `400 invalid_subject` or `400 invalid_account` | Only from `exchangeToken` or a hand-written call to `/auth/exchange`. `create()` refuses a blank or non-string `subject` or `accountRef` itself and raises `ConfigError` before sending anything. | Send your user id as `subject` and your company id as `accountRef`, both non-blank strings. |
| `ConfigError` from `create()` or the factory | A value is blank (a blank `accountRef` is refused locally), the client id contains `:`, or the factory ran in a browser. | Check the environment variables are set on the backend and that `accountRef` is your company id. |
| `429 rate_limited` from `create()` | Too many exchanges for your client id. | Back off and try again later. Mint a session once per expiry instead of once per request. The error does not carry the server's `Retry-After` value. |
| Your endpoint returns `502 session_unavailable` | The exchange failed. The body is opaque by design. | Read the error in your server logs. |
| `ConfigError: No w6w API token is configured` on a call | Your supplier returned nothing. | Make sure it returns a token string, and handle the case where the user isn't signed in. |
| Calls keep failing with `401` after a refresh | The supplier returns the same expired token. | Call the host endpoint again when `forceRefresh` is `true`, instead of returning a cached session. |

## Where to next

- **[React](/clients/react/)**: the provider and hooks for your frontend.
- **[Next.js and token minting](/clients/react/nextjs/)**: a complete backend route plus provider
  setup.
- **[Migrating to embed sessions](/guides/embed-session-migration/)**: moving an existing
  `exchangeToken` integration over.
- **[Node SDK reference](/clients/node/reference/)**: every option on `W6WClient`.
