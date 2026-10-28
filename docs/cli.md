# CLI — the help surface

`--help` is the CLI's documentation. Not a pointer to documentation — the thing
itself. Someone evaluating w6w will type `w6w --help` before they open a
browser, and whatever they see there is the first real impression the platform
makes.

This document specifies what help must produce. Everything else about the CLI
(operations, naming) lives in [endpoints.md](./endpoints.md).

## Three levels

Help resolves at every depth, and `-h` is an alias for `--help` at all of them:

```
w6w --help                      # root: what w6w is, global flags, command groups
w6w workflows --help            # group: the commands in that group
w6w documents --help            # group: the document CRUD commands
w6w vars --help                 # group: the variable CRUD commands
w6w workflows run --help        # command: arguments, flags, examples
w6w documents create --help     # command: arguments, flags, examples
```

Two commands sit at the root rather than inside a group, because they have no
siblings: `w6w me` (identity + component versions) and `w6w run` (run anything
addressable by a URN). They still resolve help at the command level —
`w6w run --help` — and `w6w --help` lists them alongside the groups.

`w6w help <command>` is accepted as an alias for `w6w <command> --help`, because
people type both.

Rules that make this actually work:

- **`--help` wins over everything.** It never authenticates, never reads config,
  never makes a network call, and exits `0`. `w6w workflows run --help` must
  work with no token set and no server reachable — the moment help needs
  credentials, it stops being usable at the exact time people need it most.
- **Bare `w6w` prints root help and exits `0`.** Not an error, not a usage stub.
- **An unknown or incomplete command prints the relevant help to stderr and
  exits `1`.** Wrong invocations are the other main way people read help; send
  them somewhere useful rather than printing "unknown command" alone.

## Root help

```
w6w — command-line client for the w6w workflow platform

USAGE
  w6w <command> [options]

COMMANDS
  me                     Caller identity plus w6w component versions
  run                    Run anything addressable by URN
  connections            List, inspect and delete connections
  workflows              List, run and edit workflows
  documents              Create, read, update and delete documents
  vars                   Create, read, update and delete variables
  functions              Run and edit functions
  endpoints              Run endpoints by key or id
  team                   Invite, list and manage your account's team
  apps                   Look up apps by id
  dashboard              Run-ledger rollup for your account
  projects               List your projects
  reliability            Health and performance of the apps you use
  auth                   Save, remove and inspect the stored API token
  config                 Show and set the API base URL

GLOBAL OPTIONS
  --base-url <url>       API base URL (default: https://api.w6w.io) (env: W6W_BASE_URL)
  --token <token>        API token (or save one: w6w auth login) (env: W6W_TOKEN)
  --json                 Output raw JSON instead of a table
  --no-color             Disable colored output
  -v, --version          Print the CLI version
  -h, --help             Show help for any command

EXAMPLES
  w6w me
  w6w workflows list
  w6w workflows run wf_01H… --wait
  w6w documents list
  w6w vars create greeting --type string --value hello
  w6w run conn_01H… --action send_email --payload '{"to":"a@b.com"}'

ALIASES
  conn                   same as `connections`
  wf                     same as `workflows`
  docs                   same as `documents`
  ls                     same as `list`, inside any group

  Docs: https://w6w.dev/docs/cli
```

`w6w info` is an accepted **alias of `w6w me`** (D8) — same operation, second
spelling, because "info" is what people reach for when they want to know what
they are talking to. The operation is named `me` everywhere else
(`endpoints.json` `naming.cli`, the SDK method); the alias exists only at the
CLI, is declared as `cliAlias` in `endpoints.json`, and `w6w info --help` prints
`w6w me`'s help. Aliases are not listed as separate `COMMANDS` entries — one
command, one line.

`conn`/`wf`/`docs`/`ls` are a second, narrower kind of alias: short spellings
for the two tokens that name a command path, substituted for their canonical
spelling before the command is even resolved — `w6w conn ls` and
`w6w connections list` parse to the exact same command. Unlike `w6w info`, these
are **not** declared in `endpoints.json`: they are pure CLI typing convenience
with nothing for a node or python caller to mirror, so they are hand-declared in
`src/args.ts` instead of generated. `conn`/`wf`/`docs` stand for a group name;
`ls` stands for `list` and applies inside _any_ group (`w6w vars ls`,
`w6w docs ls`, …), never outside one — `w6w run ls` leaves `ls` as `run`'s
positional argument, untouched.

