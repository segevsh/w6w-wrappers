---
id: null
key: "python"
title: "Python"
section: "clients"
description: "Install the w6w Python package, authenticate, and call your connected apps, Functions, Endpoints and Workflows from Python."
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

# Python

The `w6w` package is the Python client for w6w. It needs Python 3.9 or later, has no third-party
dependencies, and is fully typed. Calls are synchronous. This page takes you from install to a
first action call, then covers errors and how to reach any route the client doesn't wrap yet.

## Before you start

- A w6w base URL and an API token. See [Configure](/clients/overview/#configure).
- Python 3.9 or later.

## 1. Install the package

```bash
pip install w6w
```

## 2. Set your credentials

```bash
export W6W_BASE_URL=https://<your-host>   # your API origin, no trailing path
export W6W_TOKEN=…                         # Studio → Settings → API tokens
```

## 3. Create a client and check who you are

```python
from w6w import Client

client = Client()  # reads W6W_BASE_URL and W6W_TOKEN

me = client.me()
print(me.tenant, me.account, me.role)
```

You should see your tenant, account and role. `me.versions["wrapper"]` is your client's version,
the first thing to include in a bug report.

To configure the client in code instead, pass arguments. They win over the environment:

```python
import os
from w6w import Client

client = Client(
    base_url="https://<your-host>",
    token=os.environ["MY_W6W_TOKEN"],
    project="prj_01H…",  # optional: default project for documents and workflows
)
```

## 4. Find something to run

```python
for c in client.connections.list():
    print(c.id, c.appId, c.state)

workflows = client.workflows.list()
functions = client.functions.list()
```

A connection you can use has `state == "connected"`. Result objects use the same field names as
the API, so they're camelCase: `appId`, `displayName`, `updatedAt`.

## 5. Run an action

`client.run()` runs whatever an id points at. For a connection, name the action and pass its input
as `payload`:

```python
import w6w

result = client.run(
    "conn_01H…",
    action="send_message",
    payload={"channel": "#general", "text": "Hello from w6w"},
)

if w6w.is_action_run(result):
    print(result["output"])         # what the app's action returned
    print(result.get("invocationId"))  # inv_…, the record of this call
```

You should see the action's result. `run` returns a dict tagged with a `kind`: `action`,
`function` or `workflow`. Check it with `is_action_run`, `is_function_run` or `is_workflow_run`
before you read a field. A `kind` your client version doesn't know yet comes back as-is.

The same call runs a Function (`fn_…`), an Endpoint (`ep_…`) or a Workflow (`wf_…`), without
`action`. A workflow started this way is queued, not awaited.

## Run workflows, Functions and Endpoints

Run a workflow and wait for its result:

```python
run = client.workflows.run(
    "wf_01H…",
    wait=True,
    input={"email": "a@example.com"},  # what the workflow's trigger receives
    variables={"region": "eu"},
)

if not run.terminal:
    print("still going:", run.runId, run.status)
elif run.status == "succeeded":
    print(run.output)
else:
    print("failed:", run.error, run.stepErrors)
```

A failed run is a result, not an exception. If the run takes longer than the server will wait, you
get it back with `terminal` set to `False`.

Run a Function or an Endpoint by its key or id:

```python
output = client.functions.run("send-welcome-email", payload={"to": "a@example.com"})

result = client.endpoints.run("signup", payload={"email": "a@example.com"})
```

`functions.run` returns the Function's output. `endpoints.run` returns the same tagged dict as
`client.run()`.

Cancel a run with `client.workflows.cancel("run_01H…")`. Cancelling is a request: the result shows
the run's status at that moment, and it becomes `canceled` shortly after.

## Documents and vars

```python
doc = client.documents.create("welcome-email", "# Welcome", format="markdown")
client.documents.update(doc.id, content="# Welcome aboard")
print(client.documents.get_by_key("welcome-email").content)
client.documents.delete(doc.id)

v = client.vars.create("sender_email", "string", "hello@example.com")
client.vars.update(v.id, value="team@example.com")
client.vars.delete(v.id)
```

`update` changes only the arguments you pass. Passing `None` clears a field, for example
`description=None`. Documents belong to a project and take an optional `project=`. Vars belong to
your account and don't.

## Handle errors

The client raises two error types:

- **`w6w.ConfigError`**: no request was sent. The base URL or token is missing or malformed.
- **`w6w.ApiError`**: the request failed. It has `status`, `code`, `message` and `raw`, the
  parsed response body. Printed, it reads `[404 unknown_function] …`.

```python
import w6w

try:
    client.functions.run("send-welcome-email", payload={"to": "a@example.com"})
except w6w.ConfigError as err:
    print("Fix your configuration:", err)
except w6w.ApiError as err:
    if err.status == 0:
        print("Could not reach w6w:", err.message)
    elif err.code.startswith("unknown_"):
        print("Not found:", err.message)
    elif err.status == 424:
        print("The app's own API failed:", err.raw)
    else:
        print(err)
```

Read errors by `status` and by the start of `code`, because w6w adds new codes over time.
`status` is `0` with code `network_error` when there was no response at all, and `bad_response`
means the response wasn't w6w's JSON, often a proxy's error page. See the
[error table](/clients/node/#handle-errors) for every case. The codes are the same in every client.

### Retries and timeouts

The client never retries on its own and never polls. The one opt-in exception is
`refresh_on_unauthorized=True` with a callable token: a `401` asks your callable for a fresh token
and retries that request once. See [Embed w6w in your product](#embed-w6w-in-your-product).

Requests have no timeout by default. To set one, pass a transport:

```python
import urllib.request
from w6w import Client

client = Client(transport=lambda req: urllib.request.urlopen(req, timeout=30))
```

A timeout raises `ApiError` with `status` `0` and code `network_error`.

## Call a route the client doesn't wrap

`client.request()` sends any request with the client's own base URL, token and default headers,
and raises the same `ApiError` on failure. Build the path with `w6w.path`, which percent-encodes
each value:

```python
import w6w

run_id = "run_01H…"
res = client.request("GET", w6w.path("/runs/{id}", id=run_id))
print(res.status, res.body["run"]["status"])
```

You should see `200` and the run's current status. `request` takes the method (`GET`, `POST`,
`PATCH` or `DELETE`), the path, and optionally `query=`, `body=` and `headers=`. It returns the
status alongside the parsed body, because some w6w routes answer `202` on success.

## Embed w6w in your product

When each of your users calls w6w with their own token, mint the token on your backend with your
tenant's client credentials:

```python
import os
from w6w.server import exchange_token

minted = exchange_token(
    base_url=os.environ["W6W_BASE_URL"],
    client_id=os.environ["W6W_TENANT_CLIENT_ID"],
    client_secret=os.environ["W6W_TENANT_CLIENT_SECRET"],  # never leaves your backend
    subject=user_id,         # your user's id
    account=user_account,    # optional; from your own records, never from the request
)
token, expires_in = minted["token"], minted["expiresIn"]
```

Then give the client a callable instead of a string. It's called before every request, and with
`force_refresh=True` when a refresh is needed:

```python
def supply_token(force_refresh: bool = False) -> str:
    return my_token_cache.get(user_id, refresh=force_refresh)

client = Client(
    token=supply_token,
    refresh_on_unauthorized=True,
    on_unauthorized=lambda err: print("w6w rejected the token:", err),
    headers={"X-W6W-Tenant": "<your-tenant-id>"},  # only if your authorizer needs it
)
```

The callable must be synchronous. The [Node embedding guide](/clients/node/embedding/) explains
each option in more detail.

## Troubleshooting

| Symptom | Cause | What to do |
| --- | --- | --- |
| `ConfigError: No w6w base URL is configured` | `W6W_BASE_URL` is unset or empty. | Export it, or pass `base_url=`. |
| `ConfigError: No w6w API token is configured` | `W6W_TOKEN` is unset or empty, or your callable returned nothing. | Export it, or pass `token=`. |
| `ConfigError` about a control character in the token | The token has a newline, often from reading a file. | Strip it: `token=open(path).read().strip()`. |
| `ApiError: [401 unauthorized] …` | The token is wrong, disabled or revoked. | Create a new token in Studio → **Settings** → **API tokens**. |
| `AttributeError: 'WorkflowsApi' object has no attribute 'cancel'` | Your installed version predates it. | Upgrade: `pip install -U w6w`. See [Versions](/clients/overview/#versions). |
| A call hangs | There's no default timeout. | Pass a transport with a timeout, as shown above. |

## Where to next

- **[Python reference](/clients/python/reference/)**: every method and argument.
- **[CLI](/clients/cli/)**: the same operations from a terminal.
