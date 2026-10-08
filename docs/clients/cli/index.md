---
id: null
key: "cli"
title: "CLI"
section: "clients"
description: "Install the w6w command, authenticate it, and run actions, Functions and Workflows from a terminal or a CI job."
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

# CLI

The `w6w` command gives you w6w from a terminal: check your access, list what you can run, run it,
and manage workflows, documents and vars. It prints tables for people, raw JSON with `--json` for
scripts, and exit codes your CI can act on.

## Before you start

- Node.js 18 or later.
- A w6w base URL and an API token. See [Configure](/clients/overview/#configure).

## 1. Install the CLI

```bash
npm install -g @w6w/cli
w6w --version
```

You should see a version number.

## 2. Set your credentials

```bash
export W6W_BASE_URL=https://<your-host>   # your API origin, no trailing path
export W6W_TOKEN=…                         # Studio → Settings → API tokens
```

You can also pass `--base-url` and `--token` on any command, and they win over the environment.
Prefer the environment variable for the token, so it stays out of your shell history.

## 3. Check your access

```bash
w6w me
```

You should see your tenant, account, user id and role, followed by the CLI's version.
`w6w info` does the same thing.

## 4. Find something to run

```bash
w6w connections list
w6w workflows list
w6w functions list
```

Each prints a table with ids: `conn_…` for connections, `wf_…` for workflows, `fn_…` for
Functions. Shorter forms work too: `conn` for `connections`, `wf` for `workflows`, `docs` for
`documents`, and `ls` for `list`, so `w6w conn ls` lists your connections.

## 5. Run an action

```bash
w6w run conn_01H… --action send_message --payload '{"channel":"#general","text":"Hello from w6w"}'
```

You should see the result's kind, `action`, then the action's output as JSON. `--payload` takes a
JSON object, so wrap it in single quotes in your shell.

If you have exactly one connection for an app, name the app instead of the connection id:

```bash
w6w run --app slack --action send_message --payload '{"channel":"#general","text":"Hi"}'
```

If you have several connections for that app, the command lists them, with the exact command to
run against each.

## 6. Run a Function, Endpoint or Workflow

`w6w run` also takes a `fn_…`, `ep_…` or `wf_…` id, without `--action`. To address one by its key,
prefix the key with `fn:`, `ep:` or `wf:`:

```bash
w6w run fn:send-welcome-email --payload '{"to":"a@example.com"}'
w6w run ep_01H… --payload '{"email":"a@example.com"}'
```

A workflow started with `w6w run` is queued and not waited on. To wait for its result, use
`w6w workflows run`:

```bash
w6w workflows run wf_01H… --wait --input '{"email":"a@example.com"}'
```

You should see the run id, its final status, and its output. A run that's still going when the
server stops waiting is reported as `running`, which isn't an error.

## Use it in scripts and CI

Add `--json` to any command to get the raw response, then pipe it to a tool such as `jq`:

```bash
w6w workflows list --json | jq -r '.[] | select(.status == "active") | .id'
```

Every command exits with a code you can test:

| Exit code | Meaning |
| --- | --- |
| `0` | Success. Includes a workflow that's still queued or running. |
| `1` | A usage or configuration problem: an unknown flag, bad JSON, or no base URL or token. |
| `2` | The API returned an error, or couldn't be reached. |
| `3` | A workflow run finished with status `failed`. |

So this step fails your pipeline when the workflow fails:

```bash
w6w workflows run wf_01H… --wait --input '{"release":"1.4.2"}'
```

Errors go to stderr as `w6w: <message>`. Colour is used only when the output is a terminal. Turn
it off with `--no-color` or by setting `NO_COLOR`.

## Retries

The CLI makes one request per command and never retries. In CI, retry the command yourself only
for exit code `2`, and only when it's safe to run twice.

## Call a route the CLI doesn't cover

The CLI covers the operations listed in the [command reference](/clients/cli/commands/). For any
other route, use the [Node SDK's](/clients/node/#call-a-route-the-sdk-doesnt-wrap) or
[Python client's](/clients/python/#call-a-route-the-client-doesnt-wrap) `request` method, which
use the same `W6W_BASE_URL` and `W6W_TOKEN`.

## Known limitations

A few flags shown in `--help` aren't applied yet. Use these instead:

| Command | What happens | Do this instead |
| --- | --- | --- |
| `w6w functions run --id-or-key <key>` or `w6w endpoints run --id-or-key <key>` | The flag isn't read, so the command says it needs a key. | Pass the key as an argument: `w6w functions run <key>`. |
| `w6w functions run <key> --inputs '…'` | The inputs are ignored and the Function gets `{}`. `--payload` is rejected. | `w6w run fn:<key> --payload '…'` |
| `w6w endpoints run <key> --input '…'` | The input is ignored and the Endpoint gets `{}`. `--payload` is rejected. | `w6w run ep:<key> --payload '…'` |
| `w6w workflows run … --var k=v` or `--trigger …` | Variables and the trigger are ignored. `--wait` and `--input` work. | Set variables or a trigger from the [Node SDK](/clients/node/workflows/) or [Python](/clients/python/). |
| `w6w workflows update … --if-unmodified-since …` | The check is skipped, so the save always wins. | Make conditional saves from an SDK with `ifUnmodifiedSince`. |

## Troubleshooting

| Symptom | Cause | What to do |
| --- | --- | --- |
| `w6w: No w6w base URL is configured` (exit 1) | `W6W_BASE_URL` is unset or empty. | Export it, or pass `--base-url`. |
| `w6w: No w6w API token is configured` (exit 1) | `W6W_TOKEN` is unset or empty. | Export it, or pass `--token`. |
| `w6w: Could not reach the w6w server` (exit 2) | The base URL is wrong or the server is down. | Check the URL, and your network or VPN. |
| `w6w: unknown flag: --…` (exit 1) | The flag doesn't exist for that command. | Run the command with `--help` to see its flags. |
| A `401` (exit 2) | The token is wrong, disabled or revoked. | Create a new token in Studio → **Settings** → **API tokens**. |
| `w6w: No connection found for app` (exit 1) | You have no connection for that app id. | Run `w6w connections list` and check the `APP` column. |
| `--app` says there are several connections | You have more than one connection for that app. | Use one of the `w6w run conn_…` commands it prints. |

## Where to next

- **[Command reference](/clients/cli/commands/)**: every command and flag.
- **[Node SDK](/clients/node/)**: the same operations from code.
