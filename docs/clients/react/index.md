---
id: null
key: "react"
title: "React"
section: "clients"
description: "Wrap your React app in W6WProvider, read w6w data with hooks, and run actions and workflows from components."
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

# React

`@w6w/react` puts w6w into a React app: one provider that holds the client, and hooks that load
data and run things from your components. It's built on the [Node SDK](/clients/node/), so
anything without a hook is one `useW6WClient()` call away.

## Before you start

- A React 18 or later app.
- A way to get a w6w token in the browser. For a quick test, an API token from Studio →
  **Settings** → **API tokens** works. For real users, mint per-user tokens on your backend. See
  [Next.js and token minting](/clients/react/nextjs/).

## 1. Install the package

```bash
npm install @w6w/react react
```

This also installs `@w6w/sdk`. If you import from it directly, for example `ApiError`, add it to
your own dependencies at the same version as `@w6w/react`: `npm install @w6w/sdk`.

## 2. Wrap your app in the provider

The browser has no environment variables, so pass the base URL and token as props:

```tsx
import { W6WProvider } from "@w6w/react";

export function App() {
  return (
    <W6WProvider baseUrl="https://<your-host>" token={() => getToken()}>
      <Dashboard />
    </W6WProvider>
  );
}
```

`token` takes a string, or a function that returns one. A function can be async, and it's called
before every request, so a rotated token is used on the next call. Until it returns a token, read
hooks stay in their loading state instead of sending a request without one.

## 3. Read data with a hook

```tsx
import { useWorkflows } from "@w6w/react";

function Dashboard() {
  const { data, loading, error, refetch } = useWorkflows();

  if (loading) return <p>Loading…</p>;
  if (error) return <p>Failed: {String(error)}</p>;

  return (
    <>
      <button type="button" onClick={refetch}>Refresh</button>
      <ul>
        {data?.map((wf) => <li key={wf.id}>{wf.displayName || wf.name}</li>)}
      </ul>
    </>
  );
}
```

You should see your workflows listed. Every read hook returns `data`, `error`, `loading` and
`refetch`, loads when the component mounts, and reloads when its arguments change.

## 4. Run something from a component

Mutation hooks return a `call` function plus `data`, `error` and `loading`. Nothing runs until you
call it:

```tsx
import { useRunWorkflow } from "@w6w/react";

function RunButton({ workflowId }: { workflowId: string }) {
  const { call, data, error, loading } = useRunWorkflow();

  async function onClick() {
    try {
      await call(workflowId, { input: { source: "dashboard" } });
    } catch {
      // the error is also in `error`
    }
  }

  return (
    <>
      <button type="button" disabled={loading} onClick={onClick}>Run</button>
      {data && <p>Run {data.runId}: {data.status}</p>}
      {error ? <p>Failed: {String(error)}</p> : null}
    </>
  );
}
```

`useRunWorkflow` waits for the run to finish by default. Pass `wait: false` to only queue it. To run
an action, Function, Endpoint or Workflow by id, use `useRun()`, which wraps `client.run()`.

A mutation's `call` rejects when it fails, and also puts the error in `error`. Catch it, or React
reports an unhandled rejection.

Mutations don't refresh your lists. After a create, update or delete, call the matching read
hook's `refetch`.

## Use the client directly

For anything without a hook, such as running a Function by key, calling an Endpoint, cancelling a
run, managing your team, or reaching a route with `request()`, take the client from context:

```tsx
import { useW6WClient } from "@w6w/react";

function SendWelcome({ email }: { email: string }) {
  const client = useW6WClient();
  return (
    <button
      type="button"
      onClick={() => client.functions.run("send-welcome-email", { payload: { to: email } })}
    >
      Send welcome email
    </button>
  );
}
```

`useW6WClient()` returns the same `W6WClient` the hooks use. Everything on the
[Node SDK](/clients/node/) pages works on it, including `client.request()` for routes no method
wraps yet.

## Handle errors

Hook errors are the SDK's `ApiError`, with `status`, `code`, `message` and `raw`:

```tsx
import { ApiError } from "@w6w/sdk";

function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return "Your session expired. Sign in again.";
    if (error.status === 0) return "Can't reach w6w right now.";
    return error.message;
  }
  return String(error);
}
```

Nothing is retried automatically. To recover from an expired token, set `refreshOnUnauthorized` on
the provider, as shown in [Next.js and token minting](/clients/react/nextjs/). For what each status
and code means, see [Handle errors](/clients/node/#handle-errors).

## Troubleshooting

| Symptom | Cause | What to do |
| --- | --- | --- |
| Hooks stay `loading: true` forever | The token supplier returns nothing, or `ready` is `false`. | Return a token string, and set `ready` once you have one. |
| `useW6WClient must be used inside <W6WProvider>` | The component isn't under the provider. | Move `<W6WProvider>` higher in the tree. |
| A list doesn't update after a create | Mutations don't refresh reads. | Call the read hook's `refetch` after `call` resolves. |
| `401` after switching users | The client still holds the previous user's token. | Set `identityKey` to the signed-in user's id so the provider rebuilds the client. |
| `network_error` in the browser, but the same call works from a terminal | A proxy in front of w6w answered with an error page the browser blocked, or `baseUrl` points somewhere else. | Check `baseUrl`, then retry. If it persists, open the request in the browser's network tab to see the real status. |

## Where to next

- **[Hooks reference](/clients/react/hooks/)**: every hook and every provider prop.
- **[Next.js and token minting](/clients/react/nextjs/)**: per-user tokens from your backend.
- **[Node SDK](/clients/node/)**: the client under the hooks.
