---
id: null
key: "react/hooks"
title: "Hooks reference"
section: "clients"
description: "Every W6WProvider prop and every hook in @w6w/react, with what each one wraps."
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

# Hooks reference

Everything `@w6w/react` exports. For a walkthrough, start with the [React](/clients/react/) page.

## `<W6WProvider>`

| Prop | Type | Default | What it does |
| --- | --- | --- | --- |
| `baseUrl` | `string` | required | Your w6w API origin, such as `https://<your-host>`. |
| `token` | `string` or a function | none | A literal token, or a supplier called per request (concurrent requests share one call, nothing is cached once it settles). May be async. Called with `{ forceRefresh: true }` on a refresh retry. Pass exactly one of `token` or `getSession`; the provider throws if you pass both or neither. |
| `getSession` | `() => Promise<{ token, expiresAt, expiresIn? }>` | none | Mints a session, usually by calling your backend's session endpoint. The provider calls it lazily, one call at a time, caches the session, renews it before it expires and re-checks on tab resume. Needs `@w6w/react` 0.9.13 or later. See [`useW6WSession`](#usew6wsession). |
| `renewBeforeMs` | `number` | `30000` | With `getSession`: renew this many milliseconds before expiry, capped at half the session's lifetime. |
| `ready` | `boolean` | `true` | While `false`, read hooks send nothing and report `loading: true`. Set it once you have a token. Gates read hooks only; `useW6WSession()` does not look at it in `getSession` mode. |
| `identityKey` | `string` | none | Who the client speaks for, such as `` `${userId}:${accountId}` ``. Changing it rebuilds the client and clears every read hook's data, so one user's data never shows under another. With `getSession` it must change whenever the user or account behind the callback changes: it also discards the cached session. |
| `refreshOnUnauthorized` | `boolean` | `false` | On a `401 unauthorized`, ask the token supplier for a fresh token and retry the request once. |
| `onUnauthorized` | `(err) => void` | none | Called with the final `401` error, at most once per call. Use it to send the user to sign in. |
| `headers` | `Record<string, string>` | none | Headers sent with every request. Compared by content, so a new object with the same values doesn't rebuild the client. |
| `project` | `string` | your account's default | Default project for documents and workflows. |
| `fetch` | `typeof fetch` | the global `fetch` | Your own fetch, for tests. |

## `useW6WSession`

```tsx
import { useW6WSession } from "@w6w/react";

const { status, expiresAt, error, refresh } = useW6WSession();
```

Returns the nearest provider's session state. Use it to show a "reconnecting" state or a retry
button; the hooks themselves already wait for and renew the session.

| Field | Type | Meaning |
| --- | --- | --- |
| `status` | `"loading"`, `"ready"`, `"renewing"`, `"expired"` or `"error"` | `loading`: no session yet or the first one is being fetched. `ready`: a session is held and not expired. `renewing`: a new one is being fetched while the old one is held. `expired`: the held session has expired and no renewal is running. `error`: the last `getSession` call failed. |
| `expiresAt` | `string` or `null` | The held session's `expiresAt`, or `null` before the first session. |
| `error` | `unknown` | The last `getSession` failure, until the next attempt starts. |
| `refresh` | `() => Promise<void>` | Starts a renewal, or joins one already running. Resolves when it settles and never rejects: read `error`. |

With a `token` provider, `status` is `"ready"` when the provider's `ready` is `true` (else
`"loading"`), `expiresAt` is `null`, and `refresh()` resolves without doing anything.

The 401 recovery (`refreshOnUnauthorized`) is the SDK's: it retries any method, `POST` included,
once with a fresh token. The provider adds no retry of its own.

On an `identityKey` change, read hooks abort and blank. A mutation already in flight is not
cancelled: it keeps the old client's request and token, its result still lands in the mutation
hook's state, and that state is not reset. This release leaves that unchanged.

Keep the provider above any `<Suspense>` boundary that can suspend again after the first render. A
re-suspending boundary above or around it detaches the session store, and reads fail with a
"disposed" error until the boundary shows again. A wrong token is never sent.

## Read hooks

Each returns `{ data, error, loading, refetch }`. They load on mount, reload when their arguments
or the client change, and cancel a request that's no longer needed.

