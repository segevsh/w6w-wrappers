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
| `--base-url <url>` | Your API origin. Overrides `W6W_BASE_URL`. |
| `--token <token>` | Your API token. Overrides `W6W_TOKEN`. |
| `--json` | Print the raw JSON response instead of a table. |
| `--no-color` | Turn off colour. Setting `NO_COLOR` does the same. |
| `-v`, `--version` | Print the CLI version. |
| `-h`, `--help` | Show help for any command. |

Shortcuts: `conn` for `connections`, `wf` for `workflows`, `docs` for `documents`, and `ls` for
`list` in any group.

Flags that take JSON (`--payload`, `--input`, `--definition`, and `--value` for non-string vars)
expect a JSON value in one shell argument. Wrap it in single quotes, or read it from a file with
`"$(cat file.json)"`.

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

## Workflows

| Command | What it does |
| --- | --- |
| `w6w workflows list [--project <id>]` | List workflows. |
| `w6w workflows run <id-or-key> [--wait] [--input <json>]` | Start a run. `--wait` waits for it to finish, up to the server's limit. Exits `3` if the run failed. |
| `w6w workflows cancel <run-id>` | Ask for a run to be cancelled. It reports the run's status at that moment. |
| `w6w workflows get <id>` | Print a workflow's full definition and its `updatedAt`. |
| `w6w workflows create --definition <json> [--project <id>]` | Create a workflow from a definition. A new `wf_…` id is assigned if it has none. |
| `w6w workflows update <id> --definition <json> [--project <id>]` | Replace a workflow's definition. Send the whole definition: fields you leave out are removed. |
| `w6w workflows archive <id>` | Archive a workflow. Required before deleting it. |
| `w6w workflows delete <id>` | Delete an archived workflow. |

`w6w workflows run` also lists `--var` and `--trigger`, and `update` lists
`--if-unmodified-since`, but these aren't applied yet. See
[Known limitations](/clients/cli/#known-limitations).

## Functions

| Command | What it does |
| --- | --- |
| `w6w functions run <key-or-id>` | Run a Function and print its output. Pass the key as an argument. To send inputs, use `w6w run fn:<key> --payload <json>` instead. |
| `w6w functions list` | List your Functions, and whether each can run. |
| `w6w functions get <id>` | Print a Function's definition. |
| `w6w functions create --definition <json>` | Create a Function. A new `fn_…` id is assigned if it has none. |
| `w6w functions update <id> --definition <json>` | Replace a Function's definition. |
| `w6w functions delete <id>` | Delete a Function. It must be archived first, which the CLI can't do yet. Archive it in Studio or from an SDK. |

## Endpoints

| Command | What it does |
| --- | --- |
| `w6w endpoints run <key-or-id>` | Run an Endpoint and print its result. To send input, use `w6w run ep:<key> --payload <json>` instead. |

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

## Where to next

- **[CLI](/clients/cli/)**: setup, scripting, exit codes and known limitations.
- **[Node SDK reference](/clients/node/reference/)**: the same operations from code.
