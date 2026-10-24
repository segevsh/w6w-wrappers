---
id: null
key: "cli/commands"
title: "Command reference"
section: "clients"
description: "Every w6w command, its arguments and its flags."
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

# Command reference

Every command the `w6w` CLI ships, grouped the way `w6w --help` groups them. Run any command with
`--help` for its own usage and examples. For setup, start with the [CLI](/clients/cli/) page.

## Global options

These work on every command:

| Option | What it does |
| --- | --- |
| `--base-url <url>` | Your API origin. Overrides `W6W_BASE_URL`. Defaults to `https://api.w6w.io`. |
| `--token <token>` | Your API token. Overrides `W6W_TOKEN` and the token saved by `w6w auth login`. |
| `--json` | Print the raw JSON response instead of a table. |
| `--no-color` | Turn off colour. Setting `NO_COLOR` does the same. |
| `-v`, `--version` | Print the CLI version. |
| `-h`, `--help` | Show help for any command. |

Shortcuts: `conn` for `connections`, `wf` for `workflows`, `docs` for `documents`, and `ls` for
`list` in any group.

Flags that take JSON (`--payload`, `--input`, `--definition`, and `--value` for non-string vars)
expect a JSON value in one shell argument. Wrap it in single quotes, or read it from a file with
`"$(cat file.json)"`.

## Auth

| Command | What it does |
| --- | --- |
| `w6w auth login [<token>\|-]` | Save an API token for the base URL (default `https://api.w6w.io`). Use `-` (or pipe the token in) to read it from standard input: `printf '%s' "$TOKEN" \| w6w auth login -`. That keeps it out of your shell history and the process list, which a token given as an argument is not. |
| `w6w auth logout` | Remove the saved token for the base URL. |
| `w6w auth status` | Show the base URL, where it came from, and whether a token is available (masked, never printed in full). |

A saved token is used only for the base URL it was saved for. See the [CLI](/clients/cli/) page.

## Config

| Command | What it does |
| --- | --- |
| `w6w config get-base-url` | Show the effective base URL and where it came from (`flag`, `env`, `config`, `default`). |
| `w6w config set-base-url <url>` | Save the base URL (trailing slash dropped). Tokens are not moved: run `w6w auth login` for the new host. A set `W6W_BASE_URL` still wins and is called out. |

## List

| Command | What it does |
| --- | --- |
| `w6w ls <integrations\|workflows\|functions\|endpoints> [--project <id>]` | Same as `connections list`, `workflows list` and `functions list` for the first three; `endpoints` is **unstable** (console API). Distinct from the in-group `ls` alias for `list`. |

## Identity

| Command | What it does |
| --- | --- |
| `w6w me` | Show your tenant, account, user id and role, and the CLI's version. Alias: `w6w info`. |

## Run

| Command | What it does |
| --- | --- |
| `w6w run <id> [--action <name>] [--payload <json>]` | Run a connection's action (`conn_…`, needs `--action`), a Function (`fn_…`), an Endpoint (`ep_…`) or a Workflow (`wf_…`). Address a Function, Endpoint or Workflow by key with `fn:<key>`, `ep:<key>` or `wf:<key>`. A workflow is queued, not waited on. |
| `w6w run --app <app-id> --action <name> [--payload <json>]` | Run an action on your one connection for that app, without looking up its `conn_…` id. Can't be combined with an id. |

## Connections

| Command | What it does |
| --- | --- |
| `w6w connections list` | List your connections: id, app, state and name. |
| `w6w connections get <id>` | Print one connection. |
| `w6w connections delete <id> [--force]` | Delete a connection. There is no confirmation prompt. Another account's id answers 404 (exit `2`). While Functions/Endpoints still use it the server refuses with `409 connection_in_use`: the CLI prints one `<kind> <displayName> (<id>)` line per dependent callable to stderr plus a hint, and exits `2`. `--force` deletes anyway (`?force=true`); the dependent callables are disabled, never edited. |

Creating, testing and reconnecting a connection are not in the CLI.

## Workflows

