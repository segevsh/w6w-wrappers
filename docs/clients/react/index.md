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

The browser has no environment variables, so pass the token as a prop. `baseUrl` is optional and
defaults to `https://api.w6w.io`; pass it to use another host:

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

`token` takes a string, or a function that returns one. The function may be async. It is called
whenever a request needs a token, and concurrent requests share one in-flight call. The result is
not cached once it settles, so a rotated token is picked up on the next request. Until it returns a token, read
hooks stay in their loading state instead of sending a request without one.

For per-user sessions minted by your backend, pass `getSession` instead of `token`: one callback
that calls your session endpoint. The provider caches the session, renews it before it expires and
re-checks on tab resume, and `useW6WSession()` reports its status. It needs `@w6w/react` 0.9.13 or
later. See [Next.js and token minting](/clients/react/nextjs/).

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

## Run a tagged action from a screen (order confirmation)

A product screen can offer "do something with this record" without hard-coding which Workflow,
Function or Endpoint does it. Tag the callables in w6w (for example `action.order.send_confirmation`),
then let the screen find and run them. Two ways to pick the callable:

**Tag mode.** List everything under a tag prefix, pick one, run it with your data under a field named
after the prefix's last segment (`action.order` gives `order`):

```tsx
import { useCallables, useRunCallable, type CallableRef } from "@w6w/react";

function ConfirmOrder({ order }: { order: { id: string } }) {
  const { data: callables = [] } = useCallables({ tag: "action.order" });
  const { call, loading, error } = useRunCallable();

  // The default action carries the tag `action.order.send_confirmation` exactly.
  const action: CallableRef | undefined = callables.find((c) =>
    c.tags.includes("action.order.send_confirmation"),
  );

  async function onClick() {
    if (!action) return;
    // Workflow: you choose the manual trigger to start from (`entry`); the order goes in as input.
    // Function and Endpoint ignore `entry` and receive `{ order }` as their payload.
    await call(action.kind, action.id, { order }, action.kind === "workflow" ? "<manual trigger node id>" : undefined);
  }

  return (
    <button type="button" disabled={!action || loading} onClick={onClick}>
      {action ? action.name : "No confirmation action"}
    </button>
  );
}
```

`useCallables({ tag })` is the three tag-filtered lists merged, each row carrying its `kind`. The
same filter is on each list hook: `useWorkflows({ tag })`, `useFunctions({ tag })`,
`useEndpoints({ tag })`. A callable matches when one of its tags equals the value or starts with the
value plus a `.`, so `action.order` matches `action.order.send_confirmation` but not `action.orders`.
An empty or blank `tag` means no filter: it lists everything, and no `?tag=` is sent.

`useRunCallable().call(kind, id, input, entry?)` sends exactly one request per kind: a Workflow run
with `wait` and your `entry` and `input`; a Function invoke with `input` as its inputs; an Endpoint
invoke with `input`. It never publishes or sets `allowUnpublished`, and it does not choose `entry`
for you.

**Explicit binding.** When the screen should always run one specific callable, store that choice
under a key your host picks. `useCallableBinding(hostKey)` reads it (`data` is `null` until saved)
and `save` writes it:

```tsx
import { useCallableBinding, useRunCallable } from "@w6w/react";

function ConfirmOrderBound({ order }: { order: { id: string } }) {
  const { data: binding, save, refetch } = useCallableBinding("order-details.confirm");
  const { call } = useRunCallable();

  async function bind() {
    await save({ kind: "workflow", callableId: "wf_123", entry: "<manual trigger node id>", field: "order" });
    refetch();
  }

  return binding ? (
    <button type="button" onClick={() => call(binding.kind, binding.callableId, { [binding.field]: order }, binding.entry)}>
      Confirm order
    </button>
  ) : (
    <button type="button" onClick={bind}>Choose confirmation action</button>
  );
}
```

The binding is an ordinary w6w Document keyed `callable-binding/<hostKey>` (here
`callable-binding/order-details.confirm`), format `json`, content
`{ kind, callableId, entry?, field }`. It is visible and editable in your Documents list like any
other document; delete it to unbind. The first `save` creates it and later saves update the same
document.

If you use `createW6WUiAdapter`, the same operations are on the adapter as four optional members:
`listCallables({ tag })`, `invokeEndpoint(idOrKey, input)`, `getCallableBinding(hostKey)` and
`saveCallableBinding(hostKey, binding)`. Workflows run through the existing
`runWorkflow(id, { input, entry })` and Functions through `invokeFunction(id, inputs)`. A `@w6w/ui`
that does not know these members keeps working; they are optional on both sides.

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

## Edit workflows with a typed shape

The Node SDK returns a workflow definition as an untyped object, so that a newer server's extra
fields never break your app. If you pass definitions to or from the `@w6w/ui` flow editor,
convert them with `toFlowWorkflow` and `fromFlowWorkflow` rather than casting:

```tsx
import { fromFlowWorkflow, toFlowWorkflow, WorkflowShapeError } from "@w6w/react";

const { workflow } = await client.workflows.get(id);
try {
  const flow = toFlowWorkflow(workflow);
  // Give `flow` to the editor, and get an edited copy back.
  await client.workflows.update(id, fromFlowWorkflow(edited));
} catch (err) {
  if (err instanceof WorkflowShapeError) console.error(err.issues); // [{ path, message }]
}
```

`toFlowWorkflow` checks that `manifestVersion`, `id` and `name` are strings and that the
definition carries exactly one of `nodes` or `steps` — an array of objects that each have a string
`id`, reported as `nodes[i].id` or `steps[i].id` under whichever is present. Both at once is
`nodes: must not be combined with steps`; neither is `nodes: must be an array`. If `edges`,
`settings` or `variables` are present, they must be an array, an object and an array. When
something is wrong, the error's `issues` lists every problem, each with a `path` and a `message`.
It doesn't look inside a node's `uses`. Keys it doesn't know about, such as `retry`, `onError`,
`canvas` or your own `x-` fields, pass through unchanged in both directions, so converting there
and back gives you the same definition.

`createW6WUiAdapter` is tested at run time against the `@w6w/ui` contract it implements: every
member is present as a function, forwards its arguments to the expected request, and hands the
server's error body to the caller as `err.body`.

The adapter is the supported way to connect the UI to w6w. Most of its members run on the
Studio-internal `client.console.*` calls, which can change without notice, so pass
`createW6WUiAdapter(client)` to the UI as it is. Don't call the console namespace yourself or add
members to the adapter. `listAppsByIds` and `listConnections` use the public
`client.apps.byIds` and `client.connections.list`. For a workflow or Function editor, see
[Embed w6w in your product](/guides/embed/).

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