Hooks asking for the same thing (same hook, same arguments, same provider) while a request is in
flight share one request, so two components, or React StrictMode's mount-unmount-mount, send a
single fetch. A shared request is cancelled only when the last hook using it goes away. Nothing is
kept once it finishes: a hook that mounts later sends a new request.

| Hook | Loads |
| --- | --- |
| `useMe()` | Your identity: `tenant`, `subject`, `account`, `role`, `versions` |
| `useConnections()` | Your connections |
| `useWorkflows({ project? })` | Your workflows |
| `useWorkflow(id)` | One workflow's definition and `updatedAt` |
| `useFunctions()` | Your Functions |
| `useFunction(id)` | One Function's definition and `valid` |
| `useDocuments({ project? })` | Documents in a project |
| `useDocument(id, { project? })` | One document by id |
| `useDocumentByKey(key, { project? })` | One document by key |
| `useVars()` | Your vars |
| `useVar(id)` | One var |

## Mutation hooks

Each returns `{ call, data, error, loading }`. `call` takes the same arguments as the SDK method it
wraps, resolves with its result, and rejects on failure. None of them refresh a read hook; call its
`refetch` afterwards.

| Hook | `call(...)` runs |
| --- | --- |
| `useRun()` | `client.run({ urn, action?, payload? })` |
| `useRunWorkflow()` | `client.workflows.run(idOrKey, options)`, with `wait: true` unless you pass `wait: false` |
| `useCreateWorkflow()` | `client.workflows.create(definition, { project? })` |
| `useUpdateWorkflow()` | `client.workflows.update(id, definition, { project?, ifUnmodifiedSince? })` |
| `useArchiveWorkflow()` | `client.workflows.archive(id)` |
| `useDeleteWorkflow()` | `client.workflows.delete(id)`, after archiving |
| `useCreateFunction()` | `client.functions.create(definition)` |
| `useUpdateFunction()` | `client.functions.update(id, definition)` |
| `useDeleteFunction()` | `client.functions.delete(id)` |
| `useCreateDocument()` | `client.documents.create({ key, content, format?, description? }, { project? })` |
| `useUpdateDocument()` | `client.documents.update(id, patch, { project? })` |
| `useDeleteDocument()` | `client.documents.delete(id, { project? })` |
| `useCreateVar()` | `client.vars.create({ name, type, value, description? })` |
| `useUpdateVar()` | `client.vars.update(id, patch)` |
| `useDeleteVar()` | `client.vars.delete(id)` |

`useUpdateWorkflow` and `useUpdateFunction` replace the whole definition. Read it with
`useWorkflow` or `useFunction`, change it, and send all of it back. Pass the `updatedAt` from
`useWorkflow` as `ifUnmodifiedSince` so you don't overwrite someone else's edit:

```tsx
import { useUpdateWorkflow, useWorkflow } from "@w6w/react";

function RenameWorkflow({ id }: { id: string }) {
  const { data, refetch } = useWorkflow(id);
  const update = useUpdateWorkflow();

  async function rename(name: string) {
    if (!data) return;
    await update.call(id, { ...data.workflow, name }, { ifUnmodifiedSince: data.updatedAt });
    refetch();
  }

  return (
    <button type="button" disabled={!data || update.loading} onClick={() => rename("Renamed")}>
      Rename
    </button>
  );
}
```

## No hook? Use the client

These have no hook. Call them on the client from `useW6WClient()`:

| Task | Call |
| --- | --- |
| Run a Function by key | `client.functions.run(key, { payload })` |
| Run an Endpoint | `client.endpoints.run(key, { payload })` |
| Cancel a run | `client.workflows.cancel(runId)` |
| Manage your team | `client.team.members()`, `client.team.invite(...)`, and the rest |
| Any other route | `client.request({ method, path })` |

See the [Node SDK reference](/clients/node/reference/) for each one.

## Other exports

| Export | What it does |
| --- | --- |
| `useW6WClient()` | Returns the provider's `W6WClient`. Throws outside a `<W6WProvider>`. |
| `useW6WSession()` | The session state described above. |
| `createW6WUiAdapter(client)` | Adapts the client for `@w6w/ui` components. `@w6w/ui@0.1.0` is available on npm. |
| `VERSION` | The installed `@w6w/react` version. |

## Where to next

- **[Next.js and token minting](/clients/react/nextjs/)**: wire the provider to per-user tokens.
- **[React](/clients/react/)**: the walkthrough.
