/**
 * The help generator.
 *
 * `w6w --help` is the CLI's documentation, and hand-written help is drift waiting
 * to happen: an operation changes, three wrappers get updated, and the help text
 * keeps describing last version's behaviour with total confidence. So the command
 * tree is **generated** from the shared wrapper surface contract that all three
 * wrappers implement — the sibling `../../endpoints.json`, resolved from this
 * module's own location and never from the process working directory.
 *
 * ── MECHANISM PIN — generation happens at DEVELOPMENT time, never at runtime ──
 *
 * The contract file sits beside this repo, among its two sibling wrapper repos —
 * it is not part of the published package. A `@w6w/cli` installed from npm on
 * someone else's machine has no `../../endpoints.json` at all, so a CLI that read
 * it at runtime would work here in development and break for every installed
 * user. That is unsound by construction, not merely inconvenient.
 *
 * The mechanism instead:
 *
 *   1. `deno task gen:help` runs this script, which reads the contract and writes
 *      the checked-in module `src/help.generated.ts`.
 *   2. The runtime imports **only** that generated module. Nothing under `src/`
 *      opens a JSON file, and nothing under `src/` needs a `--allow-read` grant
 *      for the contract.
 *   3. `tests/help_test.ts` re-runs `renderHelpModule()` and compares its output
 *      to the checked-in file **byte for byte**, so a contract change that was not
 *      regenerated fails the suite rather than shipping stale help.
 *
 * ── What is generated and what is hand-written ──
 *
 * Generated from the contract: the command tree (group and command names derived
 * from each operation's `naming.cli`), each command's `summary`, its parameters,
 * the `me` operation's `cliAlias`, the global flags with their env vars and
 * aliases, and the exit codes.
 *
 * Hand-written here, because it has nowhere to live in the contract (and, per
 * `docs/cli.md`, is deliberately the part that changes least): the root tagline,
 * group summaries, per-parameter descriptions, and the runnable examples. Adding
 * an operation to the contract without adding its prose here makes this script
 * **throw**, naming what is missing — the prose cannot silently fall behind.
 *
 * Deliberately NOT copied: each operation's `notes`. Those are written for wrapper
 * implementers, not for users, and they cite file paths inside private
 * repositories — which must never reach a published help string. The two `NOTES`
 * blocks the CLI help specification requires — for `workflows run` and `run` — are
 * transcribed by hand below, in user-facing language.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// The shape of the contract this script reads.
// ---------------------------------------------------------------------------

/** One parameter of an operation, as declared in the contract. */
export interface ContractParam {
  name: string;
  in: string;
  type: string;
  required: boolean;
}

/** One operation of the shared surface contract. */
export interface ContractOperation {
  name: string;
  summary: string;
  method: string;
  path: string;
  status: string;
  cliAlias?: string;
  params: ContractParam[];
  naming: { ts: string; python: string; cli: string };
}

/**
 * A command that exists only in the CLI (no API operation behind it), declared in
 * the contract's `cli.commands[]`. Built through the same path as an operation.
 */
export interface ContractCliCommand {
  name: string;
  summary: string;
  status: string;
  naming: string;
  params: ContractParam[];
}

/** The CLI-only block of the contract. */
export interface ContractCli {
  binary: string;
  commands?: ContractCliCommand[];
  globalFlags: { name: string; alias?: string; type: string; env?: string; source?: string }[];
  exitCodes: Record<string, string>;
}

/** The parts of the contract this generator reads. */
export interface Contract {
  contractVersion: string;
  operations: ContractOperation[];
  cli: ContractCli;
}

// ---------------------------------------------------------------------------
// Hand-written prose. Everything else comes from the contract.
// ---------------------------------------------------------------------------

const TAGLINE = "command-line client for the w6w workflow platform";
const DOCS_URL = "https://w6w.dev/docs/cli";

const ROOT_EXAMPLES = [
  "w6w me",
  "w6w workflows list",
  "w6w workflows run wf_01H… --wait",
  "w6w documents list",
  "w6w vars create greeting --type string --value hello",
  `w6w run conn_01H… --action send_email --payload '{"to":"a@b.com"}'`,
];

/** Summary shown for each group, in root help and in that group's own headline. */
const GROUP_SUMMARIES: Record<string, string> = {
  connections: "List, inspect and delete connections",
  workflows: "List, run and edit workflows",
  functions: "Run and edit functions",
  endpoints: "Run endpoints by key or id",
  documents: "Create, read, update and delete documents",
  models: "Browse the model catalog",
  assets: "Upload, inspect and download versioned assets (skills, context files)",
  skills: "List, inspect and archive skills (upload them with: w6w assets upload --purpose skill)",
  context: "Create and edit context collections and their text entries",
  "context-entries": "Create and edit context entries independent of any collection",
  agents: "Create and edit agent drafts (drafts only: no agent runtime exists yet)",
  "model-routes": "List model routes and run completions through them",
  "model-usage": "Query model usage and cost",
  vars: "Create, read, update and delete variables",
  team: "Invite, list and manage your account's team",
  apps: "Look up apps by id",
  dashboard: "Run-ledger rollup for your account",
  projects: "List your projects",
  reliability: "Health and performance of the apps you use",
  auth: "Save, remove and inspect the stored API token",
  config: "Show and set the API base URL",
  build: "Build apps locally (no API call)",
};

const GROUP_EXAMPLES: Record<string, string[]> = {
  connections: ["w6w connections list"],
  functions: ["w6w functions run send-email"],
  endpoints: ["w6w endpoints run send-email"],
  workflows: ["w6w workflows list", "w6w workflows run wf_01HQ8N --wait"],
  documents: ["w6w documents list", "w6w documents get doc_01HQ8N"],
  models: ["w6w models ls", "w6w models get mdl_01HQ8N"],
  assets: ["w6w assets upload ./my-skill --purpose skill", "w6w assets get ast_01HQ8N"],
  skills: ["w6w skills list", "w6w skills versions sk_01HQ8N"],
  context: ["w6w context list", "w6w context entries-list cc_01HQ8N"],
  "context-entries": ["w6w context-entries list", "w6w context-entries get ent_01HQ8N"],
  agents: ["w6w agents list", "w6w agents get ag_01HQ8N"],
  "model-routes": ["w6w model-routes list", "w6w model-routes get summarize"],
  "model-usage": ["w6w model-usage"],
  vars: ["w6w vars list", "w6w vars create greeting --type string --value hello"],
  team: ["w6w team members", "w6w team invite --email new@example.com --role admin"],
  apps: ["w6w apps by-ids sendgrid,slack"],
  dashboard: ["w6w dashboard stats", "w6w dashboard stats --bucket week"],
  projects: ["w6w projects list"],
  reliability: [
    "w6w reliability members --project prj_01HQ8N",
    "w6w reliability list --project prj_01HQ8N --apps sendgrid,slack",
  ],
  auth: ["w6w auth status", "printf '%s' \"$W6W_TOKEN\" | w6w auth login -"],
  config: ["w6w config get-base-url", "w6w config set-base-url https://w6w.example.com"],
  build: ["w6w build app ./apps/2chat"],
};