| Command | What it does |
| --- | --- |
| `w6w workflows list [--project <id>]` | List workflows. |
| `w6w workflows run <id-or-key> [--wait] [--input <json>] [--allow-unpublished]` | Start a run. `--wait` waits for it to finish, up to the server's limit. Exits `3` if the run failed. `--allow-unpublished` runs the saved draft even if it was never published; it runs the row as last saved, so save first, and it is sent only when you pass it. |
| `w6w workflows cancel <run-id>` | Ask for a run to be cancelled. It reports the run's status at that moment. |
| `w6w workflows get <id>` | Print a workflow's full definition and its `updatedAt`. |
| `w6w workflows create --definition <json> [--project <id>]` | Create a workflow from a definition. A new `wf_…` id is assigned if it has none. |
| `w6w workflows update <id> --definition <json> [--project <id>]` | Replace a workflow's definition. Send the whole definition: fields you leave out are removed. |
| `w6w workflows archive <id>` | Archive a workflow. Required before deleting it. |
| `w6w workflows delete <id>` | Delete an archived workflow. |
| `w6w workflows versions <id>` | List a workflow's published versions and whether it is enabled. |
| `w6w workflows version <id> <n>` | Print version `n`, with its definition. |
| `w6w workflows publish <id>` | Publish the workflow as saved, as a new numbered version. Save any pending edit first. |
| `w6w workflows revert <id> <n>` | Make version `n` the current one. |
| `w6w workflows enable <id>` / `disable <id>` | Turn the workflow on or off. |
| `w6w workflows run-version <id> <n> [--wait] [--input <json>]` | Run the published version `n`, never the draft. Exits `3` if the run failed. |