## `auth` — the stored token

`w6w` targets **`https://api.w6w.io`** unless told otherwise (`endpoints.json`
`defaultBaseUrl`). `w6w auth` saves a token so later commands authenticate
without exporting anything. These three commands are CLI-only (declared in
`endpoints.json` `cli.commands[]`), use no network, and never print a token.

| Command | What it does |
| --- | --- |
| `w6w auth login [<token>\|-]` | Save the token for the resolved base URL and make that URL the current one. `-`, or no argument with piped input, reads the token from standard input (one trailing newline is stripped). With neither a token nor piped input it is a usage error — it never prompts. Never stores `--token` or `W6W_TOKEN`. |
| `w6w auth logout` | Remove the stored token for the resolved base URL. Other hosts and the current base URL are kept. Exits `0` whether or not one existed; never creates the file. |
| `w6w auth status` | Show the resolved base URL and its source (`flag`, `env`, `config` or `default`), and whether a token is available, its source and a masked form (`****` plus the last four characters; just `****` for a token shorter than 12). Exits `0` when logged out. `--json` prints exactly `{baseUrl, baseUrlSource, tokenSource, tokenMasked, configPath}`. |

Prefer the stdin form. A token given as an argument lands in your shell history
and is visible in the process list while the command runs:

```
printf '%s' "$TOKEN" | w6w auth login -
```

**Precedence**, per setting:

- base URL: `--base-url` > `W6W_BASE_URL` (blank counts as unset) > the stored
  base URL > `https://api.w6w.io`.
- token: `--token` > `W6W_TOKEN` > the token stored **for the resolved base URL**.

**A stored token is bound to the base URL it was saved for.** Hosts are keyed by
the canonical URL (trailing slashes stripped, so `https://x.example` and
`https://x.example/` are one host). Pointing `--base-url` or `W6W_BASE_URL` at a
different host never sends the stored token there: with no other token the
command exits `1` naming `w6w auth login`, before any request. Logging in to a
self-hosted server does not erase the cloud login.

**The file** is JSON, `{"version":1,"baseUrl":"…","hosts":{"<url>":{"token":"…"}}}`:

| OS | Path |
| --- | --- |
| Linux, macOS | `$XDG_CONFIG_HOME/w6w/config.json` when set to an absolute path (a relative value is ignored, per the XDG spec), else `~/.config/w6w/config.json` |
| Windows | `%APPDATA%\w6w\config.json` |

The directory is created `0700` and the file `0600`; each write goes to a temp
file in that directory and is renamed over `config.json`, and any looser mode an
existing file or directory had is tightened. Windows has no POSIX modes, so
there those are best-effort no-ops. There is no environment variable for the
path.

**A malformed file is never repaired.** If the file cannot be read or is not the
shape above, every command that runs (not `--help`/`--version`) exits `1` naming
the file's path — never its content — and `auth login` refuses to overwrite it.
Fix or delete it. A missing file simply means nothing is stored.

## `config` — the stored base URL

`w6w config` reads and writes only the stored `baseUrl`. Neither command touches
the network or prints a token.

| Command | What it does |
| --- | --- |
| `w6w config get-base-url` | Print the effective base URL and its source (`flag`, `env`, `config` or `default`), resolved by the same code a real command uses. `--json` prints exactly `{baseUrl, baseUrlSource, configBaseUrl?, configPath}`; `configBaseUrl` is present only when one is stored. |
| `w6w config set-base-url <url>` | Store the canonical URL (trailing slash stripped) as `baseUrl`. A blank, relative or non-http(s) URL is a usage error (exit `1`) and nothing is written. If `W6W_BASE_URL` is set to something else, a note on stderr says it still wins. |

`set-base-url` never changes `hosts`: no token is copied, moved or re-keyed. A
token saved for host A is not sent to host B, so after switching hosts run
`w6w auth login` for the new one (until then commands exit `1` naming
`w6w auth login`, before any request).

## `ls` — list a kind

`w6w ls <integrations|workflows|functions|endpoints> [--project <id>] [--json]`
is one root verb over the existing list commands:

| Kind | Same as |
| --- | --- |
| `workflows` | `w6w workflows list` (`--project` is forwarded) |
| `functions` | `w6w functions list` |
| `integrations` | `w6w connections list` |
| `endpoints` | lists through the SDK's **unstable** `console.endpoints` namespace; the human output says so, and it is not part of the stable contract |

