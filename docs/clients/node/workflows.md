---
id: null
key: "node/workflows"
title: "Workflows, Functions and Endpoints"
section: "clients"
description: "Run workflows and wait for their results, cancel runs, call Functions and Endpoints by name, and create or edit their definitions from the Node SDK."
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

# Workflows, Functions and Endpoints

This page covers the Node SDK calls you use once you've built something in w6w: running a
Workflow and reading its result, calling a Function or Endpoint by its key, and creating or editing
their definitions from code.

## Before you start

- A working client. See the [Node SDK](/clients/node/) page.
- A workflow, Function or Endpoint to run. Find their ids with `client.workflows.list()` and
  `client.functions.list()`, or copy them from Studio.

## Run a workflow and wait for the result

`client.workflows.run()` starts a run. Pass `wait: true` to have the server hold the request until
the run finishes:

```ts
import { W6WClient } from "@w6w/sdk";

const client = new W6WClient();

const run = await client.workflows.run("wf_01H…", {
  wait: true,
  input: { email: "a@example.com" },   // what the workflow's trigger receives
  variables: { region: "eu" },         // seeds the run's variables
});

console.log(run.runId, run.status);
```

You should see a `run_…` id and a status of `succeeded` or `failed`. The workflow argument can be
its `wf_…` id or its key.

The options:

| Option | What it does |
| --- | --- |
| `wait` | `true` waits for the run to finish, up to the server's time limit. Leave it out to queue the run and return straight away with status `queued`. |
| `input` | The data the workflow's trigger receives. Steps read it from the trigger's output. |
| `variables` | Values for the run's variables. |
| `trigger` | What started the run. Defaults to `"manual"`. |

## Check a run's result

A run that fails is a result, not an exception. Check `terminal` and `status`:

```ts
if (!run.terminal) {
  console.log("Still going:", run.runId, run.status); // queued or running
} else if (run.status === "succeeded") {
  console.log(run.output);
} else {
  console.error(run.status, run.error, run.stepErrors);
}
```

| Field | What it holds |
| --- | --- |
| `runId` | The run's id, `run_…`. |
| `status` | `queued`, `running`, `succeeded`, `failed` or `canceled`. |
| `terminal` | `true` once the status is `succeeded`, `failed` or `canceled`. |
| `output` | The workflow's output, when it succeeded. |
| `error` | Why it failed, when it failed. |
| `stepErrors` | The steps that failed, each with its `stepId` and `error`. |
| `steps` | Each step's recorded state, keyed by step id. |
| `httpStatus` | `200` when the run finished, `202` when it's queued or still running. |

If the run takes longer than the server will wait, you get it back with `terminal: false` and
status `running`. That isn't an error.

### Follow a run that's still going

The SDK doesn't poll for you. To check on a run later, read it with `client.request()`:

```ts
import { path } from "@w6w/sdk";

const { body } = await client.request<{ run: { status: string; output?: unknown } }>({
  method: "GET",
  path: path`/runs/${run.runId}`,
});
console.log(body.run.status);
```

Space your checks out; a run that's queued is waiting for a worker, not stuck.

## Cancel a run

```ts
const cancel = await client.workflows.cancel("run_01H…");
console.log(cancel.status, cancel.cancelRequestedAt);
```

Cancelling is a request, not an instant stop. `status` is the run's status at the moment you asked,
so it still reads `queued` or `running`. Read the run again a little later to see `canceled`.

## Run a Function

A Function is one operation with a stable key, such as `send-welcome-email`, that w6w maps to
whichever app does the work. Call it by key or by `fn_…` id. You get its output back directly:

```ts
const output = await client.functions.run("send-welcome-email", {
  payload: { to: "a@example.com", name: "Ada" },
});
console.log(output);
```

| Error | Meaning |
| --- | --- |
| `404 unknown_function` | No Function with that key or id exists for you. |
| `422 function_incomplete` | The Function exists but has nothing to run yet. Finish it in Studio. |
| `424` | The app behind the Function failed. `err.raw` holds the vendor's error. |

## Run an Endpoint

An Endpoint is a named entry point that runs an action, a Function or a Workflow. Call it by key or
by `ep_…` id. Because it can run any of those, you get the same tagged result as `client.run()`:

```ts
import { isFunctionRun, isWorkflowRun } from "@w6w/sdk";

const result = await client.endpoints.run("signup", { payload: { email: "a@example.com" } });

if (isWorkflowRun(result)) console.log("queued run", result.runId);
else if (isFunctionRun(result)) console.log(result.output);
```

A missing Endpoint raises `404 unknown_endpoint`.

## Read and edit a workflow definition

Workflows are usually built in Studio. You can also read, create and change their definitions from
code, for example to keep them in version control.

1. Read the current definition and its `updatedAt`:

   ```ts
   const { workflow, updatedAt } = await client.workflows.get("wf_01H…");
   ```

2. Change what you need and send the **whole** definition back. An update replaces the stored
   definition, so a field you leave out is removed. Pass `updatedAt` as `ifUnmodifiedSince` so
   the save is refused if someone else changed the workflow in the meantime:

   ```ts
   const saved = await client.workflows.update(
     "wf_01H…",
     { ...workflow, description: "Sends the welcome email" },
     { ifUnmodifiedSince: updatedAt },
   );
   console.log(saved.workflow.id, saved.updatedAt);
   ```

   You should see the workflow's id and a new `updatedAt`. If you get `409 workflow_stale`, read it
   again and reapply your change.