/** At least one runnable example per command — the part people actually copy. */
const COMMAND_EXAMPLES: Record<string, string[]> = {
  "assets.upload": [
    "w6w assets upload ./my-skill --purpose skill --skill sk_01HQ8N",
    "w6w assets upload ./docs --purpose context --collection cc_01HQ8N --retry",
  ],
  "assets.uploads.create": [
    'w6w assets upload-create --purpose skill --idempotency-key k1 --entries \'[{"path":"SKILL.md","sizeBytes":12,"sha256":"<hex>"}]\'',
  ],
  "assets.uploads.putEntry": [
    "w6w assets upload-put up_01HQ8N 0 --file ./SKILL.md",
  ],
  "assets.uploads.finalize": [
    "w6w assets upload-finalize up_01HQ8N",
  ],
  "assets.uploads.get": [
    "w6w assets upload-status up_01HQ8N",
  ],
  "assets.uploads.abort": [
    "w6w assets upload-abort up_01HQ8N",
  ],
  "assets.get": [
    "w6w assets get ast_01HQ8N",
  ],
  "assets.versions": [
    "w6w assets versions ast_01HQ8N",
  ],
  "assets.files": [
    "w6w assets files ast_01HQ8N ver_01HQ8N",
  ],
  "assets.content": [
    "w6w assets content ast_01HQ8N ver_01HQ8N fil_01HQ8N --out ./SKILL.md",
  ],
  "assets.archiveDownload": [
    "w6w assets archive-download ast_01HQ8N ver_01HQ8N --out ./asset.zip",
  ],
  "assets.archive": [
    "w6w assets archive ast_01HQ8N",
  ],
  "assets.purge": [
    "w6w assets purge ast_01HQ8N",
  ],
  "skills.list": [
    "w6w skills list",
    "w6w skills list --include-archived --limit 20",
  ],
  "skills.get": [
    "w6w skills get sk_01HQ8N",
  ],
  "skills.versions": [
    "w6w skills versions sk_01HQ8N",
  ],
  "skills.archive": [
    "w6w skills archive sk_01HQ8N",
  ],
  "context.list": [
    "w6w context list",
    "w6w context list --include-archived",
  ],
  "context.create": [
    'w6w context create handbook --description "Team handbook" --tags docs,hr',
  ],
  "context.get": [
    "w6w context get cc_01HQ8N",
  ],
  "context.update": [
    'w6w context update cc_01HQ8N --description "Updated handbook"',
  ],
  "context.archive": [
    "w6w context archive cc_01HQ8N",
  ],
  "contextEntries.list": [
    "w6w context-entries list",
    "w6w context-entries list --collection-id cc_01HQ8N --include-archived",
  ],
  "contextEntries.create": [
    'w6w context-entries create welcome --text "Welcome aboard" --visibility account',
  ],
  "contextEntries.get": ["w6w context-entries get ent_01HQ8N"],
  "contextEntries.update": [
    'w6w context-entries update ent_01HQ8N --text "Hello again" --revision 1 --if-unmodified-since 2026-10-24T09:00:00.000Z',
  ],
  "contextEntries.archive": ["w6w context-entries archive ent_01HQ8N"],
  "contextEntries.addToCollection": ["w6w context-entries add-to-collection ent_01HQ8N cc_01HQ8N"],
  "contextEntries.removeFromCollection": [
    "w6w context-entries remove-from-collection ent_01HQ8N cc_01HQ8N",
  ],
  "context.entries.list": [
    "w6w context entries-list cc_01HQ8N",
  ],
  "context.entries.create": [
    'w6w context entries-create cc_01HQ8N welcome --text "Welcome aboard"',
  ],
  "context.entries.update": [
    'w6w context entries-update cc_01HQ8N ent_01HQ8N --text "Hello again" --revision 1 --if-unmodified-since 2026-10-24T09:00:00.000Z',
  ],
  "agents.list": [
    "w6w agents list",
    "w6w agents list --include-archived",
  ],
  "agents.create": [
    'w6w agents create --name triage --instructions "Route support mail" --model-route-id mr_01HQ8N',
    'w6w agents create --name triage --temperature 0.2 --stop END --stop "###"',
  ],
  "agents.get": [
    "w6w agents get ag_01HQ8N",
  ],
  "agents.update": [
    'w6w agents update ag_01HQ8N --revision 3 --instructions "Be brief" --if-unmodified-since 2026-10-24T09:00:00.000Z',
  ],
  "agents.archive": [
    "w6w agents archive ag_01HQ8N",
  ],
  "auth.login": [
    "printf '%s' \"$W6W_TOKEN\" | w6w auth login -",
    "w6w auth login <token>",
    "w6w auth login - --base-url https://w6w.example.com",
  ],
  "auth.logout": ["w6w auth logout", "w6w auth logout --base-url https://w6w.example.com"],
  "auth.status": ["w6w auth status", "w6w auth status --json"],
  "config.get-base-url": ["w6w config get-base-url", "w6w config get-base-url --json"],
  "config.set-base-url": [
    "w6w config set-base-url https://w6w.example.com",
    "w6w config set-base-url https://api.w6w.io",
  ],
  "build.app": [
    "w6w build app ./apps/2chat",
    "w6w build app ./apps/2chat --out ./out/2chat --pack ./w6w-pack.json",
  ],
  "ls": [
    "w6w ls workflows",
    "w6w ls integrations --json",
    "w6w ls workflows --project prj_01HQ8N",
    "w6w ls endpoints",
  ],
  "me": ["w6w me", "w6w info"],
  "connections.list": ["w6w connections list", "w6w connections list --json"],
  "connections.get": ["w6w connections get conn_01HQ8N", "w6w connections get conn_01HQ8N --json"],
  "connections.delete": ["w6w connections delete conn_01HQ8N"],
  "apps.byIds": ["w6w apps by-ids sendgrid,slack", "w6w apps by-ids sendgrid --json"],
  "dashboard.stats": [
    "w6w dashboard stats",
    "w6w dashboard stats --from 2026-10-01T00:00:00Z --to 2026-10-08T00:00:00Z --bucket day",
  ],
  "projects.list": ["w6w projects list", "w6w projects list --json"],
  "reliability.list": [
    "w6w reliability list --project prj_01HQ8N --apps sendgrid,slack",
    "w6w reliability list --project prj_01HQ8N --apps sendgrid --days 7 --limit 20 --json",
  ],
  "reliability.members": [
    "w6w reliability members --project prj_01HQ8N",
    "w6w reliability members --project prj_01HQ8N --days 30 --json",
  ],
  "workflows.list": ["w6w workflows list", "w6w workflows list --project prj_01HQ8N"],
  // The key form is shown FIRST in both: it is the address a reader actually
  // has, and the id form is the fallback for a resource whose key they do not
  // know. Both reach the same command — one slot, no flag.
  "functions.run": [
    "w6w functions run send-email",
    `w6w functions run send-email --payload '{"to":"a@b.com"}'`,
    "w6w functions run fn_01HQ8N --json",
    "w6w functions run send-email --allow-unpublished",
  ],
  "endpoints.run": [
    "w6w endpoints run send-email",
    `w6w endpoints run send-email --payload '{"to":"a@b.com"}'`,
  ],
  "workflows.run": [
    "w6w workflows run wf_01HQ8N --allow-unpublished --wait",
    "w6w workflows run wf_01HQ8N --wait --json",
    `w6w workflows run wf_01HQ8N --input '{"email":"a@b.com"}'`,
  ],
  // The definition lifecycle. `--definition` takes a JSON object as a string;
  // the examples show the shell idiom that makes that bearable for a real
  // definition, since this lane reads no files.
  "workflows.get": ["w6w workflows get wf_01HQ8N", "w6w workflows get wf_01HQ8N --json"],
  "workflows.create": [
    `w6w workflows create --definition '{"manifestVersion":"2","name":"nightly","nodes":[]}'`,
    `w6w workflows create --definition "$(cat workflow.json)" --project prj_01HQ8N`,
  ],
  "workflows.update": [
    `w6w workflows update wf_01HQ8N --definition "$(cat workflow.json)"`,
    `w6w workflows update wf_01HQ8N --definition "$(cat workflow.json)" --if-unmodified-since 2026-08-22T09:00:00.000Z`,
  ],
  "workflows.cancel": ["w6w workflows cancel run_01HQ8N"],
  "workflows.archive": ["w6w workflows archive wf_01HQ8N"],
  "workflows.delete": ["w6w workflows archive wf_01HQ8N", "w6w workflows delete wf_01HQ8N"],
  "functions.list": ["w6w functions list", "w6w functions list --json"],
  "functions.get": ["w6w functions get send-email", "w6w functions get fn_01HQ8N --json"],
  "functions.create": [
    `w6w functions create --definition '{"manifestVersion":"1","key":"send-email","inputs":[]}'`,
    `w6w functions create --definition "$(cat function.json)"`,
  ],
  "functions.update": [
    `w6w functions update fn_01HQ8N --definition "$(cat function.json)"`,
    `w6w functions update fn_01HQ8N --definition "$(cat function.json)" --if-unmodified-since 2026-08-22T09:00:00.000Z`,
  ],
  "functions.delete": ["w6w functions delete fn_01HQ8N"],
  "workflows.listVersions": [
    "w6w workflows versions wf_01HQ8N",
    "w6w workflows versions wf_01HQ8N --json",
  ],
  "workflows.getVersion": [
    "w6w workflows version wf_01HQ8N 3",
    "w6w workflows version wf_01HQ8N 3 --json",
  ],
  "workflows.publish": ["w6w workflows publish wf_01HQ8N"],
  "workflows.revert": ["w6w workflows revert wf_01HQ8N 2"],
  "workflows.enable": ["w6w workflows enable wf_01HQ8N"],
  "workflows.disable": ["w6w workflows disable wf_01HQ8N"],
  "functions.listVersions": [
    "w6w functions versions fn_01HQ8N",
    "w6w functions versions fn_01HQ8N --json",
  ],
  "functions.getVersion": [
    "w6w functions version fn_01HQ8N 3",
    "w6w functions version fn_01HQ8N 3 --json",
  ],
  "functions.publish": ["w6w functions publish fn_01HQ8N"],
  "functions.revert": ["w6w functions revert fn_01HQ8N 2"],
  "functions.enable": ["w6w functions enable fn_01HQ8N"],
  "functions.disable": ["w6w functions disable fn_01HQ8N"],
  "functions.archive": ["w6w functions archive fn_01HQ8N", "w6w functions delete fn_01HQ8N"],
  "workflows.runVersion": [
    "w6w workflows run-version wf_01HQ8N 3 --wait",
    `w6w workflows run-version wf_01HQ8N 3 --input '{"email":"a@b.com"}'`,
  ],
  "functions.runVersion": [
    "w6w functions run-version send-email 3",
    `w6w functions run-version fn_01HQ8N 3 --payload '{"to":"a@b.com"}'`,
  ],
  "models.list": ["w6w models ls", "w6w models ls --provider openai"],
  "models.get": ["w6w models get mdl_01HQ8N"],
  "modelRoutes.list": ["w6w model-routes list", "w6w model-routes list --project prj_01HQ8N"],
  "modelRoutes.get": ["w6w model-routes get summarize"],
  "modelRoutes.complete": [
    `w6w model-routes complete summarize --input '{"messages":[{"role":"user","content":"Hi"}]}'`,
    `w6w model-routes complete summarize --input '{"prompt":"Hi"}' --dialect openai --response output`,
  ],
  "modelUsage.query": ["w6w model-usage", "w6w model-usage --group-by route --from 2026-10-01"],
  "documents.list": ["w6w documents list", "w6w documents list --project prj_01HQ8N"],
  "documents.get": ["w6w documents get doc_01HQ8N"],
  "documents.getByKey": ["w6w documents get-by-key onboarding-email"],
  "documents.create": [
    `w6w documents create onboarding-email --content "Welcome aboard!" --format markdown`,
  ],
  "documents.update": [`w6w documents update doc_01HQ8N --content "Welcome aboard!"`],
  "documents.delete": ["w6w documents delete doc_01HQ8N"],
  "vars.list": ["w6w vars list"],
  "vars.get": ["w6w vars get var_01HQ8N"],
  "vars.getByName": ["w6w vars get-by-name greeting"],
  "vars.create": ["w6w vars create greeting --type string --value hello"],
  "vars.update": ["w6w vars update var_01HQ8N --value goodbye"],
  "vars.delete": ["w6w vars delete var_01HQ8N"],
  "team.members.list": ["w6w team members"],
  "team.invites.create": [
    "w6w team invite --email new@example.com --role admin",
    "w6w team invite",
  ],
  "team.invites.list": ["w6w team invites"],
  "team.invites.revoke": ["w6w team revoke-invite inv_01HQ8N"],
  "team.members.updateRole": ["w6w team set-role usr_01HQ8N --role admin"],
  "team.members.remove": ["w6w team remove-member usr_01HQ8N"],
  "run": [
    `w6w run conn_01HQ8N --action send_email --payload '{"to":"a@b.com"}'`,
    `w6w run wf_01HQ8N --payload '{"email":"a@b.com"}'`,
    `w6w run --app sendgrid --action send_email --payload '{"to":"a@b.com"}'`,
  ],
};