Request, output and exit code for the first three are the delegate's, byte for
byte. A missing or unknown kind exits `1`, lists the four kinds and sends no
request. This root `ls` is distinct from the in-group `ls` alias for `list`
(`w6w documents ls`); `w6w run ls` still passes `ls` as the positional.

## Group help

A group's help lists its commands and nothing else; the group itself is never
runnable, so `w6w documents` with no subcommand prints this to stderr and exits
`1` (per the incomplete-command rule above).

```
w6w documents — create, read, update and delete documents

USAGE
  w6w documents <command> [options]

COMMANDS
  list                   List documents
  get                    Fetch a document by id
  get-by-key             Fetch a document by its key
  create                 Create a document
  update                 Patch a document
  delete                 Delete a document

OPTIONS
  --project <id>         Project to scope to (default: the account's default project)

EXAMPLES
  w6w documents list
  w6w documents get doc_01HQ8N
```

`w6w vars` is the same shape — `list`, `get`, `get-by-name`, `create`, `update`,
`delete` — with **one deliberate difference: there is no `--project` flag.**
Variables are scoped by tenant/subject only; the server ignores `?project=` on
every `vars` route. The asymmetry with `documents` is real and the help says so
rather than papering over it with a flag that does nothing.

```
w6w vars — create, read, update and delete variables

USAGE
  w6w vars <command> [options]

COMMANDS
  list                   List variables
  get                    Fetch a variable by id
  get-by-name            Fetch a variable by its name
  create                 Create a variable
  update                 Patch a variable
  delete                 Delete a variable

EXAMPLES
  w6w vars list
  w6w vars create greeting --type string --value hello
```

## Command help

Every command's help shows, in this order: a one-line summary, usage, positional
arguments, flags, and **at least one runnable example**. The example is the part
people actually copy, so it must be complete and correct — not `<workflow-id>`
in a position where a real id is required, without saying where to get one.

```
w6w workflows run — trigger a workflow run

USAGE
  w6w workflows run <id> [options]

ARGUMENTS
  <id>                   Workflow id (see: w6w workflows list)

OPTIONS
  --wait                 Wait for the run to reach a terminal state
  --input <json>         Run input, as a JSON string
  --json                 Output raw JSON

EXAMPLES
  w6w workflows run wf_01HQ8N --wait --json
  w6w workflows run wf_01HQ8N --input '{"email":"a@b.com"}'

NOTES
  Without --wait the run is queued and the command returns immediately with a
  run id and status "queued". With --wait the CLI returns when the run finishes
  or the server's wait window expires — a run still in progress is reported as
  "running", which is not an error.
```

