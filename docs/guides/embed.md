---
id: null
key: "embed"
title: "Embed w6w in your product"
section: "guides"
description: "Mint per-user w6w tokens on your backend, rotate them without rebuilding the client, and recover from an expired token automatically."
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
token instead of one shared API token. This page shows how to mint those tokens on your backend,
hand them to the client, and refresh them when they expire.

## Before you start

- Your organisation is set up as a w6w tenant, and you have its **client id** and **client
  secret**. These are issued when your tenant is provisioned.
- A backend you control. The client secret must never reach a browser or mobile app.
- `@w6w/sdk` installed on that backend. See the [Node SDK](/clients/node/) page.

## 1. Mint a token for a user on your backend

`exchangeToken` trades your tenant's client credentials for a short-lived token that acts as one
of your users. Import it from `@w6w/sdk/server`, which is meant for backends only:

```ts
import { exchangeToken } from "@w6w/sdk/server";

// A route on YOUR backend, for example POST /api/w6w-token.
export async function mintW6WToken(userId: string, accountId?: string) {
  const { token, expiresIn } = await exchangeToken({
    baseUrl: process.env.W6W_BASE_URL!,
    clientId: process.env.W6W_TENANT_CLIENT_ID!,
    clientSecret: process.env.W6W_TENANT_CLIENT_SECRET!, // stays on the server
    subject: userId,     // your user's id; it becomes their identity in w6w
    account: accountId,  // optional: the w6w account this user works in
  });
  return { token, expiresAt: Date.now() + expiresIn * 1000 };
}
```

You should get back a token and its lifetime in seconds. The result also includes `user`, with the
`subject`, `tenant`, `role` and `account` the token carries.

> **Good to know:** w6w trusts the `account` you pass. Look it up from your own records for the
> signed-in user. Never take it from a value the browser sends you.

Malformed credentials (a blank value, or a client id containing `:`) raise `ConfigError` before any
request is sent.

## 2. Give the client a token supplier

Instead of a fixed string, pass `token` a function. The client calls it before **every** request,
so a rotated token is picked up on the next call without rebuilding the client:

```ts
import { W6WClient } from "@w6w/sdk";

let cached: { token: string; expiresAt: number } | undefined;

const client = new W6WClient({
  baseUrl: process.env.W6W_BASE_URL,
  token: async ({ forceRefresh } = {}) => {
    if (forceRefresh || !cached || cached.expiresAt - Date.now() < 30_000) {
      cached = await mintW6WToken(currentUserId());
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
and resends the same request with the new token. Use `onUnauthorized` to react when that doesn't
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

## In the browser

Keep `exchangeToken` and the client secret on your backend. In a React app, use
[`@w6w/react`](/clients/react/): its provider takes the same token supplier, and your supplier
fetches a token from your backend route. See [Next.js and token minting](/clients/react/nextjs/).

## Troubleshooting

| Symptom | Cause | What to do |
| --- | --- | --- |
| `401 invalid_client` from `exchangeToken` | The client id or secret is wrong, or the credentials are disabled. | Check `W6W_TENANT_CLIENT_ID` and `W6W_TENANT_CLIENT_SECRET` against what you were issued. |
| `ConfigError` from `exchangeToken` | A value is blank, or the client id contains `:`. | Check the environment variables are set on the backend. |
| `ConfigError: No w6w API token is configured` on a call | Your supplier returned nothing. | Make sure it returns a token string, and handle the case where the user isn't signed in. |
| Calls keep failing with `401` after a refresh | The supplier returns the same expired token. | Mint a new token when `forceRefresh` is `true`, instead of returning a cached one. |

## Where to next

- **[React](/clients/react/)**: the provider and hooks for your frontend.
- **[Next.js and token minting](/clients/react/nextjs/)**: a complete backend route plus provider
  setup.
- **[Node SDK reference](/clients/node/reference/)**: every option on `W6WClient`.
