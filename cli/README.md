# @w6w/cli

The `w6w` command-line client for the [w6w](https://w6w.dev) workflow platform.

It is a **thin** client, built on [`@w6w/sdk`](https://www.npmjs.com/package/@w6w/sdk): transport,
auth, output formatting and exit codes. No business logic, no client-side polling, no hidden
retries. Everything it can do, the HTTP API can do — the CLI just makes it typeable.

- **License:** MIT (see [LICENSE](./LICENSE)).
- **Version:** `0.9.1`. Needs Node.js 18 or later.
- **Guides:** [docs.w6w.io/clients/cli](https://docs.w6w.io/clients/cli/), with a
  [command reference](https://docs.w6w.io/clients/cli/commands/).

## Install

```bash
npm install -g @w6w/cli
w6w --help
```

`@w6w/cli`, `@w6w/sdk`, `@w6w/react` and the Python `w6w` package share one version number and are
released together. A given version means the same set of operations in every language.

## Configuration

Two environment variables:

| Variable       | Meaning                                                                                                                                                                                         | Required |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `W6W_BASE_URL` | The **origin** of your w6w server, e.g. `https://api.example.com`. The API is served at the root of that host, so nothing is appended — and a stale `/api` suffix from `0.1.x` must be dropped. | Yes      |
| `W6W_TOKEN`    | Your API token, sent as `Authorization: Bearer <token>` on every request.                                                                                                                       | Yes      |

Both have a flag equivalent, and **a flag always wins over the environment**: `--base-url <url>` and
`--token <token>`.

```bash
export W6W_BASE_URL=https://api.example.com
export W6W_TOKEN=…
w6w workflows list
```

`--help` and `--version` deliberately need neither. They resolve with no token configured and no
server reachable, which is exactly when people need them most.

## Usage

```bash
w6w me                        # who am I, and which CLI version is this? (alias: info)

# Discover what you can run — a `conn_…`, `wf_…`, `fn_…` or `ep_…` id.
w6w connections list          # short forms: `w6w conn ls`, `w6w wf ls`, `w6w docs ls`
w6w workflows list
w6w functions list

# Run a connection action: a `conn_…` id needs --action.
w6w run conn_01H… --action send_email --payload '{"to":"a@b.com"}'

# …or name the app, when you have exactly one connection for it.
w6w run --app sendgrid --action send_email --payload '{"to":"a@b.com"}'

# A Function or an Endpoint runs the same way, with no --action — by id, or by key
# with an `fn:` / `ep:` / `wf:` prefix.
w6w run fn_01H… --payload '{"address":"1 Infinite Loop"}'
w6w run fn:normalize-address --payload '{"address":"1 Infinite Loop"}'

# `w6w run wf_…` dispatches a workflow like anything else and always queues it.
# `w6w workflows run` is the typed path, and the only one that can wait:
w6w workflows run wf_01H… --wait --input '{"email":"a@b.com"}'
w6w workflows cancel run_01H…

# Documents and vars are plain CRUD; the key/name is positional, the rest are flags.
w6w documents create welcome --content "# Hi"
w6w vars create greeting --type string --value hello

# Your account's members and invites (writes need the owner or admin role).
w6w team members
w6w team invite --email dev@example.com --role member
```

Add `--json` to any command for raw JSON instead of a table — the shape to script against. Errors go
to stderr as `w6w: <message>`; colour is used only on a terminal and is turned off by `--no-color`
or `NO_COLOR`.

### Known limitations

A few flags that `--help` lists aren't applied yet:

- `functions run` / `endpoints run` read neither `--id-or-key` nor `--inputs` / `--input`, and
  reject `--payload`. Pass the key positionally, and send input with
  `w6w run fn:<key> --payload '…'` (or `ep:<key>`).
- `workflows run` ignores `--var` and `--trigger`.
- `workflows update` ignores `--if-unmodified-since`, so the save always wins.
- `team --help` still says the routes return `404`; they are live and work.
- `functions delete` needs the Function archived first, which the CLI can't do yet.

## Help

Help resolves at three levels, and `-h` is an alias for `--help` at all of them:

```bash
w6w --help                   # what w6w is, the global flags, the command groups
w6w documents --help         # the commands in a group
w6w documents create --help  # arguments, flags, examples
w6w help documents create    # the same thing, spelled the other way
```

Help is **generated** from the machine-readable surface contract every contract lane implements, so
the CLI cannot document an operation it does not have, or omit one it does. A bare `w6w` prints the
root help and exits `0`.

## Exit codes

| Code | Meaning                                                                                                  |
| ---- | -------------------------------------------------------------------------------------------------------- |
| `0`  | Success — including help, and including a _queued_ or _running_ workflow                                 |
| `1`  | Usage or configuration error — unknown command, missing argument, bad flag or JSON, no base URL or token |
| `2`  | API error — 4xx/5xx from the server, including auth failure, or the server could not be reached          |
| `3`  | Run failure — `--wait` returned a run with status `failed`                                               |

Code `3` exists so `w6w workflows run --wait` is usable in CI without parsing stdout. Keeping it
distinct from `2` matters: a failed workflow and an unreachable API demand opposite responses, and a
script that cannot tell them apart will retry the wrong one.

## The surface

What commands exist is not decided in this repo. It is defined by the shared machine-readable
contract `endpoints.json`, which sits at the root of this repo, one directory up, and which each
contract lane's conformance test reads directly — the same file, never a vendored copy. A command
missing from a wrapper is a failing test, not a preference.

An operation marked `planned` in that contract is implemented and unit-tested here ahead of its
server route, and its help says so. The marker records **server** readiness, not CLI completeness.
The `team` commands still carry it, but their server routes are live and they work today.

## Versioning

The version is a shared fact across all four packages, so a release may go out for this package even
when nothing in it changed — a divergent version is far more expensive than an empty release.

Below `1.0.0`, **breaking changes may land in a minor bump.** That grace ends at `1.0.0`; do not
plan around it.

## Development

The gates are Deno tasks. They need no network and no server:

```bash
deno task gen:help   # regenerate src/help.generated.ts from the shared contract
deno task check      # typecheck mod.ts, bin/, scripts/, src/ and tests/
deno task lint
deno task fmt:check
deno task test       # every test runs in-process, against no server
deno task cov        # test with coverage, then report it
```

`src/help.generated.ts` is generated — never edit it by hand. `deno task test` compares it
byte-for-byte against a fresh render, so a contract change that was not regenerated fails the suite
instead of shipping stale help.

Runtime access — argv, environment, exit — lives in exactly one module, `src/runtime.ts`. Everything
else uses Web-standard globals only, which is what lets the same source run under Deno during
development and under Node once published. The npm `dist/` build (`npm run build`, i.e.
`tsc -p tsconfig.build.json`) runs in CI only.
