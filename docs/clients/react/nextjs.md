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
with their own short-lived token. Your server mints the token. The browser only ever sees that
token, never your tenant's credentials. The same pattern works in any React framework with a
backend.

## Before you start

- Your organisation is set up as a w6w tenant, with a **client id** and **client secret**.
- A Next.js 13.4 or later app using the App Router, with your own sign-in.
- `@w6w/react` and `@w6w/sdk` installed: `npm install @w6w/react @w6w/sdk`.

## 1. Put the credentials in your server environment

```bash
# .env.local, read only by server code. Don't prefix these with NEXT_PUBLIC_.
W6W_BASE_URL=https://<your-host>
W6W_TENANT_CLIENT_ID=…
W6W_TENANT_CLIENT_SECRET=…
```

## 2. Add a route that mints a token

Create `app/api/w6w-token/route.ts`. It reads your own session, then exchanges your tenant
credentials for a token that acts as that user:

```ts
import { exchangeToken } from "@w6w/sdk/server";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth"; // your own sign-in

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "signed_out" }, { status: 401 });

  const { token, expiresIn } = await exchangeToken({
    baseUrl: process.env.W6W_BASE_URL!,
    clientId: process.env.W6W_TENANT_CLIENT_ID!,
    clientSecret: process.env.W6W_TENANT_CLIENT_SECRET!,
    subject: session.userId,
    account: session.w6wAccountId, // from your records, never from the request
  });

  return NextResponse.json({ token, expiresAt: Date.now() + expiresIn * 1000 });
}
```

Check it: while signed in, run `fetch("/api/w6w-token", { method: "POST" })` from the browser
console. You should get back a `token` and an `expiresAt`.

## 3. Add the provider in a client component

Create `app/w6w-provider.tsx`. It fetches a token from your route, caches it until shortly before
it expires, and refreshes it when w6w rejects it:

```tsx
"use client";

import { W6WProvider } from "@w6w/react";
import { useCallback, useRef, type ReactNode } from "react";

type Cached = { token: string; expiresAt: number };

export function W6W({ userId, children }: { userId: string; children: ReactNode }) {
  const cache = useRef<Cached | null>(null);

  const token = useCallback(async ({ forceRefresh = false } = {}) => {
    const c = cache.current;
    if (!forceRefresh && c && c.expiresAt - Date.now() > 30_000) return c.token;

    const res = await fetch("/api/w6w-token", { method: "POST" });
    if (!res.ok) return null; // hooks wait instead of sending an unauthenticated call
    cache.current = (await res.json()) as Cached;
    return cache.current.token;
  }, []);

  return (
    <W6WProvider
      baseUrl="https://<your-host>"
      token={token}
      identityKey={userId}
      refreshOnUnauthorized
      onUnauthorized={() => window.location.assign("/sign-in")}
    >
      {children}
    </W6WProvider>
  );
}
```

`identityKey` tells the provider whose data it's showing. When a different user signs in, the
client is rebuilt and every hook starts empty, so nothing from the previous user is shown.

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
        {session ? <W6W userId={session.userId}>{children}</W6W> : children}
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
`W6WClient` with a token from `exchangeToken` and call it.

## Troubleshooting

| Symptom | Cause | What to do |
| --- | --- | --- |
| `401 invalid_client` from your token route | The tenant client id or secret is wrong. | Check the values in `.env.local` and restart the dev server. |
| Hooks stay loading | The token route returns an error, so the supplier returns `null`. | Call `/api/w6w-token` from the browser console and fix what it returns. |
| `W6W_TENANT_CLIENT_SECRET` shows up in the browser bundle | It was given a `NEXT_PUBLIC_` prefix or imported in client code. | Rename it, and only use it in route handlers and server code. Rotate the secret. |
| `useW6WClient must be used inside <W6WProvider>` | A component using a hook renders outside the provider. | Wrap that part of the tree in the provider. |

## Where to next

- **[Hooks reference](/clients/react/hooks/)**: every hook and provider prop.
- **[Embed w6w in your product](/clients/node/embedding/)**: the token exchange in more detail.