That `NOTES` block is not optional decoration. The queued/waiting/failed
distinction
([endpoints.md §4](./endpoints.md#4-workflowsrun--trigger-a-workflow)) is the
single most confusing thing in this surface, and help is where it gets
explained.

`w6w run` earns a `NOTES` block for the same reason — it is the one command
whose output shape changes with its argument:

```
w6w run — run anything addressable by a URN

USAGE
  w6w run <urn> [options]

ARGUMENTS
  <urn>                  conn_… | wf_… | fn_… | ep_…
                         (see: w6w connections list, w6w workflows list)

OPTIONS
  --action <name>        Action to invoke (connection URNs only)
  --payload <json>       Input object, as a JSON string
  --json                 Output raw JSON

EXAMPLES
  w6w run conn_01HQ8N --action send_email --payload '{"to":"a@b.com"}'
  w6w run wf_01HQ8N --payload '{"email":"a@b.com"}'
  w6w run --app sendgrid --action send_email --payload '{"to":"a@b.com"}'

NOTES
  The result is tagged by kind. A connection action and a function return their
  value directly; a workflow returns a run id and status "queued" and is not
  waited on — use "w6w workflows run <id> --wait" when you need to wait, set
  variables, or pass a trigger. Documents and variables are not URNs: address
  them with "w6w documents" and "w6w vars".

  --app <id> addresses a connection URN by its app instead of a conn_… id —
  "w6w run --app sendgrid --action send_email" in place of "w6w run
  conn_01HQ8N --action send_email". It resolves against `w6w connections
  list`: one matching connection is used outright, and none or several is a
  usage error (several lists every candidate with the exact command to run
  against it). It cannot be combined with a URN argument, and it is CLI-only —
  there is no equivalent in the node or python wrapper.
```

Like the group aliases above, `--app` is **not** in `endpoints.json`: `run`'s
wire shape is exactly `{urn, action, payload}`, and `--app` never reaches it —
`src/commands/run.ts` resolves it to a connection's `conn_…` id itself, via
`connections.list()`, before the request is built. It is the one hand-declared
flag in this CLI that does not come from the generated help tree (`mod.ts`'s
`commandFlagSpecs`), for exactly the same reason the token aliases are
hand-declared rather than contract-driven.

## `agents` model options and `assets upload --visibility`

`w6w agents create` and `w6w agents update` take the sampling options of an
agent's model call as flags, assembled into the `modelOptions` body object
(contract 0.12.0):

```text
--temperature <n>         0 to 2
--top-p <n>               0 to 1
--max-output-tokens <n>   integer, 1 to 1000000
--stop <text>             repeatable; at most 4
```

`w6w agents update` replaces the whole `modelOptions` object when any of these
is given, so repeat every option you want to keep. `--stop` is the one
repeatable flag in this CLI: `--stop END --stop "###"` sends
`"stop": ["END", "###"]`.

`w6w assets upload --purpose context` takes `--visibility private|project|account`
and passes it through; with no `--collection` the upload is not tied to a
collection. `--visibility` with `--purpose skill` is a usage error.

## `context-entries` — context entries outside any collection

`w6w context-entries` manages text entries that do not belong to one collection
(contract 0.12.0; the SDK's `client.contextEntries.*`). The nested
`w6w context entries-*` commands keep working for collection-scoped entries.

```
w6w context-entries list [--collection-id <id>] [--include-archived] [--project <p>]
w6w context-entries create <name> --text <text> [--visibility <v>] [--collection-id <id>]
w6w context-entries get <id>
w6w context-entries update <id> --text <text> --revision <n> [--if-unmodified-since <ts>]
w6w context-entries archive <id>
w6w context-entries add-to-collection <id> <collectionId>
w6w context-entries remove-from-collection <id> <collectionId>
```

`--collection-id` on `create` takes one id or a comma-separated list (the flag
parser keeps only the last value of a repeated flag). `update` is a precondition
write: it sends the body `revision` and, when given, the `--if-unmodified-since`
header, and a stale revision is reported with the current one, as for
`w6w context entries-update`. `add-to-collection` and `remove-from-collection`
are idempotent.

## Exit codes

Help text is a promise about behavior, so the codes are part of the contract:

| Code | Meaning                                                                  |
| ---- | ------------------------------------------------------------------------ |
| `0`  | Success — including help, and including a _queued_ or _running_ workflow |
| `1`  | Usage error — unknown command, missing argument, bad flag                |
| `2`  | API error — 4xx/5xx from the server, including auth failure              |
| `3`  | Run failure — `--wait` returned a run with status `failed`               |

Code `3` exists so `w6w workflows run --wait` is usable in CI without parsing
stdout. Keeping it distinct from `2` matters: a failed workflow and an
unreachable API demand opposite responses, and a script that can't tell them
apart will retry the wrong one.

## Help is generated, not written

Command and flag help derive from [`../endpoints.json`](../endpoints.json) — the
same contract the conformance test reads. Summaries come from each operation's
`summary`, flags from its `params`, and the caveats from its `notes`.

This is the point. Hand-written help is drift waiting to happen: an operation
changes, three wrappers get updated, and the help text keeps describing last
version's behavior with total confidence. Generating it means the CLI cannot
document an operation it does not have, or omit one it does.

Prose that has nowhere to live in `endpoints.json` — the root description,
examples — stays hand-written, but it is deliberately the part that changes
least.

## Conformance

The CLI's conformance test additionally asserts:

- `w6w --help`, `w6w <group> --help`, and `w6w <group> <cmd> --help` each exit
  `0` and produce non-empty output, **with no token in the environment**;
- **every** operation in `endpoints.json` — `required` and `planned` alike,
  since `status` records server readiness rather than wrapper obligation
  ([parity.md](./parity.md#conformance)) — appears in the help of its group, or
  in root help for the two root-level commands;
- `w6w --version` prints the version from `VERSION`.

The no-token condition is the one that regresses. It breaks the first time
someone moves auth setup into a shared startup path, and it breaks silently for
anyone who already has a token configured — which is everyone on the team.