/**
 * The two `NOTES` blocks `docs/cli.md` calls non-optional: the queued/waiting/
 * failed distinction, and the kind-tagged result of `run`. Written for users —
 * the contract's own `notes` fields cite private repository paths and are not
 * copied (see the module docstring).
 */
const COMMAND_NOTES: Record<string, string[]> = {
  "workflows.run": [
    "Without --wait the run is queued and the command returns immediately with a run id and " +
    'status "queued". With --wait the CLI returns when the run finishes or the server\'s wait ' +
    'window expires — a run still in progress is reported as "running", which is not an error.',
    'A run that finished with status "failed" exits 3, so --wait is usable in CI without ' +
    "parsing stdout.",
    "--allow-unpublished runs the STORED draft even if it was never published (a disabled " +
    "workflow is still refused). It runs the row as last saved, never a definition you pass " +
    "here, so save first. It is sent only when given.",
  ],
  "workflows.runVersion": [
    "Runs the published snapshot numbered <n>, never the saved draft. --wait and the exit code " +
    'behave as in `w6w workflows run`: a finished run with status "failed" exits 3.',
  ],
  "functions.runVersion": [
    "Runs the published snapshot numbered <n> and prints the Function's output, as `w6w functions run` does.",
  ],
  "workflows.publish": [
    "Publishes the workflow as saved: snapshots the stored row into a new numbered version. " +
    "Save any pending edit first.",
  ],
  "functions.publish": [
    "Publishes the Function as saved: snapshots the stored row into a new numbered version. " +
    "Save any pending edit first.",
  ],
  "functions.run": [
    "--allow-unpublished runs the STORED draft even if it was never published (a disabled " +
    "Function is still refused). It is sent only when given.",
  ],
  "reliability.list": [
    "--apps takes at most 10 comma-separated app ids; the server rejects more and its error " +
    "is shown unchanged. --days and --limit are positive integers.",
  ],
  "run": [
    "The result is tagged by kind. A connection action and a function return their value " +
    'directly; a workflow returns a run id and status "queued" and is not waited on — use ' +
    '"w6w workflows run <id> --wait" when you need to wait, set variables, or pass a trigger. ' +
    'Documents and variables are not URNs: address them with "w6w documents" and "w6w vars".',
    "--app <id> addresses a connection URN by its app instead of a conn_… id — " +
    '"w6w run --app sendgrid --action send_email" in place of "w6w run conn_01HQ8N ' +
    '--action send_email". It resolves against `w6w connections list`: one matching ' +
    "connection is used outright, and none or several is a usage error (several lists every " +
    "candidate with the exact command to run against it). It cannot be combined with a URN " +
    "argument, and it is CLI-only — there is no equivalent in the node or python wrapper.",
  ],
};