3. To create a workflow, pass a definition. If it has no `id`, the SDK assigns a new `wf_…` id:

   ```ts
   const { workflow: original } = await client.workflows.get("wf_01H…");
   const { id: _oldId, ...copy } = original;

   const created = await client.workflows.create({ ...copy, name: `${original.name} (copy)` });
   console.log(created.workflow.id);
   ```

   `created.scheduled` is `true` when the definition carried a schedule and this save set it up.

4. Deleting takes two calls. Archive the workflow first, then delete it:

   ```ts
   await client.workflows.archive("wf_01H…");
   await client.workflows.delete("wf_01H…");
   ```

   Deleting a workflow that isn't archived raises `409 workflow_not_archived`.

`workflows.list`, `create` and `update` take an optional `project`. Without it, they use the
client's default project, then your account's default project.

## Read and edit a Function definition

Functions follow the same read, change, save pattern, with the same optional concurrency check:

```ts
const { function: fn, valid, updatedAt } = await client.functions.get("fn_01H…");
console.log(valid); // false means the Function can't run yet

await client.functions.update(
  "fn_01H…",
  { ...fn, description: "Welcome email" },
  { ifUnmodifiedSince: updatedAt }, // optional: 409 function_stale if someone saved since
);

const { id, key, updatedAt: first } = await client.functions.create({
  key: "notify-team", /* inputs, impl */
});
console.log(id, key, first);
```

- `get`, `update` and `delete` take the Function's `fn_…` id. Only `run` also accepts its key.
- `update` replaces the whole definition, like workflows do.
- `create` assigns a `fn_…` id when the definition has none, and returns the id, key and first
  `updatedAt`. `update` returns the same three fields, so you can chain saves without a re-read.
- `ifUnmodifiedSince` is sent only when you pass a value. A `409 function_stale` means someone saved
  in between: reload with `get` and re-apply. `create` takes no token.

Like workflows, a Function must be archived before it can be deleted:

```ts
await client.functions.archive("fn_01H…");
await client.functions.delete("fn_01H…");
```

Deleting a Function that isn't archived raises `409 function_not_archived`.

## Versions and draft runs

Workflows and Functions share one set of version methods: `listVersions(id)`, `getVersion(id, n)`,
`publish(id)`, `revert(id, n)`, `enable(id)`, `disable(id)` and `runVersion(id, n, options)`.

```ts
await client.workflows.update("wf_01H…", definition); // save first
const { version } = await client.workflows.publish("wf_01H…"); // snapshots the SAVED definition
const { currentPublishedVersion, versions } = await client.workflows.listVersions("wf_01H…");

const run = await client.workflows.runVersion("wf_01H…", currentPublishedVersion!, { wait: true });
await client.functions.runVersion("fn_01H…", 1, { payload: { to: "ada@example.com" } });
```

- `publish` snapshots what is **saved**, not what your editor holds. Flush any pending save first.
- `getVersion` returns the version itself and `revert` returns what was reverted, both unwrapped
  from their envelope. `enable` and `disable` return nothing.
- `revert` rewrites the live definition and does not publish it. After a workflow revert, read
  `updatedAt` again with `get` before saving with `ifUnmodifiedSince`, or you get `409 workflow_stale`.
  The same holds for a Function: a token read before `functions.revert` is `409 function_stale`
  afterwards.
- `runVersion` takes the same options as `run` (`wait`, `variables`, `trigger`, `input` for a
  workflow; `payload` for a Function).

To try a definition that was never published, pass `allowUnpublished: true` to `run`. It runs the
**saved** definition, never one you pass in, so save first:

```ts
await client.workflows.update("wf_01H…", definition);
const draft = await client.workflows.run("wf_01H…", { allowUnpublished: true, wait: true });
```

## Troubleshooting

| Symptom | Cause | What to do |
| --- | --- | --- |
| `run.terminal` is `false` after `wait: true` | The run took longer than the server waits. | Read the run later with `GET /runs/<runId>`, as shown above. |
| `run.status` is `"failed"`, no exception | A failed run is returned as data. | Read `run.error` and `run.stepErrors`. |
| `409 workflow_stale` | The workflow changed after you read it. | Call `get` again, reapply your change, and save with the new `updatedAt`. |
| `409 workflow_not_archived` | You tried to delete an active workflow. | Call `archive` first. |
| `400 invalid_workflow` | The definition is missing `name` or `steps`, or is malformed. | Start from `workflows.get()` output rather than writing one from scratch. |
| `422 function_incomplete` | The Function has no implementation yet. | Open it in Studio and finish it. |
| `409 function_not_archived` | You tried to delete an active Function. | Call `functions.archive` first. |
| `409 workflow_not_published` / `422 function_not_published` | A run needs a published version and there is none. | `publish` it, or pass `allowUnpublished: true` to `run` to use the saved definition. |
| `404 unknown_function` from `functions.get` with a key | `get`, `update` and `delete` look Functions up by id. | Use the `fn_…` id from `client.functions.list()`. |

## Where to next

- **[Documents and vars](/clients/node/documents-and-vars/)**: configuration your workflows read.
- **[Node SDK reference](/clients/node/reference/)**: every method and option.
- **[CLI](/clients/cli/)**: the same operations from a terminal or CI job.
