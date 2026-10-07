# w6w

Typed Python client for the w6w workflow API.

It is a thin wrapper: transport, auth, error mapping. Documents, variables,
connections, workflows, Functions, Endpoints, runs and your team — the same
surface the Node SDK and the `w6w` CLI expose, at the same version. Every
contract lane implements one shared contract, and all four packages
(`w6w`, `@w6w/sdk`, `@w6w/cli`, `@w6w/react`) release together, so `w6w==X`
gives you the same operations as `@w6w/sdk@X`.

- **Version:** `0.9.3`.
- **Guides:** [docs.w6w.io/clients/python](https://docs.w6w.io/clients/python/),
  with a [full reference](https://docs.w6w.io/clients/python/reference/).
- **Surface:** `me`, `run`, `request`, `connections.list`, the complete
  `workflows.*` lifecycle (list/run/cancel/get/create/update/archive/delete),
  `functions.*` (run/list/get/create/update/delete), `endpoints.run`, the
  complete `documents.*` and `vars.*` CRUD, `team.*`, and
  `w6w.server.exchange_token` for backends.
- Below `1.0.0`, breaking changes may arrive in a minor bump — that grace ends
  at `1.0.0`.

MIT licensed — see [LICENSE](./LICENSE).

## Install

```bash
pip install w6w
```

Python 3.9 or newer.

## Zero runtime dependencies

`dependencies` in `pyproject.toml` is empty and stays empty. HTTP goes through
`urllib.request` from the standard library — no `requests`, no `httpx`, no
`aiohttp`.

Two reasons, in order of importance:

1. **A client library should never join a dependency fight.** Installing this
   package cannot conflict with the versions you have already pinned.
2. **It is the only workable choice for how this package is developed.** The
   environment it is built in has no package installer available at all, so a
   third-party HTTP or test dependency would make the package untestable by the
   people writing it.

The package is fully annotated and ships a [PEP 561](https://peps.python.org/pep-0561/)
`py.typed` marker, so mypy and pyright see the types without a stub package.

## Usage

```python
from w6w import Client, ApiError

client = Client()                         # from the environment
# …or explicitly, which always wins over the environment:
client = Client(base_url="https://api.example.com", token="tok_…")

try:
    identity = client.me()                # who am I? versions["wrapper"] is this client's version
except ApiError as err:
    print(err.status, err.code, err.message)

# What can I run? `run` is addressed by a conn_… / fn_… / ep_… / wf_… id, and
# these two operations are how you discover one.
connections = client.connections.list()
workflows = client.workflows.list()
```

### Run anything addressable by a URN

`run` returns a `kind`-tagged envelope — the parsed body, exactly as it arrived.
Discriminate it before reading a field, because the arms carry different
fields (`output` for an action or a Function, `runId` + `status` for a
workflow):

```python
import w6w

env = client.run(
    connections[0].id,                    # "conn_…"
    action="send_message",                # which of the app's actions to invoke
    payload={"channel": "#general", "text": "Hello from w6w"},
)

if w6w.is_action_run(env):
    print(env["output"])                  # the action's return value ("value" holds the same)
```

A `fn_…` or `ep_…` id runs the same way with no `action`; a `wf_…` id is
enqueued and comes back `202` with `runId` and `status` — which is success, not
an error. A `kind` this release has never heard of is handed back verbatim
rather than raised, so a newer server cannot break an installed client.

### Run a workflow, and optionally wait

`workflows.run` is the typed path, and the only one that can wait for the result
**server-side** — this package contains no polling loop of its own:

```python
run = client.workflows.run(workflows[0].id, wait=True, variables={"customerId": "cus_1"})

# A failed run is DATA, not a raised error. `terminal` says whether it finished.
if run.terminal and run.status == "failed":
    print(run.error)
elif run.terminal:
    print(run.output)
```

Cancel a run with `client.workflows.cancel(run_id)`; the answer is the run's
status at that moment.

### Functions and Endpoints

```python
output = client.functions.run("send-welcome-email", payload={"to": "a@example.com"})
result = client.endpoints.run("signup", payload={"email": "a@example.com"})
```

Both take a key or an id. `functions.run` returns the Function's output;
`endpoints.run` returns the same tagged envelope as `client.run`. A Function
must be archived before `functions.delete` accepts it (`409
function_not_archived`).

### Team

```python
members = client.team.members()
invite = client.team.invite(email="dev@example.com", role="member")
print(invite.redemption_link)
```

Reading the roster and open invites works for any member; `invite`,
`revoke_invite`, `set_role` and `remove_member` need the `owner` or `admin`
role. Team records use snake_case attributes (`user_id`, `display_name`).

### Documents and vars

```python
doc = client.documents.create("welcome", "# Hi", format="markdown")
client.documents.update(doc.id, content="# Hello")
client.documents.delete(doc.id)

v = client.vars.create("sender_email", "string", "a@b.c")
client.vars.update(v.id, value="c@d.e")
```

Documents are project-scoped (every operation takes an optional `project`);
**variables are not** — they are scoped by tenant/subject only, so no `vars.*`
signature has a `project` argument. The asymmetry is the server's, and this
package documents it rather than papering over it with an argument the server
ignores.

`update` distinguishes *leave this field alone* from *set this field to null*:
every patchable parameter defaults to `w6w.UNSET` (send nothing), and passing
`None` explicitly sends JSON `null`.

### Reaching an endpoint this version does not model

`client.request` is public and returns `(status, body)` — the status comes back
because a `202` is a normal outcome on this API, not an error. When any part of
a path comes from the caller, build it with `w6w.path` rather than by
concatenation; it percent-encodes every interpolated value:

```python
from w6w import path

client.request("GET", path("/documents/by-key/{key}", key="notes/2026"))
# -> GET https://api.example.com/documents/by-key/notes%2F2026
```

That is not defensive ceremony. Document keys are user-chosen and the server
accepts almost anything, so an unencoded `"notes/2026"` becomes two path
segments — a **different route**, answered with a `200` and no error anywhere.

## Configuration

Two environment variables, read once when a client is constructed:

| Variable | Meaning |
|---|---|
| `W6W_BASE_URL` | The **origin** of your w6w API — e.g. `https://api.example.com`. The API is served at the root of that host, so the client appends nothing. There is no default. |
| `W6W_TOKEN` | Your API token. Sent as `Authorization: Bearer <token>` on every request. |

These variables are part of the published contract and are identical across
every client.

**Explicit constructor arguments always win over the environment.**
`Client(base_url=…, token=…)` overrides `W6W_BASE_URL` / `W6W_TOKEN`, and an
argument you pass explicitly — including an empty string — is never quietly
replaced by an environment variable behind your back.

Credentials are per-client **instance state**, never module globals: two clients
in one process can point at two servers with two tokens and not interfere.

### Options beyond the two variables

Both variables stay plain strings. These four constructor arguments cover the
cases a host — a partner embedding w6w inside its own product, a backend
juggling tenants — actually runs into, and none of them has an
environment-variable spelling:

| Argument | Meaning |
|---|---|
| `token` | Your API token, or a **supplier callable** called fresh on every request (see below). |
| `refresh_on_unauthorized` | Opt in to a single recovery retry when a request fails `401` / `unauthorized`. `False` by default. |
| `on_unauthorized` | Called with the terminal `401` `ApiError`, at most once per call. |
| `headers` | Default headers sent with every request. |

```python
client = Client(
    base_url="https://api.example.com",
    token=read_tenant_token,              # called fresh on every request
    refresh_on_unauthorized=True,         # one retry when the server answers 401
    on_unauthorized=redirect_to_login,    # …and what to do when that did not help
    headers={"X-W6W-Tenant": tenant_id},  # your own gateway/authorizer header
)
```

**A token supplier is how a host mints or rotates a credential out of band.**
`token` takes a `str` — sent verbatim on every call, exactly as before — or a
callable returning one, which is called **fresh on every request** rather than
resolved once at construction, so a token that changes between calls is picked
up without rebuilding the client. It is **sync-only**: there is no `asyncio`
anywhere in this package, so a supplier that itself needs to await something is
yours to resolve before handing the value here. A nullish or blank result is
treated exactly like a missing static token: a `ConfigError` naming `W6W_TOKEN`,
never a request sent with no credential.

**`refresh_on_unauthorized` opts in to one recovery.** `False` by default, and
the behaviour before the option existed. When a request fails `401` with
`code == "unauthorized"` and `token` is callable, the supplier is called once
more as `token(force_refresh=True)` and, if that yields a usable value, the
**same** request is re-sent once. Nothing else is ever retried — not a second
time, not another status, and never a request made with `require_auth=False`.
`on_unauthorized` receives the terminal `401` `ApiError` — after a failed
recovery, or immediately when recovery is off or the token is a plain
string — at most once per call, and never on success.

**`headers` is the base every per-request `headers` argument builds on.** A
per-request header with the same name wins, and neither can displace the
`Authorization` bearer or the `Content-Type` the client sets for a JSON body.

### `W6W_BASE_URL` is an origin

The API is served at the **root** of its own host — `https://api.example.com/vars`,
not `…/api/vars` — so nothing is appended. Trailing slashes never matter, and a
path you configure is preserved verbatim, because it is indistinguishable from a
real gateway prefix:

| You set | The client uses |
|---|---|
| `https://api.example.com` | `https://api.example.com` |
| `https://api.example.com/` | `https://api.example.com` |
| `https://api.example.com///` | `https://api.example.com` |
| `https://api.example.com/gw` | `https://api.example.com/gw` |

> **Breaking in `0.2.0`.** The client used to append `/api`. If your
> `W6W_BASE_URL` ends in `/api` because of that, **drop the suffix** — a stale
> one now 404s on every call. It is not stripped for you: a configured path is
> exactly how a deployment behind a gateway prefix is addressed.

**A blank value is not a base URL.** An environment variable that is set but
empty or whitespace-only is treated as **absent**: `W6W_BASE_URL=`,
`W6W_BASE_URL="   "` and an unset `W6W_BASE_URL` all behave identically and all
raise the same `ConfigError` naming the variable. (`export W6W_BASE_URL=`, a
Dockerfile `ENV` with no build arg, and a CI variable whose template did not
interpolate are the common cases, and they look unset in every log line.) The
same rule applies to `W6W_TOKEN`.

**It must be absolute.** `W6W_BASE_URL=/foo` or `W6W_BASE_URL=api.example.com`
raises a `ConfigError` naming the variable, at construction — not a confusing
"the server may be down" on the first request. Scheme and host, `http` or
`https`.

A client with no token can still be **constructed** — the error surfaces on the
first request instead, so offline `--help`-style uses work. A client with no
base URL raises immediately, at construction.

`W6W_TOKEN` is a plain string only. A credential that has to change between
requests is spelled in the constructor — `token=read_tenant_token`,
[above](#options-beyond-the-two-variables) — never in the environment.

**A token is validated as a header value.** A token containing a carriage
return, newline or other control character raises a `ConfigError` before any
request is made, because CR/LF in a header value is header injection — and the
usual way this happens is entirely innocent: `W6W_TOKEN=$(cat token.txt)` keeps
the file's trailing newline. The message names the offending codepoint and
position and never echoes the token.

## Errors

Two exception types, and the split is deliberate:

| Type | Means |
|---|---|
| `ConfigError` | The client was never in a position to make a request — no base URL, or no token. No HTTP exchange happened. |
| `ApiError` | The server answered, or could not be reached. Carries `status`, `code`, `message` and `raw` (the parsed body, kept because error bodies carry fields the message drops). |

`ApiError` has exactly three shapes: `status=0` / `code="network_error"` for a
transport failure, `code="bad_response"` for a non-JSON body on a failing status
(a proxy's HTML error page), and the server's own `code` / `message` for an error
envelope. Classify by `status` and by a code *prefix* (`unknown_*` → 404,
`invalid_*` → 400, `*_exists` → 409) rather than by an exhaustive list of codes:
the server mints codes freely.

A `424` is an app or upstream **execute-phase** failure, not a transport fault
and not a server error — it is a 4xx on purpose. It reaches you with its code and
body intact.

Nothing is retried except the opt-in `refresh_on_unauthorized` recovery, and
there is **no default timeout**: the default transport is
`urllib.request.urlopen` with none. Set one by passing a transport:

```python
import urllib.request

client = Client(transport=lambda req: urllib.request.urlopen(req, timeout=30))
```

A timeout raises `ApiError` with `status=0` and `code="network_error"`.

## Embedding for enterprise tenants

A partner backend mints a short-lived, per-user token with
`w6w.server.exchange_token`. It takes your tenant's client secret, so it must
only ever run on your backend:

```python
from w6w.server import exchange_token

minted = exchange_token(
    base_url="https://api.example.com",
    client_id=client_id,
    client_secret=client_secret,   # never sent to a browser
    subject=user_id,               # your user's id
    account=account_id,            # optional; from your own records
)
token = minted["token"]            # also: minted["expiresIn"], minted["user"]
```

Bad credentials answer `401 invalid_client`. The
[Python guide](https://docs.w6w.io/clients/python/#embed-w6w-in-your-product)
shows how to feed the result to a `Client` through a token callable.

## Tests

The suite runs from a source checkout with **no installation step and no test
runner to install** — `unittest` from the standard library:

```bash
PYTHONPATH=src python3 -m unittest discover -s tests -t . -v
```

Run it from this `python/` directory. A single file:

```bash
PYTHONPATH=src python3 -m unittest tests.test_version -v
```

No test reaches the network. Client behaviour is exercised against an injected
transport seam, never a live server — conformance against a running server is a
separate, environment-dependent step and is not part of this suite.

`tests/test_surface.py` is the exception in kind rather than in method: it reads
the shared `endpoints.json` one directory up, at the wrappers repo root, and asserts that
every contracted operation is reachable under the symbol the contract names it —
and that no namespace has grown one the contract does not have. It never
vendors a copy, and it fails naming the path it looked for rather than skipping,
because a guard that passes quietly when its input is missing is worse than no
guard.

### Why coverage is measured in CI and not locally

Coverage is gated at **90 %**, enforced by CI, and there is deliberately no
local coverage command.

`coverage` is the one development-only tool this repo uses, and it is a
third-party package. The environment this wrapper is developed in has **no
package installer available** (`python3 -m pip` and `python3 -m ensurepip` both
fail there), so `coverage` cannot be installed alongside the code it would
measure. Rather than publish a local gate that nobody can actually run, the
number is enforced where the tool does exist:

```bash
pip install -e '.[dev]'
coverage run -m unittest discover -s tests -t .
coverage report          # fail_under = 90, configured in pyproject.toml
```

The local bar is different and, for the thing that actually matters, stricter:
**the suite runs with no install, every operation is exercised, and every error
path has a test.** A percentage catches a whole operation going untested; it
does not catch an operation tested badly. If you are adding an operation, the
list above is your gate, not the number.

## The surface

Which operations exist is not decided in this repository. It is defined by the
shared machine-readable contract **`endpoints.json`**, which every contract
lane implements and which each one's conformance test reads directly — the
same file, never a vendored copy. An operation missing from a wrapper, or one it
has grown alone, is a failing test rather than a preference.

An operation marked `planned` in that contract is implemented and unit-tested
here ahead of its server route. The marker records **server** readiness, not
wrapper completeness.

## Versioning

The version appears in three places — `src/w6w/_version.py`, `pyproject.toml`,
and the wrappers' shared `VERSION` file one directory up —
and `tests/test_version.py` fails if any of them disagree. All three are
written from the shared file at release time; none is ever bumped on its own.
That is the mechanism behind "one surface, one version, released together".

## Contributing

Conventions worth knowing before the first patch:

- **`src/` layout.** Tests import the package via `PYTHONPATH=src` (or an
  install), never the working directory, so what is tested is what ships.
- **The barrel rule.** Every public symbol is re-exported from `w6w/__init__.py`
  and listed in `__all__`. Modules with a leading underscore are private
  implementation detail and may move.
- **Type annotations use `typing.Optional` / `Dict` / `List` form**, so they
  stay valid on Python 3.9 even where they are evaluated at runtime; every
  module also starts with `from __future__ import annotations`.
- **Exactly one module reads the environment** — `src/w6w/_env.py`. `os.environ`
  and `os.getenv` appear there and nowhere else; every other module receives
  resolved configuration as a value, so no operation can acquire a hidden
  dependency on ambient process state.
- **Every caller-supplied value in a URL goes through `w6w.path`.** One
  primitive at the transport seam, never a `quote()` at each call site — "every
  call site remembered to encode" is not a property anyone can verify later.
- **Stdlib only, in tests too.** No file in this repository imports a
  third-party module. The transport is constructor-injected, so no test opens a
  socket.
- **The surface is not decided here.** Which operations exist, and what each is
  called in each language, is pinned by the shared wrapper contract. Adding an
  operation to this client alone would break the promise the wrappers make
  together.
