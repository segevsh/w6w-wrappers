# @w6w/sdk

The TypeScript client for the [w6w](https://w6w.dev) HTTP API.

It is a **thin** client: transport, auth, error mapping, and typed request/response shapes. No
business logic, no client-side polling, no hidden retries. If something useful needs two calls
composed, that composition belongs in the API, not here.

The package is authored as runtime-neutral TypeScript against Web standards (`fetch`, `Headers`,
`URL`, `AbortController`), so the same build runs under Node 18+, Deno and Bun.

- **License:** MIT (see [LICENSE](./LICENSE)).
- **Version:** `0.9.0`.

## Install

npm (compiled ESM + type declarations):

```bash
npm install @w6w/sdk
```

JSR (the TypeScript source, published verbatim):

```bash
deno add jsr:@w6w/sdk
```

Both registries publish the **same version at the same time** — `@w6w/sdk`, `@w6w/cli` and the
Python `w6w` package share one version number and are released together. A given version means the
same set of operations in every language.

## Quick start

```ts
import { isActionRun, isFunctionRun, isWorkflowRun, W6WClient } from "@w6w/sdk";

const client = new W6WClient(); // reads W6W_BASE_URL and W6W_TOKEN

// Who am I, and what versions am I talking to?
const me = await client.me();

// What can I run? `run` is addressed by a `conn_…` / `fn_…` / `ep_…` / `wf_…`
// id — these are how you discover one.
const connections = await client.connections.list();
const workflows = await client.workflows.list();
```

### Run a connection action

A `conn_…` id resolves to an app action. `run` returns a `kind`-tagged envelope — narrow it with
`isActionRun` / `isFunctionRun` / `isWorkflowRun` before reading a field, since the three arms use
different field names on purpose (`value` vs `output` vs `runId`+`status`):

```ts
const env = await client.run({
  urn: connections[0].id, // "conn_…"
  action: "send_message", // which of the app's actions to invoke
  payload: { channel: "#general", text: "Hello from @w6w/sdk" },
});

if (isActionRun(env)) console.log(env.value); // the action's return value
```

### Run a function or an endpoint

`fn_…` and `ep_…` ids run the same way — no `action`, since a function or endpoint has exactly one
operation:

```ts
const env = await client.run({
  urn: "fn_normalize_address",
  payload: { address: "1 Infinite Loop" },
});
if (isFunctionRun(env)) console.log(env.output);
```

### Run a workflow

Two ways to start a `wf_…` run. `client.run()` dispatches it like anything else and always answers
`202` (queued) — use it when you're treating workflows the same as any other runnable URN:

```ts
const env = await client.run({ urn: workflows[0].id, payload: { customerId: "cus_1" } });
if (isWorkflowRun(env)) console.log(env.runId, env.status); // "queued"
```

`workflows.run` is the typed path, and the only one that can wait for the result server-side:

```ts
const run = await client.workflows.run(workflows[0].id, {
  wait: true,
  variables: { customerId: "cus_1" },
});

// A failed run is data, not a thrown error — `run.terminal` tells you it's done.
if (run.terminal && run.status === "failed") console.error(run.error);
else if (run.terminal) console.log(run.output);
```

### Documents and vars

```ts
const doc = await client.documents.create({ key: "welcome", content: "# Hi" });
await client.documents.update(doc.id, { content: "# Hello" });
await client.documents.delete(doc.id);

const v = await client.vars.create({ name: "sender_email", type: "string", value: "a@b.c" });
await client.vars.update(v.id, { value: "c@d.e" });
```

## Configuration

Two environment variables, both read only at client construction:

| Variable       | Meaning                                                                                                                                | Required |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `W6W_BASE_URL` | The **origin** of your w6w server, e.g. `https://api.example.com`. The API is served at the root of that host, so nothing is appended. | Yes      |
| `W6W_TOKEN`    | The bearer token, sent as `Authorization: Bearer <token>` on every request.                                                            | Yes      |

Explicit constructor arguments always win over the environment, and credentials are **instance
state**: two clients in one process can hold different tokens and point at different servers with no
interference. There is no default base URL — a client built without one and without `W6W_BASE_URL`
raises a configuration error naming the variable.

```ts
import { W6WClient } from "@w6w/sdk";

// Everything from the environment.
const client = new W6WClient();

// Explicit arguments override W6W_BASE_URL and W6W_TOKEN.
const other = new W6WClient({ baseUrl: "https://api.example.com", token: "…" });
```

### The four options a host embedding w6w needs

Both variables stay plain strings. These four constructor options cover the cases a host — a partner
embedding w6w inside its own product, a backend juggling tenants — actually runs into, and none of
them has an environment-variable spelling:

| Option                  | Meaning                                                                                            |
| ----------------------- | -------------------------------------------------------------------------------------------------- |
| `token`                 | A bearer token, **or a supplier function** called fresh on every request (see below).              |
| `refreshOnUnauthorized` | Opt in to a single recovery retry when a request fails `401` / `unauthorized`. `false` by default. |
| `onUnauthorized`        | Called with the terminal `401` `ApiError`, at most once per call.                                  |
| `headers`               | Default headers sent with every request.                                                           |

```ts
const client = new W6WClient({
  baseUrl: "https://api.example.com",
  // Called (and awaited) fresh on every request — never cached from construction.
  token: () => readTenantToken(),
  refreshOnUnauthorized: true, // one retry when the server answers 401
  onUnauthorized: (err) => redirectToLogin(err), // …and what to do when that did not help
  headers: { "X-W6W-Tenant": tenantId }, // your own gateway/authorizer header
});
```

**A token supplier is how a host mints or rotates a credential out of band.** `token` takes a
`string` — sent verbatim on every call, exactly as before — or a `TokenProvider` function returning
one, which is called **fresh on every request** rather than resolved once at construction, so a
token that changes between calls is picked up without rebuilding the client. A nullish or blank
result is treated exactly like a missing static token: a `ConfigError` naming `W6W_TOKEN`, never a
request sent with no credential.

**`refreshOnUnauthorized` opts in to one recovery.** Off by default, and the behaviour before the
option existed. When a request fails `401` with `{code: "unauthorized"}` and `token` is a function,
the supplier is called once more with `{forceRefresh: true}` and, if that yields a usable value, the
**same** request is re-sent once. Nothing else is ever retried — not a second time, not another
status, and never a `requireAuth: false` request. `onUnauthorized` receives the terminal `401` error
— after a failed recovery, or immediately when recovery is off or the token is a plain string — at
most once per call, and never on success.

**`headers` is the base every per-request `headers` option builds on.** A per-request header with
the same name wins, and neither can displace the `authorization` bearer or the `content-type` the
client sets for a JSON body.

### `W6W_BASE_URL` is an origin

The API is served at the **root** of its own host — `https://api.example.com/vars`, not `…/api/vars`
— so the client appends **nothing**. Trailing slashes never matter, and any path you configure is
preserved verbatim, because it is indistinguishable from a real gateway prefix:

| `W6W_BASE_URL`               | Requests go to                 |
| ---------------------------- | ------------------------------ |
| `https://api.example.com`    | `https://api.example.com/…`    |
| `https://api.example.com/`   | `https://api.example.com/…`    |
| `https://api.example.com///` | `https://api.example.com/…`    |
| `https://api.example.com/gw` | `https://api.example.com/gw/…` |

> **Breaking in `0.2.0`.** The client used to append `/api`. If your `W6W_BASE_URL` ends in `/api`
> because of that, **drop the suffix** — the path is now preserved rather than deduplicated, so a
> stale one 404s on every call. It is not stripped for you: a configured path is exactly how a
> deployment behind a gateway prefix is addressed, and silently removing it would break those.

A variable that is **set but empty** — or whitespace-only — counts as **unset**, in both variables.
`W6W_BASE_URL=` is how a shell or a Dockerfile spells "I meant to set this and did not", so it
raises the same configuration error as an absent one rather than quietly producing a relative URL.
An empty string passed _explicitly_ to the constructor is likewise an error, and does not fall back
to the environment.

### `W6W_TOKEN`

Sent as `Authorization: Bearer <token>` on **every** request — there are no anonymous operations on
this API. A client with no token can still be constructed (so tools that only print help or a
version work offline); the configuration error naming `W6W_TOKEN` surfaces on the first request.

The variable is a plain string only. A credential that has to change between requests is spelled in
the constructor — `token: () => …`, [above](#the-four-options-a-host-embedding-w6w-needs) — never in
the environment.

## Errors

Two error types, and the difference between them is diagnostic:

- **`ConfigError`** — the client never got as far as a request: no base URL, or no token.
- **`ApiError`** — carries `status`, `code`, `message` and `raw` (the parsed response body, kept
  because an error body carries fields the message drops). It covers exactly three cases: a
  transport failure (`status: 0`, code `network_error`), a non-JSON body on a failing status (code
  `bad_response`, with a snippet of what actually came back — usually a proxy's HTML error page),
  and the server's own error envelope (its `code` and `message`, verbatim).

Classify by `status`, and by a **prefix** of `code` (`unknown_*`, `invalid_*`, `*_exists`) — never
by an exhaustive list of codes, which the server extends freely. Note that a `424` means the target
app or its upstream vendor failed, not that w6w did; it is passed through untouched.

Nothing is retried, no token is refreshed, and a `401` has no side effect beyond the raised error —
unless you opted in with `refreshOnUnauthorized`, which retries the failed request exactly once (see
[the four options a host embedding w6w needs](#the-four-options-a-host-embedding-w6w-needs)).

## Embedding for enterprise tenants

If you are a partner embedding w6w inside your OWN product, your backend mints a short-lived,
per-user w6w token with one call — `exchangeToken`, from a **separate** entry point,
`@w6w/sdk/server`, never from `@w6w/sdk` itself:

```ts
import { exchangeToken } from "@w6w/sdk/server";
```

This is a backend-only function: it takes your tenant's `clientId`/`clientSecret`, which must never
reach a browser or a mobile client. A typical route on your OWN backend — never called directly from
your frontend — looks like this:

```ts
// Your backend, e.g. POST /api/w6w-token
app.post("/api/w6w-token", async (req, res) => {
  const session = await readPartnerSession(req); // YOUR auth, not w6w's

  // Exchange trusts whatever `account` it is given — w6w has no way to verify
  // it against your own data, so YOU derive it from YOUR OWN membership data,
  // never from an unauthenticated client input (a query param, a request body
  // field a browser could set).
  const account = await yourOwnMembershipLookup(session.userId);

  const { token, expiresIn } = await exchangeToken({
    baseUrl: process.env.W6W_BASE_URL!,
    clientId: process.env.W6W_TENANT_CLIENT_ID!,
    clientSecret: process.env.W6W_TENANT_CLIENT_SECRET!, // never sent to the browser
    subject: session.userId,
    account,
  });

  res.json({ token, expiresAt: Date.now() + expiresIn * 1000 });
});
```

Your frontend calls `/api/w6w-token`, gets `{ token, expiresAt }`, and uses `token` as `W6W_TOKEN`/a
bearer for the rest of the session — the tenant secret itself never leaves your backend. Credentials
travel only as an HTTP `Authorization: Basic base64(clientId:clientSecret)` header — never in the
request body, the URL or a query string — and every malformed input (a blank
`clientId`/`clientSecret`/`subject`, a `clientId` containing `:`, a non-latin-1
`clientId`/`clientSecret`) raises a local `ConfigError` before any network call. See
[`../docs/sdk-surface.md`](../docs/sdk-surface.md) "Server-only subpath — `@w6w/sdk/server`" for the
full contract (both languages), and `.claude/docs/usage/partner/partner-ui-embedding.md` (internal —
private `w6w-io/w6w` — for the broader embedding picture this token feeds into).

## The surface

What operations exist is not decided in this repo. It is defined by the shared machine-readable
contract **`endpoints.json`**, which all three w6w wrappers implement and which each one's
conformance test reads directly — the same file, never a vendored copy. An operation missing from a
wrapper is a failing test, not a preference.

Some operations are marked `planned` in that contract: they are implemented and unit-tested here,
but the corresponding server route is not live yet, so calling them against a server today returns
`404`. The marker records **server** readiness, not wrapper completeness.

## Versioning

The version is a shared fact across all three wrappers, so a release may go out for this package
even when nothing in it changed — a divergent version is far more expensive than an empty release.

Below `1.0.0`, **breaking changes may land in a minor bump.** That grace ends at `1.0.0`; do not
plan around it.

## Development

The gates are Deno tasks. They need no network and no server:

```bash
deno task check      # typecheck mod.ts, src/ and tests/
deno task lint
deno task fmt:check
deno task test       # every test runs against a mocked transport
deno task cov        # test with coverage, then report it
```

Tests **never** require a live server. The npm `dist/` build (`npm run build`, i.e.
`tsc -p tsconfig.build.json`) runs in CI only; `src/*.ts` is the single authored source for both
registries.