/**
 * Parameter descriptions, keyed `<operation>.<param>` first and by bare parameter
 * name second. A parameter matching neither is a generator error, so a parameter
 * added to the contract cannot reach help undescribed.
 */
const PARAM_HELP: Record<string, string> = {
  out: "Write the bytes to this file instead of standard output",
  purpose: "What the upload is for: skill | context (asset for upload-create)",
  idempotencyKey: "A caller-chosen key; replaying it with the same entries returns the same upload",
  entries: "The declared entries, as a JSON array of {path, sizeBytes, sha256, mediaType?}",
  visibility: "Who can see the asset: private | project | account (default private)",
  assetId: "Publish a new version of this existing asset instead of creating one",
  target: 'Purpose-specific destination, as a JSON object like {"skillId":"sk_…"}',
  index: "Zero-based index of the declared entry",
  versionId: "Asset version id",
  fileId: "File id within the asset version (see: `w6w assets files`)",
  skill: "Attach the uploaded files to this skill id",
  collection: "Attach the uploaded files to this context collection id",
  retry: "Resume an interrupted upload: skip entries the server already received",
  "assets.uploads.create.name": "Display name for a new asset",
  "assets.uploads.putEntry.body": "Path of the file whose bytes are sent as the entry",
  "assets.upload.path": "A directory to upload (or a .zip file, sent as a single archive)",
  "assets.uploads.putEntry.id": "Upload id (see: `w6w assets upload-create`)",
  "assets.uploads.finalize.id": "Upload id (up_…)",
  "assets.uploads.get.id": "Upload id (up_…)",
  "assets.uploads.abort.id": "Upload id (up_…)",
  "assets.get.id": "Asset id",
  "assets.versions.id": "Asset id",
  "assets.files.id": "Asset id",
  "assets.content.id": "Asset id",
  "assets.archiveDownload.id": "Asset id",
  "assets.archive.id": "Asset id",
  "assets.purge.id": "Asset id",
  "auth.login.token":
    "The API token to save, or `-` to read it from standard input (default when input is piped)",
  "config.set-base-url.url":
    "The API origin to save, like https://api.example.com (a trailing slash is dropped)",
  "build.app.folder":
    "The app directory: a package.json with a `w6w` block, version, scripts.test, scripts.build and main",
  "build.app.out":
    "Where to write app.js and manifest.json (icons are embedded in it as data: URIs; default: the directory of the built file)",
  "build.app.pack":
    "A pack or index JSON file (with an `apps` array) to update with the app's id, version and digest; created if missing",
  "ls.kind":
    "What to list: integrations | workflows | functions | endpoints (endpoints is unstable)",
  "ls.project": "Project to scope to (workflows only; other kinds ignore it)",
  "models.list.provider": "Only models from this provider (e.g. openai)",
  "models.list.status": "Only models with this status",
  "models.get.id": "Catalog model id (mdl_…), not a provider-native id like gpt-4o",
  "modelRoutes.get.name": "Model route name",
  "modelRoutes.complete.name": "Model route name",
  "modelRoutes.complete.input": "The completion input, as a JSON object",
  "modelRoutes.complete.dialect": "Request dialect: openai | anthropic | ollama",
  "modelRoutes.complete.response": "Response shape: both | output | raw",
  "modelUsage.query.groupBy": "Group usage by this dimension",
  "modelUsage.query.from": "Start of the window (ISO timestamp)",
  "modelUsage.query.to": "End of the window (ISO timestamp)",
  "modelUsage.query.route": "Only usage through this model route id (mrt_…)",
  "modelUsage.query.model": "Only usage of this catalog model id (mdl_…)",
  "limit": "Maximum number of results per page",
  "cursor": "Pagination cursor from a previous page",
  // Shared fallbacks, by bare parameter name.
  "project": "Project to scope to (default: the account's default project)",
  "description": "Human-readable description",
  "format": "Content format hint: text|markdown|yaml|html|json (default: text)",
  "content": "Document content, as raw text",
  "type": "Value type: string|number|boolean|json",
  "value": "Value, validated against the variable's type",

  // Per-operation, where the bare name is ambiguous or the wording matters.
  // Name-addressed run. The slot takes an id OR the key the user gave the
  // resource — they are disjoint shapes, so there is no flag to describe here.
  "functions.run.idOrKey": "Function key or id (e.g. send-email)",
  "functions.run.inputs": "The Function's inputs, as a JSON object",
  "endpoints.run.idOrKey": "Endpoint key or id (e.g. send-email)",
  "endpoints.run.input": "The Endpoint's input, as a JSON object",
  "workflows.run.id": "Workflow id (see: w6w workflows list)",
  "workflows.run.wait": "Wait for the run to reach a terminal state",
  "workflows.run.variables": "Set a run variable (repeatable)",
  "workflows.run.trigger": "Trigger payload, as a JSON string",
  "workflows.run.input": "Run input, as a JSON string",
  "documents.get.id": "Document id (see: w6w documents list)",
  "documents.update.id": "Document id (see: w6w documents list)",
  "documents.delete.id": "Document id (see: w6w documents list)",
  "documents.getByKey.key": "Document key, as chosen at creation",
  "documents.create.key": "Document key to create (unique per project)",
  "vars.get.id": "Variable id (see: w6w vars list)",
  "vars.update.id": "Variable id (see: w6w vars list)",
  "vars.delete.id": "Variable id (see: w6w vars list)",
  "vars.getByName.name": "Variable name, as chosen at creation",
  "vars.create.name": "Variable name to create (must match ^[A-Za-z_][A-Za-z0-9_]*$)",
  // The definition lifecycle. `definition` is the same word in both domains and
  // means the same thing, so it is a bare fallback; the id help differs per
  // domain because the two point a caller at different list commands.
  "skills.get.id": "Skill id (see: w6w skills list)",
  "skills.versions.id": "Skill id (see: w6w skills list)",
  "skills.archive.id": "Skill id (see: w6w skills list)",
  "context.get.id": "Context collection id (see: w6w context list)",
  "context.update.id": "Context collection id (see: w6w context list)",
  "context.archive.id": "Context collection id (see: w6w context list)",
  "context.entries.list.id": "Context collection id (see: w6w context list)",
  "context.entries.create.id": "Context collection id (see: w6w context list)",
  "context.entries.update.id": "Context collection id (see: w6w context list)",
  "agents.get.id": "Agent id (see: w6w agents list)",
  "agents.update.id": "Agent id (see: w6w agents list)",
  "agents.archive.id": "Agent id (see: w6w agents list)",
  "includeArchived": "Include archived rows (default: hidden)",
  "tags": "Tags, comma-separated or a JSON array of strings",
  "text": "The entry's text content",
  "revision":
    "The revision you last read (from the entry/agent you are editing); a stale one is refused with a conflict",
  "entryId": "Entry id (see: w6w context entries-list)",
  "instructions": "The agent's instructions (up to 64 KiB)",
  "modelRouteId": "Model route the agent runs through (see: w6w model-routes list)",
  "skills": 'Pinned skill versions, as a JSON array of {"skillId":"…","skillVersionId":"…"}',
  "context":
    'Pinned context versions, as a JSON array of {"collectionId":"…","entryId":"…","assetVersionId":"…"}',
  "name": "Display name",
  "context.create.visibility": "Who can see the collection: private | project | account",
  "modelOptions.temperature": "Sampling temperature, 0 to 2",
  "modelOptions.topP": "Nucleus sampling, 0 to 1",
  "modelOptions.maxOutputTokens": "Cap on generated tokens (integer, 1 to 1000000)",
  "modelOptions.stop": "Stop sequence; repeat the flag for more (at most 4)",
  "assets.upload.visibility": "Who can see the uploaded context: private | project | account",
  "agents.create.visibility": "Who can see the agent: private | project | account",
  "agents.update.visibility": "Who can see the agent: private | project | account",
  "agents.update.ifUnmodifiedSince":
    "Refuse the write if the agent changed since this updatedAt (see: w6w agents get); the server requires it",
  "context.entries.update.ifUnmodifiedSince":
    "Refuse the write if the entry changed since this updatedAt (see: w6w context entries-list); the server requires it",
  "contextEntries.list.collectionId": "Only entries that are members of this collection id",
  "contextEntries.create.collectionIds":
    "Make the entry a member of this collection id (comma-separate several)",
  "contextEntries.create.visibility": "Who can see the entry: private | project | account",
  "contextEntries.create.name": "Entry name",
  "contextEntries.get.id": "Context entry id (see: w6w context-entries list)",
  "contextEntries.update.id": "Context entry id (see: w6w context-entries list)",
  "contextEntries.archive.id": "Context entry id (see: w6w context-entries list)",
  "contextEntries.addToCollection.id": "Context entry id (see: w6w context-entries list)",
  "contextEntries.removeFromCollection.id": "Context entry id (see: w6w context-entries list)",
  "contextEntries.addToCollection.collectionId": "Context collection id (see: w6w context list)",
  "contextEntries.removeFromCollection.collectionId":
    "Context collection id (see: w6w context list)",
  "contextEntries.update.ifUnmodifiedSince":
    "Refuse the write if the entry changed since this updatedAt (see: w6w context-entries get); the server requires it",
  "context.create.name": "Collection name",
  "context.update.name": "New collection name",
  "definition": "The whole definition, as a JSON object",
  "ifUnmodifiedSince":
    "Refuse the write if the workflow changed since this updatedAt (see: w6w workflows get)",
  "connections.get.id": "Connection id (see: w6w connections list)",
  "connections.delete.id": "Connection id (see: w6w connections list)",
  "connections.delete.force":
    "Delete even if Functions/Endpoints still use it; they are disabled, not edited",
  "apps.byIds.ids": "Comma-separated app ids (e.g. sendgrid,slack); duplicates are dropped",
  "dashboard.stats.from": "Start of the window, ISO-8601 (default: the server's)",
  "dashboard.stats.to": "End of the window, ISO-8601 (default: the server's)",
  "dashboard.stats.bucket": "Series bucket: day|week (default: the server's)",
  "reliability.list.project": "Project id (see: w6w projects list)",
  "reliability.list.apps": "Comma-separated app ids, at most 10 (e.g. sendgrid,slack)",
  "reliability.list.days": "Window length in days, a positive integer",
  "reliability.list.limit": "Maximum services to return, a positive integer",
  "reliability.members.project": "Project id (see: w6w projects list)",
  "reliability.members.days": "Window length in days, a positive integer",
  "allowUnpublished": "Run the saved draft even if it was never published (sent only when given)",
  "n": "Version number (see: w6w <workflows|functions> versions <id>)",
  "workflows.listVersions.id": "Workflow id (see: w6w workflows list)",
  "workflows.getVersion.id": "Workflow id (see: w6w workflows list)",
  "workflows.publish.id": "Workflow id (see: w6w workflows list)",
  "workflows.revert.id": "Workflow id (see: w6w workflows list)",
  "workflows.enable.id": "Workflow id (see: w6w workflows list)",
  "workflows.disable.id": "Workflow id (see: w6w workflows list)",
  "workflows.runVersion.id": "Workflow id (see: w6w workflows list)",
  "workflows.runVersion.wait": "Wait for the run to reach a terminal state",
  "workflows.runVersion.variables": "Set a run variable (repeatable)",
  "workflows.runVersion.trigger": "Trigger payload, as a JSON string",
  "workflows.runVersion.input": "Run input, as a JSON string",
  "functions.archive.id": "Function id or key (see: w6w functions list)",
  "functions.listVersions.id": "Function id or key (see: w6w functions list)",
  "functions.getVersion.id": "Function id or key (see: w6w functions list)",
  "functions.publish.id": "Function id or key (see: w6w functions list)",
  "functions.revert.id": "Function id or key (see: w6w functions list)",
  "functions.enable.id": "Function id or key (see: w6w functions list)",
  "functions.disable.id": "Function id or key (see: w6w functions list)",
  "functions.runVersion.id": "Function id or key (see: w6w functions list)",
  "functions.runVersion.inputs": "The Function's inputs, as a JSON object",
  "workflows.get.id": "Workflow id (see: w6w workflows list)",
  "workflows.update.id": "Workflow id (see: w6w workflows list)",
  "workflows.cancel.id": "Run id (see: w6w workflows run)",
  "workflows.archive.id": "Workflow id (see: w6w workflows list)",
  "workflows.delete.id": "Workflow id (see: w6w workflows list)",
  "functions.get.id": "Function id or key (see: w6w functions list)",
  "functions.update.id": "Function id or key (see: w6w functions list)",
  "functions.delete.id": "Function id or key (see: w6w functions list)",
  "run.urn":
    "conn_… | wf_… | fn_… | ep_… | an alias name (see: w6w connections list, w6w workflows list)",
  "run.action": "Action to invoke (connection URNs only)",
  "run.payload": "Input object, as a JSON string",

  // Team management. `role` and `id`/`userId` are ambiguous across the group's
  // own commands, so every one is keyed per-operation rather than falling back
  // to a bare name.
  "team.invites.create.email": "Address to invite (omit for an open, shareable invite link)",
  "team.invites.create.role": "Role to grant on redemption (default: member)",
  "team.invites.revoke.id": "Invite id (see: w6w team invites)",
  "team.members.updateRole.userId": "Member's user id (see: w6w team members)",
  "team.members.updateRole.role": "Role to set: member|admin (owner is not settable)",
  "team.members.remove.userId": "Member's user id (see: w6w team members)",
};

