---
id: null
key: "embed"
title: "Embed w6w in your product"
section: "guides"
description: "Mint an account-scoped w6w session for each signed-in user on your backend, hand it to the client, renew it before it expires, and build workflow editors on the client."
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
backend, hand them to the browser, and renew them before they expire. It also covers showing
connection icons and building a workflow or Function editor.

A session is scoped to one **account**: the w6w account that holds one of your customers'
companies. Your backend names that account with your own company id (the `accountRef`), and w6w
answers with its own `acct_` id.

## Before you start

- Your organisation is set up as a w6w tenant, and you have its **client id** and **client
  secret**. These are issued when your tenant is provisioned.
- A backend you control. The client secret must never reach a browser or mobile app.
- `@w6w/sdk` installed on that backend. See the [Node SDK](/clients/node/) page. The session
  client, `createEmbedSessionClient`, arrived in `@w6w/sdk` 0.9.12, and the
  `getSession` recipe in section 2 needs `@w6w/react` and `@w6w/sdk` 0.9.13 or later.
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

## 2. Give the client a session

In a React app, hand `<W6WProvider>` one callback, `getSession`, that calls your endpoint from
section 1 and returns the session JSON. The provider calls it lazily, never more than once at a
time, keeps the session until shortly before it expires, and re-checks when a hidden tab becomes
visible (renewing only if the session is expired or inside the renew window). You write no cache, timer or tab-resume code. This needs `@w6w/react` and `@w6w/sdk`
0.9.13 or later.

```tsx
"use client";

import { W6WProvider, useW6WSession } from "@w6w/react";
import type { ReactNode } from "react";

async function getSession() {
  // Calls YOUR host endpoint from section 1. It returns { token, expiresAt, ... }.
  const res = await fetch("/api/w6w-session", { method: "POST" });
  if (!res.ok) throw new Error(`session endpoint answered ${res.status}`);
  return res.json();
}

export function W6W({ userId, children }: { userId: string; children: ReactNode }) {
  return (
    <W6WProvider
      baseUrl="https://<your-host>"
      getSession={getSession}
      identityKey={userId}
      refreshOnUnauthorized
    >
      {children}
    </W6WProvider>
  );
}
```

`getSession` must resolve to `{ token, expiresAt, expiresIn? }`, which is what your endpoint
returns. If it rejects, or resolves with a blank `token` or an `expiresAt` that is not a date, the
failure shows up as `error` on `useW6WSession()` (below) and the request that needed the session
fails with it, unless the previous session is still valid, in which case the request is sent with
that held token. Pass `getSession` or `token`, not both, and not neither: the provider throws.

**`identityKey` must change whenever the user or account behind `getSession` changes**, for example
`` `${userId}:${companyId}` ``. A change throws away the cached session and the client, so the
previous identity's token is never sent for the new one. With the same `identityKey` the provider
keeps serving the cached session, even if `getSession` now mints for someone else.

### Session status

`useW6WSession()` returns `{ status, expiresAt, error, refresh }` for the nearest provider:

| `status` | Meaning |
| --- | --- |
| `"loading"` | No session yet, or the first one is being fetched. |
| `"ready"` | A session is cached and not yet expired. |
| `"renewing"` | A new session is being fetched while the previous one is still held. |
| `"expired"` | The held session has expired and no renewal is running (for example a hidden tab). |
| `"error"` | The last `getSession` call failed. `error` holds the failure until the next attempt starts. |

`refresh()` starts a renewal, or joins one already running, and resolves when it settles. It never
rejects: read `error`. `renewBeforeMs` (default `30000`) sets how long before expiry the provider
renews; it is capped at half the session's lifetime. `expiresAt` is `null` until a session exists.

Place `<W6WProvider>` above any `<Suspense>` boundary that can suspend again after the first
render. A boundary that re-suspends above or around the provider detaches its session store, and
reads fail with a "disposed" error until the boundary shows again. A wrong token is never sent.

### Switching identity with a request in flight

On an `identityKey` change, read hooks abort their in-flight requests and blank their data. A
**mutation** already in flight is not cancelled: it keeps the old client's request and token, its
result still lands in the mutation hook's state, and that state is not reset. This release does
not change that, so do not enable a switch while a save is running if the result would confuse the
new view.

### Without React

The SDK's `W6WClient({ token: fn })` still caches nothing: it calls the function for each request
that starts, and requests in flight at the same time share one call. That is correct for a server
caller that mints once per job. If you build the client yourself, memoize the supplier, or call
your minting code only when needed, rather than minting a token on every call:

```ts
import { W6WClient } from "@w6w/sdk";

const client = new W6WClient({
  baseUrl: process.env.W6W_BASE_URL,
  token: async () => (await mintSession()).token, // your own minting and caching
});
```

The supplier can be sync or async. If it returns `null`, `undefined` or an empty string, the call
raises `ConfigError` instead of being sent without a credential.

## 3. Recover from an expired token

