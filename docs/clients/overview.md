---
id: null
key: "overview"
title: "Clients overview"
section: "clients"
description: "Pick the w6w client for your stack, install it, and point it at your account with two environment variables."
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

# Clients overview

W6W ships four official clients. Every one of them talks to the same w6w API with the same token,
so you can call your connected apps, Functions, Endpoints and Workflows from whichever stack your
product already runs on. Use a client rather than raw HTTP: they handle authentication, path
encoding and error mapping for you, and they all expose an escape hatch for any route they don't
wrap yet.

## Which client to pick

| You're writing | Use | Package |
| --- | --- | --- |
| A Node.js, Deno or Bun service, script or backend | [Node SDK](/clients/node/) | `@w6w/sdk` (npm and JSR) |
| A React app, in the browser | [React](/clients/react/) | `@w6w/react` (npm) |
| Shell scripts, CI jobs, or quick checks from a terminal | [CLI](/clients/cli/) | `@w6w/cli` (npm), command `w6w` |
| A Python 3.9+ service or script | [Python](/clients/python/) | `w6w` (PyPI) |

The React package is built on the Node SDK: it adds a provider and hooks, and hands you the same
SDK client for everything else. The CLI is built on the Node SDK too.

## Install

```bash
npm install @w6w/sdk           # Node.js / TypeScript
deno add jsr:@w6w/sdk          # Deno, from JSR
npm install @w6w/react react   # React (pulls in @w6w/sdk)
npm install -g @w6w/cli        # the w6w command
pip install w6w                # Python
```

The Node SDK, React package and CLI need Node.js 18 or later. The Python package needs Python 3.9
or later and has no third-party dependencies.

## Configure

Every client reads the same two environment variables:

| Variable | What it holds | Where it comes from |
| --- | --- | --- |
| `W6W_BASE_URL` | Your w6w API's origin, such as `https://<your-host>`. No path: the API is served at the root of that host. | The base URL you got with your account. |
| `W6W_TOKEN` | An API token, sent as `Authorization: Bearer <token>` on every request. | Studio → **Settings** → **API tokens** → **+ Create token**. The secret is shown once. |

```bash
export W6W_BASE_URL=https://<your-host>   # your API origin, no trailing path
export W6W_TOKEN=…                         # Studio → Settings → API tokens
```

An empty value counts as unset. If `W6W_BASE_URL` is missing, the client refuses to start. If
`W6W_TOKEN` is missing, it refuses on the first call. Either way you get a configuration error that
names the variable.

Every client also accepts the base URL and token as explicit arguments, which win over the
environment. The React provider is the exception: a browser has no environment, so you always pass
both as props.

## Make your first call

Ask w6w who you are. This is the quickest way to prove the base URL and token are right.

{% cli %}

```bash
w6w me
```

{% endcli %}

{% sdk-node %}

```ts
import { W6WClient } from "@w6w/sdk";

const client = new W6WClient(); // reads W6W_BASE_URL and W6W_TOKEN
const me = await client.me();
console.log(me.account, me.role);
```

{% endsdk-node %}

{% sdk-python %}

```python
from w6w import Client

client = Client()  # reads W6W_BASE_URL and W6W_TOKEN
me = client.me()
print(me.account, me.role)
```

{% endsdk-python %}

{% sdk-react %}

```tsx
import { useMe } from "@w6w/react";

function WhoAmI() {
  const { data, loading, error } = useMe();
  if (loading) return <p>Loading…</p>;
  if (error) return <p>Failed: {String(error)}</p>;
  return <p>{data?.account}</p>;
}
```

{% endsdk-react %}

You should see your tenant, user, account and role. A `401` means the token is wrong or revoked.
A `network_error` means the base URL doesn't reach a w6w server.

## What every client can do

The four clients cover the same operations, named in each language's own style:

| Area | Operations |
| --- | --- |
| Identity | `me`: who you are, and which client version you're running |
| Run anything | `run`: call a connection's action (`conn_…`), a Function (`fn_…`), an Endpoint (`ep_…`) or a Workflow (`wf_…`) by id |
| Connections | `connections.list` |
| Workflows | `list`, `run` (optionally waiting for the result), `cancel`, `get`, `create`, `update`, `archive`, `delete` |
| Functions | `run` by key or id, `list`, `get`, `create`, `update`, `delete` |
| Endpoints | `run` by key or id |
| Documents | `list`, `get`, `getByKey`, `create`, `update`, `delete` |
| Vars | `list`, `get`, `getByName`, `create`, `update`, `delete` |
| Team | `members`, `invite`, `invites`, `revokeInvite`, `setRole`, `removeMember` |

Each client also has a `request` method for routes that don't have a wrapper yet. It uses the
client's own base URL and token, so you never hand-roll a second HTTP client.

## Versions

All four clients release together at one shared version number. A given version means the same
set of operations in every language, so `@w6w/sdk`, `@w6w/react`, `@w6w/cli` and `w6w` at the same
version always agree. Below 1.0, a minor release may include breaking changes, so pin the version
you test against.

These pages describe the 0.9 line. Check what you have installed:

```bash
npm ls @w6w/sdk                                # Node SDK (also shows @w6w/react's copy)
w6w --version                                  # CLI
python -c "import w6w; print(w6w.__version__)" # Python
```

> **Good to know:** if a method on these pages is missing from your installed client, your version
> predates it. These arrived after 0.6.0: the workflow and Function definition operations
> (`get`, `create`, `update`, `archive`, `delete`, `functions.list`), `workflows.cancel`, the
> `team` operations, token suppliers with `refreshOnUnauthorized` and `onUnauthorized`, default
> `headers`, the backend token exchange, request cancellation with `signal`, and the React
> definition hooks.

## Troubleshooting

| Symptom | Cause | What to do |
| --- | --- | --- |
| `No w6w base URL is configured` | `W6W_BASE_URL` is unset or empty, and none was passed. | Export it, or pass the base URL explicitly. |
| `… is not an absolute http(s) URL` | The base URL has no scheme or host, such as `api.example.com`. | Include the scheme: `https://<your-host>`. |
| `No w6w API token is configured` | `W6W_TOKEN` is unset or empty, and none was passed. | Create a token in Studio → **Settings** → **API tokens** and export it. |
| `401 unauthorized` | The token is wrong, disabled or revoked. | Create a new token and re-export `W6W_TOKEN`. |
| Every call is `404` | `W6W_BASE_URL` has a stray path, such as `/api`. | Set it to the bare origin. A path is kept as given, so a wrong one breaks every route. |
| `network_error` with status `0` | The base URL doesn't resolve or the server is down. | Check the URL in a browser or with `curl`, and check your network. |

## Where to next

- **[Node SDK](/clients/node/)**: install, authenticate, and run your first action from TypeScript.
- **[React](/clients/react/)**: wrap your app in the provider and read data with hooks.
- **[CLI](/clients/cli/)**: the `w6w` command, for scripts and CI.
- **[Python](/clients/python/)**: the same operations from Python.