/**
 * Contract parameters whose handler never reads them, so the help must not show
 * them (wiring them is a follow-up, not a help edit). Keyed `<operation>.<param>`.
 * Exported so `tests/help_test.ts` can exempt exactly this set and nothing wider.
 */
export const HIDDEN_PARAMS: ReadonlySet<string> = new Set([
  "workflows.run.variables",
  "workflows.run.trigger",
  "workflows.runVersion.variables",
  "workflows.runVersion.trigger",
]);

/**
 * Positional arguments the handler names differently from the contract's
 * parameter: `functions run <name>` takes a key OR an id in one slot, while the
 * contract calls it `idOrKey`. Positional detection matches by NAME, so without
 * this the parameter degrades to `--id-or-key <value>`.
 */
export const POSITIONAL_ALIASES: Readonly<Record<string, string>> = {
  "functions.run.idOrKey": "name",
  "endpoints.run.idOrKey": "name",
};

/**
 * CLI spellings that differ from the contract's parameter name.
 */
const FLAG_OVERRIDES: Record<string, { flag: string; placeholder: string | null }> = {
  "assets.uploads.putEntry.body": { flag: "--file", placeholder: "<path>" },
  // Kebab-case, so the flag reads like every other one; the contract's own
  // parameter name is camelCase because that is the HEADER it maps to. Without
  // this entry the two spellings do not match and the placeholder silently
  // degrades to `<value>`.
  "functions.runVersion.inputs": { flag: "--payload", placeholder: "<json>" },
  // The handler (`src/commands/named-run.ts`) reads `--payload` and hands it to
  // the contract's `inputs` / `input` body field.
  "functions.run.inputs": { flag: "--payload", placeholder: "<json>" },
  "endpoints.run.input": { flag: "--payload", placeholder: "<json>" },
  // Singular, as the contract's `naming.cli` spells it; the handler splits a comma list.
  "contextEntries.create.collectionIds": { flag: "--collection-id", placeholder: "<id>" },
  "workflows.update.ifUnmodifiedSince": {
    flag: "--if-unmodified-since",
    placeholder: "<ts>",
  },
  "functions.update.ifUnmodifiedSince": {
    flag: "--if-unmodified-since",
    placeholder: "<ts>",
  },
};

