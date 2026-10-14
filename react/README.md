# @w6w/react

React bindings for [`@w6w/sdk`](../node) — a `<W6WProvider>` that holds one memoized
`W6WClient` with per-request token freshness, a small hook set over the SDK's public
surface (`me`, `documents`, `vars`, `connections`, `workflows`, `functions`, `run`), and
`createW6WUiAdapter`, a structural bridge from a `W6WClient` to
[`@w6w/ui`](https://github.com/w6w-io/w6w-ui)'s `W6WApi` contract.

License: MIT · Version: 0.9.13 · Guides: [docs.w6w.io/clients/react](https://docs.w6w.io/clients/react/)
(with a [hooks reference](https://docs.w6w.io/clients/react/hooks/) and a
[Next.js walkthrough](https://docs.w6w.io/clients/react/nextjs/))

This lane implements no endpoint — it composes `@w6w/sdk`, which is already
conformant against [`endpoints.json`](../endpoints.json). There is nothing here to
re-verify against the wire contract; verify `@w6w/sdk` instead.

## Install

```bash
npm install @w6w/react react
```

`@w6w/sdk` comes in as a dependency. Add it to your own `package.json` too
(`npm install @w6w/sdk`) if you import from it directly — `ApiError` for an
`instanceof` check, or `createEmbedSessionClient` from `@w6w/sdk/server` on your backend.

`react-dom` is not a dependency of this package — `<W6WProvider>`'s only JSX is a
context wrapper (`<Ctx.Provider>`), never a DOM element of its own. Your app already
depends on `react-dom` to mount itself; nothing extra is needed here.

## Quick start

Wrap your app root once:

```tsx
import { W6WProvider } from "@w6w/react";

function App() {
  return (
    <W6WProvider baseUrl="https://api.example.com" token={() => getCurrentJwt()}>
      <YourApp />
    </W6WProvider>
  );
}
```

`token` accepts a literal string, or a supplier — sync or **async** — called per
request (requests in flight at the same time share ONE supplier call; nothing is cached once
it settles, so memoize an expensive supplier yourself): `() => getCurrentJwt()` or `async () => await getCurrentJwt()` both
work, and either is awaited before the bearer is attached. Pass a supplier when your
token rotates (e.g. a short-lived JWT read from an auth SDK, or minted on demand by
your own backend) and the client picks up the new value on the very next call, with no
teardown/rebuild of the underlying `W6WClient`. A nullish or blank result (from either
form) never reaches the wire: every read hook below reports `loading: true` instead of
sending a request with no credential. See `src/W6WProvider.tsx`'s module header for the
exact mechanism.

Then, anywhere under the provider:

```tsx
import { useDocuments, useW6WClient } from "@w6w/react";

function DocList() {
  const { data, loading, error, refetch } = useDocuments();
  if (loading) return <p>Loading…</p>;
  if (error) return <p>Failed: {String(error)}</p>;
  return (
    <ul>
      {data?.map((doc) => <li key={doc.id}>{doc.key}</li>)}
    </ul>
  );
}
```

## Embedding for enterprise tenants

A host juggling more than one signed-in identity — or one that does not have a
token/identity yet at mount time — needs more than the Quick start's one-shot
`token` prop. `<W6WProvider>` takes more props for exactly this:

- **`getSession`** (with **`renewBeforeMs`**, default `30000`) — instead of `token`,
  one `() => Promise<{token, expiresAt, expiresIn?}>` callback that calls your
  backend's session endpoint. The provider calls it lazily and one call at a time,
  caches the session, renews it before expiry (never later than half the
  session's lifetime) and re-checks when a hidden tab becomes visible; you write
  no cache or timer. Pass exactly one of `token` or `getSession` (both, or
  neither, throws). Needs 0.9.13 or later. `useW6WSession()` returns
  `{status, expiresAt, error, refresh}`, where `status` is `"loading"`, `"ready"`,
  `"renewing"`, `"expired"` or `"error"`. Keep the identity switch in
  `identityKey` (it must change when the user or account behind `getSession`
  does). Place the provider above any `<Suspense>` boundary that can re-suspend: one
  above or around it detaches the store, and reads error with "disposed" until it
  re-shows. A mutation in flight at an identity switch is not cancelled, keeps the
  old client's request and token, still lands its result in the hook's state, and
  that state is not reset (unchanged).

- **`ready`** (default `true`) — set it `false` until you actually have a
  token/identity to embed with. While `false`, every read hook reports
  `loading: true` and none of them calls the SDK at all; flipping it back to
  `true` fetches.
- **`identityKey`** — a string identifying WHICH signed-in identity this
  client speaks for, e.g. `` `${subject}:${account}` ``. Changing it rebuilds
  the underlying `W6WClient` and resets every read hook's state — the
  supported way to switch accounts without a stale read from the previous
  identity ever rendering under the new one.
- **`refreshOnUnauthorized`** + **`onUnauthorized`** — opt in to a single,
  one-shot recovery when a request 401s with `{code: "unauthorized"}`: your
  `token` supplier is called once more with `{forceRefresh: true}`, and a
  usable result retries the same request once. `onUnauthorized` receives the
  terminal error — after a failed retry, or immediately when recovery is off
  or not possible — at most once per call.
- **`headers`** — default headers sent with every request. This is how a
  tenant on the custom-authorizer integration path (no OIDC on your side)
  attaches the tenant header your w6w account's authorizer webhook expects
  (e.g. `headers={{ "X-W6W-Tenant": tenantId }}`) alongside the bearer token.
  Compared by content, not identity — a new-but-equal object on every render
  never rebuilds the client.

```tsx
"use client";

import { W6WProvider } from "@w6w/react";

// Your own backend route: it holds the tenant credentials and answers with a
// session ({ token, expiresAt, ... }) for this signed-in user, built with
// `createEmbedSessionClient` from `@w6w/sdk/server`.
async function getSession() {
  const res = await fetch("/api/w6w-session", { method: "POST" });
  if (!res.ok) throw new Error(`session route answered ${res.status}`);
  return res.json();
}

export default function W6WLayout({ children }: { children: React.ReactNode }) {
  return (
    <W6WProvider
      baseUrl="https://api.example.com"
      getSession={getSession}
      identityKey={`${session.subject}:${session.account}`}
      headers={{ "X-W6W-Tenant": session.tenantId }}
      refreshOnUnauthorized
      onUnauthorized={() => redirectToLogin()}
    >
      {children}
    </W6WProvider>
  );
}
```

The [Next.js walkthrough](https://docs.w6w.io/clients/react/nextjs/) builds the
`/api/w6w-session` route this example fetches from, with `createEmbedSessionClient`.

## Using this package with `@w6w/ui`

`@w6w/ui`'s components (e.g. `AppPicker`, `ActionTestForm`, the flow editor) take a
`W6WApi` object through their own `<W6WUIProvider api={...}>`. Build one from your
`@w6w/react` client with `createW6WUiAdapter`:

```tsx
import { useMemo } from "react";
import { createW6WUiAdapter, useW6WClient, W6WProvider } from "@w6w/react";
import { W6WUIProvider, AppPicker } from "@w6w/ui";

function UiBridge({ children }: { children: React.ReactNode }) {
  const client = useW6WClient();
  const api = useMemo(() => createW6WUiAdapter(client), [client]);
  return <W6WUIProvider api={api}>{children}</W6WUIProvider>;
}

function App() {
  return (
    <W6WProvider baseUrl="https://api.example.com" token={jwtSupplier}>
      <UiBridge>
        <AppPicker onPick={(appId) => console.log(appId)} />
      </UiBridge>
    </W6WProvider>
  );
}
```

`@w6w/ui@0.1.0` is available on npm. Install it with `npm i @w6w/ui`.
`createW6WUiAdapter` targets its `W6WApi` contract structurally and has no runtime
dependency on the UI package.

`createW6WUiAdapter` is built on `@w6w/sdk/console` for most members — the SAME
namespace `packages/studio`'s own facade uses for these routes
(`packages/ui/src/createW6WApi.ts` is the *other* hand-rolled client for them; this
package is not a third one) — and on the BASE `client.functions.*`/
`client.workflows.*` surface for `listFunctions`/`getFunction`/`invokeFunction`/
`listWorkflows`/`getWorkflow`/`runWorkflow`. `listAppsByIds` and `listConnections` go through
the public `client.apps.byIds` and `client.connections.list`. **The adapter is the supported
seam:** hand `createW6WUiAdapter(client)` to the UI as it is, and do not reach for the
console-backed internals or patch members onto it yourself. **`client.console.*` is documented
"Studio-internal… unstable" and is deliberately excluded from `endpoints.json`'s
conformance runner** (`node/src/client.ts:114-116`). That means a `console.*`
signature change ships with no lockstep protection for this bridge beyond
`@w6w/sdk`'s own version — pin your `@w6w/sdk` version alongside `@w6w/react`'s, and
re-test the bridge on an upgrade rather than assuming it.

### Keeping `createW6WUiAdapter` in sync with the real `@w6w/ui`

`package.json` pins `@w6w/ui` to npm version `0.1.0` as a dev dependency.
Consumers of `@w6w/react` do not install that dependency automatically; it is used
only by the conformance checks. The release workflow can install it in a clean
checkout without sibling repositories.

`src/__tests__/ui-conformance.check.ts` imports `W6WApi` and `FlowWorkflow` from
the UI package's public exports. It checks the adapter's return type and the
workflow converter in both directions. The runtime suite reads the installed
`dist/provider.d.ts` declaration to enumerate the real interface members.

To update the pin, change the npm version in `package.json`, refresh
`package-lock.json`, and run `npm test` and `npm run build`. These checks report
any incompatible UI contract changes.

On Node older than 22.18, run the local gate as
`NODE_OPTIONS=--experimental-strip-types npm test` (the tests load `.ts` files directly;
CI uses Node 24).

**Runtime conformance.** Assignability is checked at compile time only, so it cannot
see a member that is typed but missing or mis-wired at run time.
`src/__tests__/adapter-conformance.test.ts` closes that gap. It reads the member names
(21 required, 8 optional) from the installed `@w6w/ui` `provider.d.ts` declaration — not from
this package's hand-copied interface — and asserts each is a function on
`createW6WUiAdapter(client)`. It then drives every member with sentinel arguments
through a stub transport and asserts the exact wire request produced (forwarding), and
asserts that a 4xx JSON error body reaches the caller as `err.body`, deep-equal to
what the server sent. Nothing in it imports `@w6w/ui` at run time; the pinned UI is
read as text.

`toFlowWorkflow` does not validate `steps[].uses`, although the returned type declares it
required; a step without `uses` converts, so guard before handing it to code that reads
`step.uses.app`.

### Editing workflows with a typed shape

`@w6w/sdk` keeps a workflow definition opaque (`WorkflowDefinition`, a
`Record<string, unknown>`) on purpose, so a newer server's extra fields never break a
client. The visual editor wants a typed shape, so this package exports a validating
converter instead of a cast:

```ts
import { fromFlowWorkflow, toFlowWorkflow, WorkflowShapeError } from "@w6w/react";

const { workflow } = await client.workflows.get(id);
try {
  const flow = toFlowWorkflow(workflow); // FlowWorkflowShape
  // ... hand `flow` to the editor, receive an edited copy back ...
  await client.workflows.update(id, fromFlowWorkflow(edited));
} catch (err) {
  if (err instanceof WorkflowShapeError) console.error(err.issues); // [{ path, message }, ...]
}
```

`toFlowWorkflow` requires string `manifestVersion`/`id`/`name` and a `steps` array of
objects with a string `id` (plus `edges` an array, `settings` an object, `variables`
an array, when present); anything else throws `WorkflowShapeError` whose `issues` lists
every violation. It does not inspect the inside of `steps[].uses` or any other nested
field. Unknown keys (`retry`, `onError`, `ports`, a host's `x-*` extension) are copied
through in both directions, so `fromFlowWorkflow(toFlowWorkflow(def))` deep-equals
`def`. `FlowWorkflowShape` is a structural mirror of `@w6w/ui`'s `FlowWorkflow`, with no
runtime `@w6w/ui` dependency; `ui-conformance.check.ts` pins it both ways (ui's
`FlowWorkflow` is accepted by `fromFlowWorkflow`, and the mirror is assignable to ui's
`FlowWorkflow`).

## Hooks catalog

Every read hook returns `{data, error, loading, refetch}`; every mutation hook
returns `{call, data, error, loading}`. None depends on react-query or any other
data-fetching library.

Read hooks asking for the same thing (same hook, same arguments, same provider) while a
request is in flight share ONE request — two consumers, or React StrictMode's
mount/unmount/mount, send a single fetch. Nothing is kept once it settles: a hook mounting
later sends a new request, and `refetch()` starts a fresh one.

| Hook | Wraps |
|---|---|
| `useMe()` | `client.me()` |
| `useDocuments(options?)` | `client.documents.list()` |
| `useDocument(id, options?)` | `client.documents.get()` |
| `useDocumentByKey(key, options?)` | `client.documents.getByKey()` |
| `useCreateDocument()` | `client.documents.create()` |
| `useUpdateDocument()` | `client.documents.update()` |
| `useDeleteDocument()` | `client.documents.delete()` |
| `useVars()` | `client.vars.list()` |
| `useVar(id)` | `client.vars.get()` |
| `useCreateVar()` | `client.vars.create()` |
| `useUpdateVar()` | `client.vars.update()` |
| `useDeleteVar()` | `client.vars.delete()` |
| `useConnections()` | `client.connections.list()` |
| `useWorkflows(options?)` | `client.workflows.list()` |
| `useWorkflow(id)` | `client.workflows.get()` |
| `useCreateWorkflow()` | `client.workflows.create()` |
| `useUpdateWorkflow()` | `client.workflows.update()` |
| `useArchiveWorkflow()` | `client.workflows.archive()` |
| `useDeleteWorkflow()` | `client.workflows.delete()` |
| `useRunWorkflow()` | `client.workflows.run()`, defaults `wait: true` |
| `useFunctions()` | `client.functions.list()` |
| `useFunction(id)` | `client.functions.get()` |
| `useCreateFunction()` | `client.functions.create()` |
| `useUpdateFunction()` | `client.functions.update()` |
| `useDeleteFunction()` | `client.functions.delete()` |
| `useRun()` | `client.run()` (the generic URN dispatch) |

Three things the definition hooks inherit from the SDK rather than invent:

- **`create` mints the id.** The server requires one in the body and never
  generates it, so `useCreateWorkflow().call({name, steps})` works and the
  `wf_…` / `fn_…` id comes back in the result.
- **`update` is a full replacement, not a patch.** This is the one place they
  differ from `useUpdateDocument`/`useUpdateVar`, whose second argument is a
  patch of just the fields to change. Read with `useWorkflow`/`useFunction`,
  spread, change, send the whole thing back — passing only the changed fields
  deletes the rest. `useUpdateWorkflow()`'s third argument carries
  `ifUnmodifiedSince`: hand it the `updatedAt` from `useWorkflow` and a save
  that would clobber someone else's edit is refused with `409 workflow_stale`
  rather than winning silently.
- **Deleting a workflow is two calls**, `useArchiveWorkflow` then
  `useDeleteWorkflow`. Nothing chains them for you: the archive step is the one
  a user can still change their mind after.

No mutation hook refetches a list on success — this package carries no cache to
invalidate, so pair one with the matching read hook's own `refetch`.

`client.functions.run()` has **no** hook, and neither does `endpoints.run()` —
that predates the definition hooks and is unchanged by them. `useRun()` reaches
a Function by its `fn_…` id today (the server dispatches it through the same
service the dedicated invoke route uses); calling one by the `key` a user gave
it still means `useW6WClient().functions.run("send-email", …)`.

`useRunWorkflow()`'s `call` defaults `wait: true` when the caller's options omit
`wait`: `workflows.run` without `wait` (`node/src/workflows.ts`) leaves the caller
with only a `runId` and no public polling operation to follow it with —
`console.workflows.getRun` exists, but it is the same studio-internal, unstable
surface described above, so this hook does not reach for it. Pass `wait: false`
explicitly if you want the queued-and-walk-away behaviour, and follow the run
with `` useW6WClient().request({ method: "GET", path: path`/runs/${runId}` }) ``.

`useW6WClient()` returns the underlying `W6WClient` for anything not covered by a
hook (e.g. `client.console.*` directly, at your own risk per the caveat above).

## Known limitations

- **`getAppActions`'s declared `ActionDef.params` type is a strict field subset of
  `@w6w/ui`'s richer `ActionParam`.** `@w6w/sdk/console`'s `ActionParam` carries 6
  fields (`key, label, type, required, default, hint`); `@w6w/ui`'s carries 14 more,
  presentation-only fields (`placeholder, advanced, row, item, showIf, options,
  config, children, section, title, subtitle, layout, collapsed`). This typechecks
  fine — every extra field is optional — and there is no runtime data loss (the JSON
  payload is unfiltered); a caller typing a variable through this adapter's declared
  return type just gets no autocomplete for those extra fields.
- **Cancellation is per-hook, not exposed to the caller.** Every read hook aborts its
  own superseded or unmounted calls internally (a superseded call, an `identityKey`
  switch, or an unmount all abort the in-flight `AbortSignal` — but a shared request
  aborts only when its LAST subscriber detaches, so StrictMode's remount or a second
  consumer re-attaches instead of aborting it — see `src/hooks.ts`'s
  module header) — but there is no option to pass your OWN `AbortSignal` into a hook
  from outside it. `useW6WClient()` plus the underlying SDK method (which does take a
  `signal`) is the escape hatch if you need that.
