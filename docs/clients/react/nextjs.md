---
id: null
key: "react/nextjs"
title: "Next.js and token minting"
section: "clients"
description: "Set up @w6w/react in a Next.js App Router app, with per-user tokens minted by your own backend route."
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

# Next.js and token minting

This page wires `@w6w/react` into a Next.js App Router app so that each signed-in user calls w6w
with their own short-lived token. Your server mints the session. The browser only ever sees that
session, never your tenant's credentials. The same pattern works in any React framework with a
backend.

## Before you start

- Your organisation is set up as a w6w tenant, with a **client id** and **client secret**.
- A Next.js 13.4 or later app using the App Router, with your own sign-in.
- `@w6w/react` and `@w6w/sdk` installed: `npm install @w6w/react @w6w/sdk`. The route below needs
  `createEmbedSessionClient`, which needs `@w6w/sdk` 0.9.12 or later.

## 1. Put the credentials in your server environment

```bash
# .env.local, read only by server code. Don't prefix these with NEXT_PUBLIC_.
W6W_BASE_URL=https://<your-host>
W6W_TENANT_CLIENT_ID=…
W6W_TENANT_CLIENT_SECRET=…
```

## 2. Add a route that mints a session

Create `app/api/w6w-session/route.ts`. It reads your own session, checks that the company the
browser asks for is one the user belongs to, and only then exchanges your tenant credentials for a
session that acts as that user in that company. The tested version of this adapter and its handler
live in the SDK repository at [`node/examples/embed-host/`](https://github.com/w6w-io/w6w-wrappers/tree/main/node/examples/embed-host); the shape is:

```ts
import { createEmbedSessionClient } from "@w6w/sdk/server";
import { createEmbedSessionHandler } from "./handler"; // copy node/examples/embed-host/handler.ts
import { getSession } from "@/lib/auth"; // your own sign-in

let handler: ReturnType<typeof createEmbedSessionHandler> | undefined;

// Next.js App Router route handler: no `next` import needed.
export function POST(req: Request) {
  handler ??= createEmbedSessionHandler({
    sessions: createEmbedSessionClient({
      baseUrl: process.env.W6W_BASE_URL!,
      clientId: process.env.W6W_TENANT_CLIENT_ID!,
      clientSecret: process.env.W6W_TENANT_CLIENT_SECRET!,
    }),
    // Replace with your session lookup. It must return the user's id and the
    // external ids of the companies they belong to, from your records.
    authenticate: async () => {
      const session = await getSession();
      return session
        ? {
          userId: session.userId,
          companyIds: session.companyIds,
          activeCompanyId: session.activeCompanyId,
        }
        : null;
    },
  });
  return handler(req);
}
```

This listing is shortened: the tested `route.ts` also wraps the first-request build in a `try/catch` and answers an opaque `502 session_unavailable` (log the `ConfigError` on your server) when the `W6W_*` values are missing, instead of a Next 500.

To use the files from the SDK repository in a Next app, copy `handler.ts` and `route.ts` into the
route folder and make two edits, plus a third: wire `authenticate` to your own session lookup (the copied stub returns `null`, so every call is `401` until you do). In `route.ts`, import `./handler` without the `.ts` extension (a
default Next tsconfig rejects it with TS5097). In `handler.ts`, change the type import
`../../src/server/mod.ts` to `import type { EmbedSessionClient } from "@w6w/sdk/server"`.

The `subject` and the company reference come from `authenticate`, never from the request body. The
browser may send `{ "company": "<id>" }` to switch company, and the handler refuses (`403`) any
company that is not in `companyIds`. The company id is your external company id: stable, and sent
verbatim as the `accountRef`. The first time w6w sees one it creates an empty account for it. See
[Embed w6w in your product](/guides/embed/) for the full rules.

Check it: while signed in, run `fetch("/api/w6w-session", { method: "POST" })` from the browser
console. You should get back a `token`, an `expiresAt` (an ISO date string) and an `account` (an
`acct_…` id).

## 3. Add the provider in a client component

Create `app/w6w-provider.tsx`. It fetches a token from your route, caches it until shortly before
it expires, and refreshes it when w6w rejects it:

```tsx
"use client";

import { W6WProvider } from "@w6w/react";
import { useCallback, useRef, type ReactNode } from "react";

// expiresAt is an ISO date string; `company` records which company the session was minted for
type Cached = { token: string; expiresAt: string; company: string | undefined };

export function W6W(
  { userId, companyId, children }: { userId: string; companyId?: string; children: ReactNode },
) {
  const cache = useRef<Cached | null>(null);

  const token = useCallback(async ({ forceRefresh = false } = {}) => {
    const c = cache.current;
    // A session cached for another company is never reused.
    if (!forceRefresh && c && c.company === companyId && Date.parse(c.expiresAt) - Date.now() > 30_000) {
      return c.token;
    }

    const res = await fetch("/api/w6w-session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ company: companyId }), // a hint; your route validates it
    });
    if (!res.ok) return null; // hooks wait instead of sending an unauthenticated call
    const minted = { ...(await res.json()), company: companyId } as Cached;
    cache.current = minted;
    return minted.token;
  }, [companyId]);

  return (
    <W6WProvider
      baseUrl="https://<your-host>"
      token={token}
      identityKey={`${userId}:${companyId ?? ""}`}
      refreshOnUnauthorized
      onUnauthorized={() => window.location.assign("/sign-in")}
    >
      {children}
    </W6WProvider>
  );
}
```

A session is for one company. When the user switches company, pass the new `companyId`: the
supplier stops reusing the cached session (it was minted for the other company) and sends
`{ company }` to your route, which checks it against `companyIds` before minting.

`identityKey` tells the provider whose data it's showing, so it includes both the user and the
company. When either changes, the client is rebuilt and every hook starts empty, so nothing from
the previous user, or from the company the user just left, stays on screen. Leave the company out
of `identityKey` and company A's data keeps showing after a switch to company B.

## 4. Wrap your pages

In `app/layout.tsx`, a server component, read your session and wrap the app:

```tsx
import { W6W } from "./w6w-provider";
import { getSession } from "@/lib/auth";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  return (
    <html lang="en">
      <body>
        {session ? (
          <W6W userId={session.userId} companyId={session.activeCompanyId}>
            {children}
          </W6W>
        ) : children}
      </body>
    </html>
  );
}
```

## 5. Check that it worked

Render a component that calls `useMe()` under the provider:

```tsx
"use client";

import { useMe } from "@w6w/react";

export function WhoAmI() {
  const { data, error } = useMe();
  if (error) return <p>Failed: {String(error)}</p>;
  return <p>{data ? `${data.subject} in ${data.account}` : "Loading…"}</p>;
}
```

You should see the signed-in user's id and their w6w account.

## When you don't have a token yet

If your sign-in finishes after the page renders, pass `ready={false}` until it does. Read hooks
report `loading: true` and send nothing while `ready` is `false`, then load as soon as it turns
`true`.

## Hooks run in the browser only

Hooks and the provider only work in client components, the files marked `"use client"`. In a
server component or a route handler, use the [Node SDK](/clients/node/) directly. Create a
`W6WClient` with a token from the session client's `create()` and call it.

## Troubleshooting

| Symptom | Cause | What to do |
| --- | --- | --- |
| `502 session_unavailable` from your session route | The exchange failed (the tenant client id or secret is wrong, or the tenant is disabled) or the `W6W_*` values are missing. The body is opaque by design. | Read the error in your server logs, check the values in `.env.local` and restart the dev server. |
| Hooks stay loading | The session route returns an error, so the supplier returns `null`. | Call `/api/w6w-session` from the browser console and check the status (`401` not signed in, `403` company not yours, `502` see your server logs). |
| `W6W_TENANT_CLIENT_SECRET` shows up in the browser bundle | It was given a `NEXT_PUBLIC_` prefix or imported in client code. | Rename it, and only use it in route handlers and server code. Rotate the secret. |
| `useW6WClient must be used inside <W6WProvider>` | A component using a hook renders outside the provider. | Wrap that part of the tree in the provider. |

## Where to next

- **[Hooks reference](/clients/react/hooks/)**: every hook and provider prop.
- **[Embed w6w in your product](/guides/embed/)**: the session endpoint in more detail.