/** The CLI flags `modelOptions` expands to: member, flag, placeholder. */
const MODEL_OPTION_FLAGS: readonly (readonly [string, string, string])[] = [
  ["temperature", "--temperature", "<n>"],
  ["topP", "--top-p", "<n>"],
  ["maxOutputTokens", "--max-output-tokens", "<n>"],
  ["stop", "--stop", "<text>"],
];

/** Descriptions and value placeholders for the contract's global flags. */
const GLOBAL_FLAG_HELP: Record<string, { placeholder: string | null; description: string }> = {
  "--base-url": { placeholder: "<url>", description: "API base URL (default: https://api.w6w.io)" },
  "--token": { placeholder: "<token>", description: "API token (or save one: w6w auth login)" },
  "--json": { placeholder: null, description: "Output raw JSON instead of a table" },
  "--no-color": { placeholder: null, description: "Disable colored output" },
  "--version": { placeholder: null, description: "Print the CLI version" },
  "--help": { placeholder: null, description: "Show help for any command" },
};

/** Names for the contract's numeric exit codes, so the runtime can refer to them. */
const EXIT_CODE_NAMES: Record<string, string> = {
  "0": "SUCCESS",
  "1": "USAGE",
  "2": "API_ERROR",
  "3": "RUN_FAILURE",
};

/** `--json` is a global flag, but `docs/cli.md` lists it in every command's OPTIONS. */
const JSON_FLAG_NAME = "--json";

// ---------------------------------------------------------------------------
// The tree the runtime consumes. These interfaces are emitted into the generated
// module verbatim, so `src/help.ts` can import them from there.
// ---------------------------------------------------------------------------

const TREE_TYPES = `/** One argument or flag of a command, ready to render. */
export interface HelpParam {
  /** The contract's parameter name. */
  name: string;
  /** \`argument\` renders under ARGUMENTS, \`flag\` under OPTIONS. */
  kind: "argument" | "flag";
  /** What the help line shows, e.g. \`<id>\` or \`--format <f>\`. */
  display: string;
  description: string;
  required: boolean;
}

/** One of the CLI's global flags. */
export interface HelpGlobalFlag {
  name: string;
  alias: string | null;
  type: string;
  env: string | null;
  /** What the help line shows, e.g. \`-v, --version\`. */
  display: string;
  description: string;
}

/** One runnable command — a leaf of the tree. */
export interface HelpCommand {
  /** The contract operation this command implements, e.g. \`documents.create\`. */
  operation: string;
  /** The command path below the binary, e.g. \`["documents", "create"]\`. */
  path: string[];
  name: string;
  /** Alternative paths that resolve to this same command. */
  aliases: string[][];
  /** The contract's summary, verbatim. */
  summary: string;
  /** The summary as it appears in a one-line COMMANDS listing. */
  short: string;
  /** The summary as it appears after the em dash in the command's own help. */
  headline: string;
  usage: string;
  /** The contract's \`naming.cli\` spelling, verbatim. */
  naming: string;
  /** The contract's \`status\` — server readiness, not wrapper completeness. */
  status: string;
  params: HelpParam[];
  examples: string[];
  notes: string[];
}

/** A group of commands, e.g. \`w6w documents\`. Groups are never runnable. */
export interface HelpGroup {
  name: string;
  summary: string;
  headline: string;
  usage: string;
  commands: HelpCommand[];
  /** Flags every command in the group accepts. */
  options: HelpParam[];
  examples: string[];
}

/** The whole command tree. */
export interface HelpTree {
  binary: string;
  contractVersion: string;
  tagline: string;
  usage: string;
  docsUrl: string;
  /** Commands that sit at the root because they have no siblings. */
  commands: HelpCommand[];
  groups: HelpGroup[];
  globalFlags: HelpGlobalFlag[];
  examples: string[];
}

/** One entry of the exit-code contract. */
export interface HelpExitCode {
  code: number;
  name: string;
  meaning: string;
}`;

// ---------------------------------------------------------------------------
// Contract → tree.
// ---------------------------------------------------------------------------

/** Where the shared contract lives, relative to THIS module — never to the cwd. */
export const CONTRACT_URL: URL = new URL("../../endpoints.json", import.meta.url);

/** Where the generated module is written, relative to THIS module. */
export const GENERATED_URL: URL = new URL("../src/help.generated.ts", import.meta.url);

/** This repo's formatter configuration, so the render is formatted cwd-independently. */
export const CONFIG_URL: URL = new URL("../deno.json", import.meta.url);

/** Reads and parses the shared contract, failing loudly with the path it tried. */
export async function loadContract(url: URL = CONTRACT_URL): Promise<Contract> {
  let text: string;
  try {
    text = await Deno.readTextFile(url);
  } catch (err) {
    throw new Error(
      `gen-help: the shared wrapper contract was not found at ${url.pathname}. ` +
        "It is expected beside this repo — `../endpoints.json` from the repo root, where the " +
        "three wrapper repos sit as siblings — and is read as `../../endpoints.json` from " +
        "scripts/gen-help.ts. There is deliberately no vendored copy to fall back to: a stale " +
        "pinned copy would defeat the whole mechanism. " +
        `(${err instanceof Error ? err.message : String(err)})`,
    );
  }
  return JSON.parse(text) as Contract;
}

