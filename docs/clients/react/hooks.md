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
| `token` | `string` or a function | required | A token, or a supplier called before every request. May be async. Called with `{ forceRefresh: true }` on a refresh retry. |
| `ready` | `boolean` | `true` | While `false`, read hooks send nothing and report `loading: true`. Set it once you have a token. |
| `identityKey` | `string` | none | Who the client speaks for, such as `` `${userId}:${accountId}` ``. Changing it rebuilds the client and clears every hook's data, so one user's data never shows under another. |
| `refreshOnUnauthorized` | `boolean` | `false` | On a `401 unauthorized`, ask the token supplier for a fresh token and retry the request once. |
| `onUnauthorized` | `(err) => void` | none | Called with the final `401` error, at most once per call. Use it to send the user to sign in. |
| `headers` | `Record<string, string>` | none | Headers sent with every request. Compared by content, so a new object with the same values doesn't rebuild the client. |
| `project` | `string` | your account's default | Default project for documents and workflows. |
| `fetch` | `typeof fetch` | the global `fetch` | Your own fetch, for tests. |

## Read hooks

Each returns `{ data, error, loading, refetch }`. They load on mount, reload when their arguments
or the client change, and cancel a request that's no longer needed.

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
| `createW6WUiAdapter(client)` | Adapts the client for `@w6w/ui` components. `@w6w/ui` isn't published to npm yet. |
| `VERSION` | The installed `@w6w/react` version. |

## Where to next

- **[Next.js and token minting](/clients/react/nextjs/)**: wire the provider to per-user tokens.
- **[React](/clients/react/)**: the walkthrough.