`w6w workflows update` lists `--if-unmodified-since`, but it isn't applied yet. See
[Known limitations](/clients/cli/#known-limitations).

## Functions

| Command | What it does |
| --- | --- |
| `w6w functions run <key-or-id> [--payload <json>] [--allow-unpublished]` | Run a Function and print its output. `--allow-unpublished` runs the saved draft even if it was never published; it is sent only when you pass it. |
| `w6w functions list` | List your Functions, and whether each can run. |
| `w6w functions get <id>` | Print a Function's definition. |
| `w6w functions create --definition <json>` | Create a Function. A new `fn_…` id is assigned if it has none. |
| `w6w functions update <id> --definition <json> [--if-unmodified-since <ts>]` | Replace a Function's definition. `--if-unmodified-since` takes the `updatedAt` from `functions get` and refuses a stale write with `409 function_stale`. |
| `w6w functions archive <id>` | Archive a Function. Required before deleting it. |
| `w6w functions delete <id>` | Delete an archived Function. |
| `w6w functions versions <id>` | List a Function's published versions and whether it is enabled. |
| `w6w functions version <id> <n>` | Print version `n`, with its definition. |
| `w6w functions publish <id>` | Publish the Function as saved, as a new numbered version. Save any pending edit first. |
| `w6w functions revert <id> <n>` | Make version `n` the current one. |
| `w6w functions enable <id>` / `disable <id>` | Turn the Function on or off. |
| `w6w functions run-version <id> <n> [--payload <json>]` | Run the published version `n` and print its output. |

## Endpoints

| Command | What it does |
| --- | --- |
| `w6w endpoints run <key-or-id>` | Run an Endpoint and print its result. To send input, use `w6w run ep:<key> --payload <json>` instead. |

## Apps

| Command | What it does |
| --- | --- |
| `w6w apps by-ids <ids>` | Look up apps by id. `<ids>` is one comma-separated argument, for example `sendgrid,slack`. Unknown ids are left out. |

## Dashboard

| Command | What it does |
| --- | --- |
| `w6w dashboard stats [--from <iso>] [--to <iso>] [--bucket day\|week]` | Roll up your account's runs over a window. It covers the whole account, so there is no `--project`. Each flag is sent only when you pass it. |

## Projects

| Command | What it does |
| --- | --- |
| `w6w projects list` | List your projects: id, name, status and which is the default. If you have none, the server creates the default project first. |

## Reliability

| Command | What it does |
| --- | --- |
| `w6w reliability list --project <id> --apps <ids> [--days <n>] [--limit <n>]` | Health and performance for up to 10 apps (comma-separated ids). The server rejects more, and its error is shown as-is. |
| `w6w reliability members --project <id> [--days <n>]` | List the apps that count toward the project's reliability view. |

## Documents

Every documents command takes `--project <id>`. Without it, your account's default project is
used.

| Command | What it does |
| --- | --- |
| `w6w documents list` | List documents. |
| `w6w documents get <id>` | Print one document. |
| `w6w documents get-by-key <key>` | Print one document by its key. |
| `w6w documents create <key> --content <text> [--format <f>] [--description <d>]` | Create a document. `--format` is `text` (default), `markdown`, `yaml`, `html` or `json`. |
| `w6w documents update <id> [--content <text>] [--format <f>] [--description <d>]` | Change only the fields you pass. |
| `w6w documents delete <id>` | Delete a document. |

```bash
w6w documents create welcome-email --format markdown --content "$(cat welcome.md)"
```

## Vars

Vars belong to your account, so these commands don't take `--project`.

| Command | What it does |
| --- | --- |
| `w6w vars list` | List vars. |
| `w6w vars get <id>` | Print one var. |
| `w6w vars get-by-name <name>` | Print one var by name. |
| `w6w vars create <name> --type <t> --value <v> [--description <d>]` | Create a var. `--type` is `string`, `number`, `boolean` or `json`. |
| `w6w vars update <id> [--type <t>] [--value <v>] [--description <d>]` | Change only the fields you pass. |
| `w6w vars delete <id>` | Delete a var. |

Names use lowercase letters, digits and underscores, and start with a letter or underscore. For
`string` vars, `--value` is taken as-is. For the other types it's read as JSON:

```bash
w6w vars create sender_email --type string --value hello@example.com
w6w vars create max_retries --type number --value 3
w6w vars create regions --type json --value '["eu","us"]'
```

## Team

Any member can list members and invites. Inviting, revoking, changing roles and removing members
need the `owner` or `admin` role.

| Command | What it does |
| --- | --- |
| `w6w team members` | List your account's members and their roles. |
| `w6w team invite [--email <email>] [--role member\|admin]` | Invite someone. Leave out `--email` for an open invite link. The role defaults to `member`. |
| `w6w team invites` | List open invites. |
| `w6w team revoke-invite <invite-id>` | Revoke an invite before it's used. |
| `w6w team set-role <user-id> --role member\|admin` | Change a member's role. The owner's role can't be changed. |
| `w6w team remove-member <user-id>` | Remove a member. The owner can't be removed. |

`w6w team --help` says these commands return `404` because the server route isn't live. That note
is out of date: the team commands work.

## Models

The model registry: a catalog of AI models and named **model routes** that pick the model, provider
and fallbacks for you. These commands are `planned` in the wrappers contract. See the
[Node models page](/clients/node/models/) for the walkthrough. Every command takes `--project` to
use a project other than your account's default.

| Command | What it does |
| --- | --- |
| `w6w models ls [--provider <p>] [--status <s>] [--limit <n>] [--cursor <c>]` | List the catalog. When there is another page, the output ends with the `--cursor` to pass next. |
| `w6w models get <id>` | Show one catalog entry. |
| `w6w model-routes list` | List routes. |
| `w6w model-routes get <name>` | Show one route. |
| `w6w model-routes complete <name> --input <json> [--dialect <d>] [--response <r>]` | Run a completion through a route. `--input` must be a JSON object. |
| `w6w model-usage [--groupBy route\|model\|day] [--from <date>] [--to <date>] [--route <r>] [--model <m>] [--limit <n>] [--cursor <c>]` | Query recorded usage. |

`complete` prints the flat envelope exactly as the server sent it, including `invocationId` and
`status`. `--dialect` is `openai`, `anthropic`, `ollama` or `structured`; `--response` is `output`,
`raw` or `both`.

```bash
w6w models ls --provider openai --limit 20
w6w model-routes complete summarize \
  --input '{"messages":[{"role":"user","content":"Summarize this ticket."}]}' \
  --response both
w6w model-usage --groupBy route --from 2026-10-01 --to 2026-10-24
```

## Where to next

- **[CLI](/clients/cli/)**: setup, scripting, exit codes and known limitations.
- **[Node SDK reference](/clients/node/reference/)**: the same operations from code.