/**
 * The command path a `naming.cli` string declares.
 *
 * Pinned by `docs/implementation.md` §10: drop the leading binary, then take
 * tokens up to (not including) the first token starting with `<`, `[` or `--`.
 * `w6w documents get-by-key <key> [--project <id>]` → `["documents", "get-by-key"]`.
 */
export function commandPathOf(naming: string): string[] {
  const tokens = naming.trim().split(/\s+/).slice(1);
  const path: string[] = [];
  for (const token of tokens) {
    if (token.startsWith("<") || token.startsWith("[") || token.startsWith("--")) break;
    path.push(token);
  }
  // `ls` is the parser's subcommand alias for `list` (args.ts SUBCOMMAND_ALIASES): the
  // dispatcher rewrites it before matching, so a contract spelling `<group> ls` must be
  // registered under its canonical `list` path or it is unreachable.
  if (path.length > 1 && path[path.length - 1] === "ls") path[path.length - 1] = "list";
  return path;
}

interface NamingSurface {
  positionals: Set<string>;
  flags: Map<string, string | null>;
}

/**
 * What the contract's own CLI spelling says about a command's tail: which
 * parameters are positional arguments, and what placeholder each flag shows.
 * This is why `documents create <key> --content <text>` renders `key` as an
 * argument even though the contract carries it `in: "body"`.
 */
function namingSurface(naming: string, pathLength: number): NamingSurface {
  const tokens = naming.trim().split(/\s+/).slice(1 + pathLength);
  const bare = (t: string) => t.replace(/^\[+/, "").replace(/\]+$/, "");
  const positionals = new Set<string>();
  const flags = new Map<string, string | null>();
  for (let i = 0; i < tokens.length; i++) {
    const token = bare(tokens[i]);
    if (token.startsWith("--")) {
      const next = i + 1 < tokens.length ? bare(tokens[i + 1]) : "";
      if (/^<.+>$/.test(next)) {
        flags.set(token.slice(2), next);
        i++;
      } else {
        flags.set(token.slice(2), null);
      }
    } else {
      const match = /^<(.+)>$/.exec(token);
      if (match) positionals.add(match[1]);
    }
  }
  return { positionals, flags };
}

function describeParam(operation: string, param: string): string {
  const description = PARAM_HELP[`${operation}.${param}`] ?? PARAM_HELP[param];
  if (!description) {
    throw new Error(
      `gen-help: no help text for parameter \`${param}\` of operation \`${operation}\`. ` +
        "Add an entry to PARAM_HELP in scripts/gen-help.ts (keyed " +
        `\`${operation}.${param}\` or \`${param}\`) and re-run \`deno task gen:help\`.`,
    );
  }
  return description;
}