Turn on `refreshOnUnauthorized` to retry once when a token turns out to be expired. When a request
fails with `401 unauthorized`, the client calls your supplier again with `{ forceRefresh: true }`
and resends the same request with the new token. For an embedded session that means calling your
host endpoint again (see [Renewal](#renewal)). With `getSession`, the provider joins any
renewal already running, otherwise starts one, and hands the SDK the new token. Use
`onUnauthorized` to react when that doesn't help. The snippet below is for Node or any non-React
caller, where `supplier` is your own token function (in React, `getSession` replaces it):

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
is retried. It applies to any HTTP method, `POST` included, so a write that the server rejected
with `401` is sent a second time with the new token. `<W6WProvider>` adds no retry of its own. `onUnauthorized` runs at most once per call: after a
failed retry, or straight away when the token is a plain string or `refreshOnUnauthorized` is off.

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
`client.apps.byIds(ids)`: it drops duplicates, sends nothing for an empty list, and splits a long
list into requests the server accepts. Ids the catalog doesn't know are left out of the result.
A connection with `builtIn: true` is the built-in zero-credential row. It isn't stored, so
`connections.get` and `connections.delete` answer `404` for it: don't offer to delete it.

In React, hooks that ask for the same thing while a request is in flight share one request, so
two components calling `useConnections()` (or StrictMode's double mount) send a single fetch.

## 6. Build a workflow or Function editor

This section builds the editor loop yourself. To mount w6w's own editor instead, see [Embed the workflow editor](/clients/embed/).

A visual editor needs to load a definition, save it, try it, publish it and roll it back. Every
step is a method on `client.workflows` or `client.functions`, with the same names on both:

| To | Call |
| --- | --- |
| Save (full replacement) | `update(id, definition, { ifUnmodifiedSince })` (workflows only take the option) |
| Try the saved draft | `run(id, { allowUnpublished: true, wait: true })` |
| Publish the saved draft | `publish(id)` |
| See and read versions | `listVersions(id)`, `getVersion(id, n)` |
| Run a published version | `runVersion(id, n, { wait: true })` |
| Roll back | `revert(id, n)` |
| Turn on or off | `enable(id)`, `disable(id)` |
| Retire, then remove | `archive(id)`, then `delete(id)` |

**What a plain run executes.** Without `allowUnpublished`, `run` still executes the **stored** definition
as last saved — publishing is a precondition (the workflow or Function must have at least one published version), not a
selector. Edits saved after a publish are what the next plain `run` executes. To execute exactly what was
published, call `runVersion(id, n)`.

For the editor's typed shape, convert with `toFlowWorkflow` and `fromFlowWorkflow` from
`@w6w/react` instead of casting. The same fixture the SDK's tests compile and run lives in
`react/src/__tests__/fixtures/embed-host.ts`.

Rules that bite:

- **Save first.** A draft run and `publish` use the row the server has stored, never the
  definition in your editor. Flush any pending save, then run or publish.
- **Pass the save token on workflows.** `get` returns `updatedAt`; send it back as
  `ifUnmodifiedSince`. A `409 workflow_stale` means someone saved in between: reload and re-apply.
  Functions have no such token: the last write wins.
- **Refresh `updatedAt` after `revert`.** Reverting rewrites the stored row, so the token you
  held is stale. Call `get` again before the next save.
- **The SDK adds no retry policy of its own.** The one exception is the single re-send after a
  `401 unauthorized` when a token supplier is set (see section 3). Any other failed save, run or
  publish is thrown as an `ApiError` once. Decide in your product whether to try again.
- **A disabled workflow or Function can't run**, even as a draft run.
- **Batch reliability lookups yourself.** `reliability.list` takes at most ten app ids per call.
  Ask `reliability.members(project)` for the ids, then call `list` in groups of ten.

## In the browser

Keep the session client and the client secret on your backend. In a React app, use
[`@w6w/react`](/clients/react/): its provider takes a `getSession` callback that
fetches a session from your backend endpoint (section 2). See [Next.js and token minting](/clients/react/nextjs/).

If you want the whole workflow editor rather than the pieces to build one, mount the managed
editor from `@w6w/embed`: see [Embed the workflow editor](/clients/embed/).

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
| Calls keep failing with `401` after a refresh | A hand-written supplier returns the same expired token. | With `getSession` the provider handles this. Otherwise call the host endpoint again when `forceRefresh` is `true`, instead of returning a cached session. |

## Where to next

- **[React](/clients/react/)**: the provider and hooks for your frontend.
- **[Next.js and token minting](/clients/react/nextjs/)**: a complete backend route plus provider
  setup.
- **[Embed the workflow editor](/clients/embed/)**: the managed editor from `@w6w/embed`, one
  package and one provider.
- **[Migrating to embed sessions](/guides/embed-session-migration/)**: moving an existing
  `exchangeToken` integration over.
- **[Node SDK reference](/clients/node/reference/)**: every option on `W6WClient`.
