# @w6w/react

React bindings for [`@w6w/sdk`](../node) — a `<W6WProvider>` that holds one memoized
`W6WClient` with per-request token freshness, a small hook set over the SDK's public
surface (`me`, `documents`, `vars`, `connections`, `workflows`, `functions`, `run`), and
`createW6WUiAdapter`, a structural bridge from a `W6WClient` to
[`@w6w/ui`](https://github.com/w6w-io/w6w-ui)'s `W6WApi` contract.

License: MIT · Version: 0.9.2 · Guides: [docs.w6w.io/clients/react](https://docs.w6w.io/clients/react/)
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
`instanceof` check, or `exchangeToken` from `@w6w/sdk/server` on your backend.

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

`token` accepts a literal string, or a supplier — sync or **async** — called fresh on
every request: `() => getCurrentJwt()` or `async () => await getCurrentJwt()` both
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
`token` prop. `<W6WProvider>` takes five more props for exactly this:

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

export default function W6WLayout({ children }: { children: React.ReactNode }) {
  return (
    <W6WProvider
      baseUrl="https://api.example.com"
      ready={true}
      identityKey={`${session.subject}:${session.account}`}
      headers={{ "X-W6W-Tenant": session.tenantId }}
      refreshOnUnauthorized
      onUnauthorized={() => redirectToLogin()}
      token={async () => {
        // Your own backend route, not w6w's — it holds whatever credential
        // mints a w6w token for this signed-in user (a tenant exchange, a
        // cached short-lived token, …). This is a Next.js App Router layout,
        // so it is a Client Component ("use client" above) even though the
        // token-minting route itself runs on your server.
        const res = await fetch("/api/w6w-token");
        if (!res.ok) return null;
        const { token } = await res.json();
        return token;
      }}
    >
      {children}
    </W6WProvider>
  );
}
```

The [Next.js walkthrough](https://docs.w6w.io/clients/react/nextjs/) builds the
`/api/w6w-token` route this example fetches from, with `exchangeToken` and a
cached, refreshable token supplier.

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

**`@w6w/ui` is not on npm today** (`npm view @w6w/ui` → 404, checked 2026-10-06);
the source is a public GitHub repository (`w6w-io/w6w-ui`). `createW6WUiAdapter`'s
`W6WApi` return type targets that contract *structurally* — this package needs no
change whenever `@w6w/ui` becomes reachable another way (a `git+https://`
dependency on the public repo, or a private registry). `npm i @w6w/ui` does not
resolve yet.

`createW6WUiAdapter` is built on `@w6w/sdk/console` for most members — the SAME
namespace `packages/studio`'s own facade uses for these routes
(`packages/ui/src/createW6WApi.ts` is the *other* hand-rolled client for them; this
package is not a third one) — and on the BASE `client.functions.*`/
`client.workflows.*` surface for `listFunctions`/`getFunction`/`invokeFunction`/
`listWorkflows`/`getWorkflow`/`runWorkflow`. **`client.console.*` is documented
"Studio-internal… unstable" and is deliberately excluded from `endpoints.json`'s
conformance runner** (`node/src/client.ts:114-116`). That means a `console.*`
signature change ships with no lockstep protection for this bridge beyond
`@w6w/sdk`'s own version — pin your `@w6w/sdk` version alongside `@w6w/react`'s, and
re-test the bridge on an upgrade rather than assuming it.

### Keeping `createW6WUiAdapter` in sync with the real `@w6w/ui`

`package.json`'s `devDependencies` carries a **dev-only, type-only** edge onto
`@w6w/ui` — `"@w6w/ui": "github:w6w-io/w6w-ui#<sha>"` — that this package never
ships: `files: ["dist"]` means `dist/` is the only thing npm packs and publishes, so
no installer of `@w6w/react` ever resolves or needs `@w6w/ui` at all. Its one job is
`src/__tests__/ui-conformance.test.ts`, which runs at **dev/CI time only** (`npm
test`, never part of `dist/`): it compiles `src/__tests__/ui-conformance.check.ts`
against `@w6w/ui`'s real `provider.tsx` and fails, naming the member, the moment
`createW6WUiAdapter`'s return type stops being assignable to the real `W6WApi` —
closing the gap a hand-duplicated interface alone cannot (nothing previously caught
this package's `W6WApi` drifting from `@w6w/ui`'s own).

**Why a `github:<owner>/<repo>#<sha>` pin, and not a `link:`/workspace reference to
a sibling checkout:** `release.yml`'s `react` step checks out **this one repo**
(`w6w-wrappers`) with no sibling checkout and no submodules — a relative `link:` to `../../ui` resolves only in the
local devcontainer's incidental directory layout and fails `ENOENT` on every CI run
and on a fresh clone of `w6w-wrappers` alone. A `github:` spec needs nothing but a
network fetch of the one pinned commit, which is why it is the only install story
that survives both environments unchanged. The pin targets `provider.tsx` by
RELATIVE PATH, not the `@w6w/ui` package barrel — the barrel's own import chain
reaches `@w6w/expr` (`packages/core`) via a `github:…#path:` subpath npm does not
honor on a `github:` dependency, which `TS2307`s the moment anything resolves it;
`provider.tsx`'s own closure (`theme.ts` → `types.ts` → `react`) has no such edge.

**Moving the pin:** update the `#<sha>` in `package.json`'s `@w6w/ui` entry to a
commit on `w6w-io/w6w-ui`'s `main` (`git ls-remote https://github.com/w6w-io/w6w-ui
main`) and run `npm install` again to refresh `package-lock.json`'s resolved
entry — no code change is required unless `@w6w/ui`'s `W6WApi` itself changed
shape, in which case `ui-conformance.test.ts` will say so.

## Hooks catalog

Every read hook returns `{data, error, loading, refetch}`; every mutation hook
returns `{call, data, error, loading}`. None depends on react-query or any other
data-fetching library.

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
  switch, or an unmount all abort the in-flight `AbortSignal` — see `src/hooks.ts`'s
  module header) — but there is no option to pass your OWN `AbortSignal` into a hook
  from outside it. `useW6WClient()` plus the underlying SDK method (which does take a
  `signal`) is the escape hatch if you need that.