function kebab(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

/** A summary as it reads after the em dash: no capital, no trailing period. */
function headlineOf(summary: string): string {
  const trimmed = summary.trim().replace(/\.$/, "");
  return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
}

/**
 * A summary as it reads in a one-line COMMANDS listing: no trailing period, and
 * cut at the em dash where the contract's summary elaborates after one
 * (`run` — "Run anything addressable by URN — a connection action, …"). The full
 * text still leads that command's own help.
 */
function shortSummaryOf(summary: string): string {
  return summary.trim().replace(/\.$/, "").split(" — ")[0];
}

interface BuiltParams {
  params: unknown[];
  usageTail: string;
}

function buildParams(
  operation: ContractOperation,
  path: string[],
  jsonFlag: { display: string; description: string },
): BuiltParams {
  const surface = namingSurface(operation.naming.cli, path.length);
  const params: {
    name: string;
    kind: "argument" | "flag";
    display: string;
    description: string;
    required: boolean;
  }[] = [];
  const usageParts: string[] = [];

  for (const param of operation.params) {
    const key = `${operation.name}.${param.name}`;
    if (HIDDEN_PARAMS.has(key)) continue;
    // The contract carries one `modelOptions` object; the CLI spells its members as flags.
    if (param.name === "modelOptions") {
      for (const [member, flag, placeholder] of MODEL_OPTION_FLAGS) {
        params.push({
          name: member,
          kind: "flag",
          display: `${flag} ${placeholder}`,
          description: PARAM_HELP[`modelOptions.${member}`],
          required: false,
        });
      }
      continue;
    }
    const override = FLAG_OVERRIDES[key];
    const description = describeParam(operation.name, param.name);
    const positional = POSITIONAL_ALIASES[key] ?? param.name;
    if (!override && surface.positionals.has(positional)) {
      params.push({
        name: param.name,
        kind: "argument",
        display: `<${positional}>`,
        description,
        required: param.required,
      });
      usageParts.push(param.required ? `<${positional}>` : `[<${positional}>]`);
      continue;
    }
    const flag = override?.flag ?? `--${kebab(param.name)}`;
    const placeholder = override
      ? override.placeholder
      : surface.flags.get(param.name) ?? (param.type === "boolean" ? null : "<value>");
    params.push({
      name: param.name,
      kind: "flag",
      display: placeholder ? `${flag} ${placeholder}` : flag,
      description,
      required: param.required,
    });
    if (param.required) usageParts.push(placeholder ? `${flag} ${placeholder}` : flag);
  }

  // `--json` is global, but every command's OPTIONS lists it (docs/cli.md).
  params.push({
    name: "json",
    kind: "flag",
    display: jsonFlag.display,
    description: jsonFlag.description,
    required: false,
  });
  usageParts.push("[options]");

  return { params, usageTail: usageParts.join(" ") };
}

/** Builds the whole command tree from the contract. */
export function buildHelpTree(contract: Contract): Record<string, unknown> {
  const binary = contract.cli.binary;

  const globalFlags = contract.cli.globalFlags.map((flag) => {
    const prose = GLOBAL_FLAG_HELP[flag.name];
    if (!prose) {
      throw new Error(
        `gen-help: no help text for global flag \`${flag.name}\`. Add an entry to ` +
          "GLOBAL_FLAG_HELP in scripts/gen-help.ts and re-run `deno task gen:help`.",
      );
    }
    const label = flag.alias ? `${flag.alias}, ${flag.name}` : flag.name;
    return {
      name: flag.name,
      alias: flag.alias ?? null,
      type: flag.type,
      env: flag.env ?? null,
      display: prose.placeholder ? `${label} ${prose.placeholder}` : label,
      description: flag.env ? `${prose.description} (env: ${flag.env})` : prose.description,
    };
  });

  const jsonGlobal = globalFlags.find((f) => f.name === JSON_FLAG_NAME);
  if (!jsonGlobal) {
    throw new Error(`gen-help: the contract's global flags no longer include ${JSON_FLAG_NAME}.`);
  }
  const jsonFlag = { display: jsonGlobal.display, description: jsonGlobal.description };

  const rootCommands: Record<string, unknown>[] = [];
  const groups = new Map<string, Record<string, unknown>>();

  // CLI-only commands (`cli.commands[]`) go through the same builder as an API
  // operation: they carry a naming string and params, and no method or path.
  const cliOnly: ContractOperation[] = (contract.cli.commands ?? []).map((command) => ({
    name: command.name,
    summary: command.summary,
    method: "",
    path: "",
    status: command.status,
    params: command.params,
    naming: { ts: "", python: "", cli: command.naming },
  }));

  for (const operation of [...contract.operations, ...cliOnly]) {
    const path = commandPathOf(operation.naming.cli);
    if (path.length === 0 || path.length > 2) {
      throw new Error(
        `gen-help: operation \`${operation.name}\` has a CLI naming this generator cannot ` +
          `place: \`${operation.naming.cli}\` (expected one or two command tokens).`,
      );
    }
    const { params, usageTail } = buildParams(operation, path, jsonFlag);
    const aliases = operation.cliAlias ? [commandPathOf(operation.cliAlias)] : [];
    const notes = [...(COMMAND_NOTES[operation.name] ?? [])];
    if (operation.status === "planned") {
      notes.push(
        `This operation is "planned": it is implemented here, but the server route is not live ` +
          "yet, so calling it against a server today returns 404.",
      );
    }
    const examples = COMMAND_EXAMPLES[operation.name];
    if (!examples || examples.length === 0) {
      throw new Error(
        `gen-help: no example for operation \`${operation.name}\`. Every command's help shows at ` +
          "least one runnable example — add one to COMMAND_EXAMPLES in scripts/gen-help.ts.",
      );
    }
    const command = {
      operation: operation.name,
      path,
      name: path[path.length - 1],
      aliases,
      summary: operation.summary,
      short: shortSummaryOf(operation.summary),
      headline: headlineOf(operation.summary),
      usage: `${binary} ${path.join(" ")} ${usageTail}`.trim(),
      naming: operation.naming.cli,
      status: operation.status,
      params,
      examples,
      notes,
    };

    if (path.length === 1) {
      rootCommands.push(command);
      continue;
    }
    const groupName = path[0];
    let group = groups.get(groupName);
    if (!group) {
      const summary = GROUP_SUMMARIES[groupName];
      if (!summary) {
        throw new Error(
          `gen-help: no summary for command group \`${groupName}\`. Add an entry to ` +
            "GROUP_SUMMARIES in scripts/gen-help.ts and re-run `deno task gen:help`.",
        );
      }
      group = {
        name: groupName,
        summary,
        headline: headlineOf(summary),
        usage: `${binary} ${groupName} <command> [options]`,
        commands: [],
        options: [],
        examples: GROUP_EXAMPLES[groupName] ?? [],
      };
      groups.set(groupName, group);
    }
    (group.commands as unknown[]).push(command);
  }

  // A group's OPTIONS block lists only what EVERY command in it accepts — which
  // is how `documents` gets `--project` and `vars` deliberately gets nothing.
  for (const group of groups.values()) {
    const commands = group.commands as { params: { name: string; kind: string }[] }[];
    const first = commands[0];
    const shared = first.params.filter((param) =>
      param.kind === "flag" && param.name !== "json" &&
      commands.every((c) => c.params.some((p) => p.name === param.name && p.kind === "flag"))
    );
    group.options = shared;
  }

  return {
    binary,
    contractVersion: contract.contractVersion,
    tagline: TAGLINE,
    usage: `${binary} <command> [options]`,
    docsUrl: DOCS_URL,
    commands: rootCommands,
    groups: [...groups.values()],
    globalFlags,
    examples: ROOT_EXAMPLES,
  };
}

/** Every command path the parser may match, aliases included. */
export function buildCommandPaths(tree: Record<string, unknown>): string[][] {
  const paths: string[][] = [];
  for (const command of tree.commands as { path: string[]; aliases: string[][] }[]) {
    paths.push(command.path, ...command.aliases);
  }
  for (const group of tree.groups as { commands: { path: string[]; aliases: string[][] }[] }[]) {
    for (const command of group.commands) paths.push(command.path, ...command.aliases);
  }
  return paths;
}

/** The exit-code contract, as named constants the runtime can refer to. */
export function buildExitCodes(
  contract: Contract,
): { code: number; name: string; meaning: string }[] {
  return Object.entries(contract.cli.exitCodes).map(([code, meaning]) => {
    const name = EXIT_CODE_NAMES[code];
    if (!name) {
      throw new Error(
        `gen-help: exit code ${code} has no name. Add one to EXIT_CODE_NAMES in ` +
          "scripts/gen-help.ts and re-run `deno task gen:help`.",
      );
    }
    return { code: Number(code), name, meaning };
  });
}

// ---------------------------------------------------------------------------
// Tree → module text. Pure: this is what the freshness test re-runs.
// ---------------------------------------------------------------------------

const HEADER = `// AUTOGENERATED — DO NOT EDIT BY HAND.
//
// Written by \`scripts/gen-help.ts\` from the shared wrapper surface contract, the
// same machine-readable file all three w6w wrappers implement. Regenerate with:
//
//     deno task gen:help
//
// Edits made here are lost on the next run, and \`tests/help_test.ts\` compares this
// file byte-for-byte against a fresh render — so a contract change that was not
// regenerated fails the suite instead of shipping stale help. The render is passed
// through \`deno fmt\` with this repo's own configuration, which is why the file
// satisfies \`deno task fmt:check\` like any hand-written module.
//
// Generation happens at development time on purpose: an installed \`@w6w/cli\` has
// no contract file beside it to read, so a runtime read would work in development
// and break for every user. Nothing under \`src/\` opens a JSON file.`;

/** Renders the whole generated module. Pure — no I/O, same input, same bytes. */
export function renderHelpModule(contract: Contract): string {
  const tree = buildHelpTree(contract);
  const exitCodes = buildExitCodes(contract);
  const json = (value: unknown) => JSON.stringify(value, null, 2);

  const exitConstants = exitCodes
    .map((entry) => `export const EXIT_${entry.name}: number = ${entry.code};`)
    .join("\n");

  return [
    HEADER,
    TREE_TYPES,
    `/** The command tree, generated from the shared wrapper surface contract. */
export const HELP_TREE: HelpTree = ${json(tree)};`,
    `/** Every command path the parser may match, aliases included. */
export const COMMAND_PATHS: string[][] = ${json(buildCommandPaths(tree))};`,
    `/** The exit-code contract, verbatim from the shared contract's \`cli.exitCodes\`. */
export const EXIT_CODES: HelpExitCode[] = ${json(exitCodes)};`,
    exitConstants,
    `/** The global flags, lifted out of the tree for the argument parser. */
export const GLOBAL_FLAGS: HelpGlobalFlag[] = HELP_TREE.globalFlags;`,
  ].join("\n\n") + "\n";
}

/**
 * Runs a rendered module through `deno fmt`, with this repo's own configuration.
 *
 * The generated file is a normal source file: it is typechecked, linted and
 * format-checked with everything else, so the generator formats rather than
 * carving the file out of the `fmt` gate. `deno fmt` is idempotent, so
 * `format(render(contract))` is as deterministic as `render` itself — which is
 * what lets the freshness test compare bytes.
 */
export async function formatModule(source: string): Promise<string> {
  const command = new Deno.Command(Deno.execPath(), {
    args: ["fmt", "-", "--ext", "ts", "--config", decodeURIComponent(CONFIG_URL.pathname)],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  });
  const child = command.spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(source));
  await writer.close();
  const { code, stdout, stderr } = await child.output();
  if (code !== 0) {
    throw new Error(`gen-help: deno fmt failed (${code}): ${new TextDecoder().decode(stderr)}`);
  }
  return new TextDecoder().decode(stdout);
}

// ---------------------------------------------------------------------------
// Entry point.
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const contract = await loadContract();
  const rendered = await formatModule(renderHelpModule(contract));
  await Deno.writeTextFile(GENERATED_URL, rendered);
  console.log(`gen-help: wrote ${GENERATED_URL.pathname} (${rendered.length} bytes)`);
}

if (import.meta.main) {
  await main();
}
