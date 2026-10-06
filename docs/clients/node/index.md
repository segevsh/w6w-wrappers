---
id: null
key: "node"
title: "Node SDK"
section: "clients"
description: "Install @w6w/sdk, authenticate, and call your connected apps, Functions, Endpoints and Workflows from TypeScript or JavaScript."
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

# Node SDK

`@w6w/sdk` is the TypeScript client for w6w. It runs on Node.js 18+, Deno and Bun, ships its own
types, and has no runtime dependencies. This page takes you from install to a first action call,
then covers errors and how to reach any route the SDK doesn't wrap yet.

## Before you start

- A w6w base URL and an API token. See [Configure](/clients/overview/#configure).
- At least one connected app, if you want to run an action.
- Node.js 18 or later, Deno, or Bun.

## 1. Install the package

```bash
npm install @w6w/sdk       # npm, compiled ESM with type declarations
deno add jsr:@w6w/sdk      # Deno, from JSR
```

## 2. Set your credentials

```bash
export W6W_BASE_URL=https://<your-host>   # your API origin, no trailing path
export W6W_TOKEN=…                         # Studio → Settings → API tokens
```

## 3. Create a client and check who you are

```ts
import { W6WClient } from "@w6w/sdk";

const client = new W6WClient(); // reads W6W_BASE_URL and W6W_TOKEN

const me = await client.me();
console.log(me.tenant, me.account, me.role);
```

You should see your tenant, account and role printed. `me.versions.wrapper` is your SDK's version,
the first thing to include in a bug report.

To configure the client in code instead, pass options. Explicit options win over the environment:

```ts
const client = new W6WClient({
  baseUrl: "https://<your-host>",
  token: process.env.MY_W6W_TOKEN,
  project: "prj_01H…", // optional: default project for documents and workflows
});
```

Each client holds its own settings, so two clients in one process can use different servers and
tokens without affecting each other.

## 4. Find something to run

Everything you can run has an id: `conn_…` for a connection, `fn_…` for a Function, `ep_…` for an
Endpoint and `wf_…` for a Workflow. List them to find one:

```ts
const connections = await client.connections.list();
for (const c of connections) console.log(c.id, c.appId, c.state);

const workflows = await client.workflows.list();
const functions = await client.functions.list();
```

A connection you can use has `state: "connected"`.

## 5. Run an action

`client.run()` runs whatever an id points at. For a connection, name the action and pass its input
as `payload`:

```ts
import { isActionRun, W6WClient } from "@w6w/sdk";

const client = new W6WClient();

const result = await client.run({
  urn: "conn_01H…",
  action: "send_message",
  payload: { channel: "#general", text: "Hello from w6w" },
});

if (isActionRun(result)) {
  console.log(result.output);       // what the app's action returned
  console.log(result.invocationId); // inv_…, the record of this call
}
```

You should see the action's result printed. The result is tagged with a `kind`: `action`,
`function` or `workflow`. Check it with `isActionRun`, `isFunctionRun` or `isWorkflowRun` before
you read a field. A `kind` your SDK version doesn't know yet comes back as-is instead of failing.

The same call runs a Function (`fn_…`), an Endpoint (`ep_…`) or a Workflow (`wf_…`). Leave out
`action`, because each of those does exactly one thing. A workflow started this way is queued, not
awaited: you get back a `runId` with status `queued`. To wait for a workflow's result, use
`client.workflows.run()`. See [Workflows, Functions and Endpoints](/clients/node/workflows/).

## Handle errors

The SDK raises two error types:

- **`ConfigError`**: the client never sent a request. The base URL or the token is missing or
  malformed. The message names the variable to fix.
- **`ApiError`**: the request failed. It carries `status`, `code`, `message` and `raw`, which is
  the parsed response body when there was one.

```ts
import { ApiError, ConfigError } from "@w6w/sdk";

try {
  await client.functions.run("send-welcome-email", { payload: { to: "a@example.com" } });
} catch (err) {
  if (err instanceof ConfigError) {
    console.error("Fix your configuration:", err.message);
  } else if (err instanceof ApiError) {
    if (err.status === 0) console.error("Could not reach w6w:", err.message);
    else if (err.code.startsWith("unknown_")) console.error("Not found:", err.message);
    else if (err.status === 424) console.error("The app's own API failed:", err.raw);
    else console.error(`[${err.status} ${err.code}] ${err.message}`);
  } else {
    throw err;
  }
}
```

Read errors by `status` and by the start of `code`, not by an exact list of codes, because w6w adds
new codes over time:

| What you see | What it means |
| --- | --- |
| `status 0`, `code "network_error"` | The request never got a response: wrong base URL, DNS, or the server is down. |
| `status 0`, `code "cancelled"` | You aborted the call with an `AbortSignal`. |
| `code "bad_response"` | The response wasn't the JSON w6w sends, often a proxy's HTML error page. `message` includes a snippet of what came back. |
| `401`, `code "unauthorized"` | The token is wrong, disabled, revoked or expired. |
| `400`, `code` starting `invalid_` | The request was rejected as malformed. `message` says which field. |
| `404`, `code` starting `unknown_` | The id or key doesn't exist for you. |
| `409`, `code` ending `_exists` | Something with that key or name already exists. |
| `422`, such as `function_incomplete` | The Function exists but can't run yet: it's incomplete, disabled or unpublished. |
| `424` | The app's own API failed while w6w ran the call. `raw` holds the vendor's error. |

A workflow run that fails is not an error. It comes back as a result with `status: "failed"`. See
[Workflows, Functions and Endpoints](/clients/node/workflows/#check-a-runs-result).

### Retries

The SDK never retries on its own and never polls. If a call fails, it raises once and you decide
what to do. The one exception is opt-in: with a token supplier and `refreshOnUnauthorized: true`,
a `401` asks your supplier for a fresh token and retries that request once. See
[Embed w6w in your product](/guides/embed/).

If you add your own retries, only retry `network_error` and `5xx` responses, and only for calls
that are safe to repeat. A `4xx` won't succeed on a second try.

### Cancel a call

Read operations take an `AbortSignal`, so you can give up on a slow call:

```ts
const controller = new AbortController();
setTimeout(() => controller.abort(), 5_000);

const connections = await client.connections.list({ signal: controller.signal });
```

An aborted call raises `ApiError` with `status 0` and code `cancelled`.

## Call a route the SDK doesn't wrap

`client.request()` sends any request with the client's own base URL, token and default headers,
and raises the same `ApiError` on failure. Build the path with the `path` tag, which percent-encodes
every value you interpolate:

```ts
import { path, W6WClient } from "@w6w/sdk";

const client = new W6WClient();
const runId = "run_01H…";

const { status, body } = await client.request<{ run: { status: string } }>({
  method: "GET",
  path: path`/runs/${runId}`,
});
console.log(status, body.run.status);
```

You should see `200` and the run's current status. `request` takes `method` (`GET`, `POST`,
`PATCH`, `PUT` or `DELETE`), `path`, and optionally `query`, `body`, `headers` and `signal`. It
returns the HTTP status alongside the parsed body, because some w6w routes answer `202` on success.

Use `path` for every value that comes from a variable. A key like `a/b` concatenated into a URL
addresses a different route than the one you meant.

> **Good to know:** `@w6w/sdk/console` exposes more of the API, the same calls Studio makes. It's
> unstable and can change in any release, so prefer `client.request()` for anything you ship.

## Troubleshooting

| Symptom | Cause | What to do |
| --- | --- | --- |
| `ConfigError: No w6w base URL is configured` | `W6W_BASE_URL` is unset or empty. | Export it, or pass `baseUrl`. |
| `ConfigError: No w6w API token is configured` | `W6W_TOKEN` is unset or empty, or your token supplier returned nothing. | Export it, or pass `token`. |
| `ApiError` with `status` `401`, `code` `unauthorized` | The token is wrong, disabled or revoked. | Create a new token in Studio → **Settings** → **API tokens**. |
| `ApiError` with `status` `404`, `code` `unknown_connection`, from `run` | The `conn_…` id isn't yours, or was deleted. | Run `client.connections.list()` and use an id from it. |
| `ApiError` with `status` `424`, from `run` | The app's own API refused the call. | Read `err.raw` for the vendor's message, and check the connection's health in Studio. |
| `TypeError: client.workflows.cancel is not a function` | Your installed SDK predates that method. | Upgrade `@w6w/sdk`. See [Versions](/clients/overview/#versions). |

## Where to next

- **[Workflows, Functions and Endpoints](/clients/node/workflows/)**: run them, wait for results,
  cancel runs, and create or edit definitions.
- **[Documents and vars](/clients/node/documents-and-vars/)**: store configuration your workflows
  read.
- **[Embed w6w in your product](/guides/embed/)**: per-user tokens, rotating
  credentials and the backend token exchange.
- **[Node SDK reference](/clients/node/reference/)**: every method and option on one page.
