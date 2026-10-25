/**
 * `w6w skills|context|agents …` — the agent-authoring surface at the command line.
 *
 * Seventeen commands, **one SDK call each**. Skill upload is deliberately not
 * here: it is `w6w assets upload --purpose skill`.
 *
 * Two write paths carry optimistic concurrency — `agents update` and
 * `context entries-update`. Both send the body `revision` and, when given, the
 * `--if-unmodified-since` precondition. A `409` is re-thrown as an `ApiError`
 * with a message naming the **current revision** and what to do next; a `428`
 * says the precondition is required. Both keep their status, so the exit code is
 * the API-error code and a script can tell the write was refused. A uniform
 * `404` needs no handling at all: `main()` prints the server's one-line message
 * and exits, never a stack trace.
 *
 * Only flags the user typed reach the wire, so an omitted `--description` leaves
 * the field alone and `--description ""` clears it.
 *
 * @module
 */

import type { CommandContext, CommandHandler, CommandRegistry } from "../../mod.ts";
import { ApiError, type W6WClient } from "@w6w/sdk";
import { argument, noExtraArguments, requiredFlag, table, textFlag, usageError } from "./shared.ts";

// The SDK barrel does not re-export the agent-studio model types, so they are
// derived from the client's own method signatures: they cannot drift from it.
type Client = W6WClient;
type Skill = Awaited<ReturnType<Client["skills"]["get"]>>;
type SkillVersion = Awaited<ReturnType<Client["skills"]["versions"]>>[number];
type ContextCollection = Awaited<ReturnType<Client["context"]["get"]>>;
type ContextEntry = Awaited<ReturnType<Client["context"]["entries"]["list"]>>[number];
type Agent = Awaited<ReturnType<Client["agents"]["get"]>>;
type CreateAgentInput = NonNullable<Parameters<Client["agents"]["create"]>[0]>;
type UpdateAgentInput = Parameters<Client["agents"]["update"]>[1];
type SkillPin = NonNullable<CreateAgentInput["skills"]>[number];
type ContextPin = NonNullable<CreateAgentInput["context"]>[number];

/** A positive-integer flag, or `undefined` when absent. */
function count(context: CommandContext, name: string): number | undefined {
  const value = textFlag(context, name);
  if (value === undefined) return undefined;
  if (!/^[0-9]+$/.test(value) || Number(value) < 1) {
    throw usageError(context, `\`--${name}\` must be a positive integer.`);
  }
  return Number(value);
}

/** A non-negative integer flag that must be present (a revision may be `0`). */
function revision(context: CommandContext): number {
  const value = requiredFlag(context, "revision", "--revision <n>");
  if (!/^[0-9]+$/.test(value)) {
    throw usageError(context, "`--revision` must be a non-negative integer.");
  }
  return Number(value);
}

function includeArchived(context: CommandContext): { includeArchived?: boolean } {
  return context.invocation.options.includeArchived === true ? { includeArchived: true } : {};
}

function tags(context: CommandContext): string[] | undefined {
  const value = textFlag(context, "tags");
  if (value === undefined) return undefined;
  return value.split(",").map((t) => t.trim()).filter((t) => t.length > 0);
}

/** A flag whose value is a JSON array of pins. */
function jsonList<T>(context: CommandContext, name: string): T[] | undefined {
  const value = textFlag(context, name);
  if (value === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw usageError(context, `\`--${name}\` must be valid JSON (an array).`);
  }
  if (!Array.isArray(parsed)) throw usageError(context, `\`--${name}\` must be a JSON array.`);
  return parsed as T[];
}

function visibility(context: CommandContext): "private" | "project" | "account" | undefined {
  const value = textFlag(context, "visibility");
  if (value === undefined) return undefined;
  if (value !== "private" && value !== "project" && value !== "account") {
    throw usageError(context, "`--visibility` must be private, project or account.");
  }
  return value;
}

const cell = (value: unknown): string =>
  value === null || value === undefined || value === "" ? "-" : String(value);

/**
 * Run a precondition write, turning a 409 / 428 into an actionable message.
 *
 * The thrown error is still an `ApiError` with the original status, code and
 * body, so the exit code and `--json` consumers are unchanged; only the sentence
 * a human reads is replaced.
 */
async function guarded<T>(what: string, refetch: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      const current = (err.raw as { error?: { currentRevision?: number } } | null)?.error
        ?.currentRevision;
      const at = current === undefined ? "" : ` (current revision: ${current})`;
      throw new ApiError(
        409,
        err.code,
        `Conflict: ${what} changed since you read it${at}. ` +
          `Re-read it with \`${refetch}\` and retry with the new revision.`,
        err.raw,
      );
    }
    if (err instanceof ApiError && err.status === 428) {
      throw new ApiError(
        428,
        err.code,
        `Precondition required: ${what} can only be updated with a precondition. ` +
          `Pass \`--if-unmodified-since <ts>\` (the updatedAt you read).`,
        err.raw,
      );
    }
    throw err;
  }
}

const precondition = (context: CommandContext) => ({
  ifUnmodifiedSince: textFlag(context, "ifUnmodifiedSince"),
});

// ---------------------------------------------------------------- skills

const skillRow = (s: Skill) => [s.id, s.name, cell(s.activeVersionId), cell(s.archivedAt)];

const skillsList: CommandHandler = async (context) => {
  noExtraArguments(context, 0);
  const rows = await context.client().skills.list({
    ...includeArchived(context),
    limit: count(context, "limit"),
  });
  context.out.emit(
    rows,
    (styles) =>
      rows.length === 0
        ? styles.dim("No skills.")
        : table(["ID", "NAME", "ACTIVE VERSION", "ARCHIVED"], rows.map(skillRow), styles),
  );
};

const skillsGet: CommandHandler = async (context) => {
  const id = argument(context, 0, "a skill id (see: `w6w skills list`)");
  noExtraArguments(context, 1);
  const skill = await context.client().skills.get(id);
  context.out.emit(
    skill,
    (styles) => table(["ID", "NAME", "ACTIVE VERSION", "ARCHIVED"], [skillRow(skill)], styles),
  );
};

const skillsVersions: CommandHandler = async (context) => {
  const id = argument(context, 0, "a skill id (see: `w6w skills list`)");
  noExtraArguments(context, 1);
  const rows = await context.client().skills.versions(id);
  const row = (v: SkillVersion) => {
    const r = v as unknown as Record<string, unknown>;
    return [cell(r.id), cell(r.version), cell(r.createdAt)];
  };
  context.out.emit(
    rows,
    (styles) =>
      rows.length === 0
        ? styles.dim("No versions.")
        : table(["ID", "VERSION", "CREATED"], rows.map(row), styles),
  );
};

const skillsArchive: CommandHandler = async (context) => {
  const id = argument(context, 0, "a skill id (see: `w6w skills list`)");
  noExtraArguments(context, 1);
  const skill = await context.client().skills.archive(id);
  context.out.emit(
    skill,
    (styles) => `Archived ${styles.bold(skill.name)} ${styles.dim(`(${id})`)}`,
  );
};

// --------------------------------------------------------------- context

const collectionRow = (c: ContextCollection) => [
  c.id,
  c.name,
  c.tags.join(",") || "-",
  c.visibility,
  cell(c.archivedAt),
];
const COLLECTION_HEAD = ["ID", "NAME", "TAGS", "VISIBILITY", "ARCHIVED"];

const contextList: CommandHandler = async (context) => {
  noExtraArguments(context, 0);
  const rows = await context.client().context.list({
    ...includeArchived(context),
    limit: count(context, "limit"),
  });
  context.out.emit(
    rows,
    (styles) =>
      rows.length === 0
        ? styles.dim("No context collections.")
        : table(COLLECTION_HEAD, rows.map(collectionRow), styles),
  );
};

const contextCreate: CommandHandler = async (context) => {
  const name = argument(context, 0, "a collection name");
  noExtraArguments(context, 1);
  const created = await context.client().context.create({
    name,
    description: textFlag(context, "description"),
    tags: tags(context),
    visibility: visibility(context),
  });
  context.out.emit(
    created,
    (styles) => `Created ${styles.bold(created.name)} ${styles.dim(`(${created.id})`)}`,
  );
};

const contextGet: CommandHandler = async (context) => {
  const id = argument(context, 0, "a collection id (see: `w6w context list`)");
  noExtraArguments(context, 1);
  const found = await context.client().context.get(id);
  context.out.emit(found, (styles) => table(COLLECTION_HEAD, [collectionRow(found)], styles));
};

/** A patch: only the typed flags are sent (collection edits are last-write-wins). */
const contextUpdate: CommandHandler = async (context) => {
  const id = argument(context, 0, "a collection id (see: `w6w context list`)");
  noExtraArguments(context, 1);
  const patch: { name?: string; description?: string; tags?: string[] } = {};
  const name = textFlag(context, "name");
  if (name !== undefined) patch.name = name;
  const description = textFlag(context, "description");
  if (description !== undefined) patch.description = description;
  const tagList = tags(context);
  if (tagList !== undefined) patch.tags = tagList;
  const updated = await context.client().context.update(id, patch);
  context.out.emit(
    updated,
    (styles) => `Updated ${styles.bold(updated.name)} ${styles.dim(`(${id})`)}`,
  );
};

const contextArchive: CommandHandler = async (context) => {
  const id = argument(context, 0, "a collection id (see: `w6w context list`)");
  noExtraArguments(context, 1);
  const archived = await context.client().context.archive(id);
  context.out.emit(
    archived,
    (styles) => `Archived ${styles.bold(archived.name)} ${styles.dim(`(${id})`)}`,
  );
};

const entryRow = (e: ContextEntry & { revision?: number }) => [
  e.id,
  e.name,
  e.mediaType,
  cell(e.revision),
  cell(e.archivedAt),
];
const ENTRY_HEAD = ["ID", "NAME", "TYPE", "REVISION", "ARCHIVED"];

const entriesList: CommandHandler = async (context) => {
  const id = argument(context, 0, "a collection id (see: `w6w context list`)");
  noExtraArguments(context, 1);
  const rows = await context.client().context.entries.list(id, includeArchived(context));
  context.out.emit(
    rows,
    (styles) =>
      rows.length === 0 ? styles.dim("No entries.") : table(ENTRY_HEAD, rows.map(entryRow), styles),
  );
};

const entriesCreate: CommandHandler = async (context) => {
  const id = argument(context, 0, "a collection id (see: `w6w context list`)");
  const name = argument(context, 1, "an entry name");
  noExtraArguments(context, 2);
  const entry = await context.client().context.entries.create(id, {
    name,
    text: requiredFlag(context, "text", "--text <text>"),
  });
  context.out.emit(
    entry,
    (styles) =>
      `Created ${styles.bold(entry.name)} ${
        styles.dim(`(${entry.id}, revision ${entry.revision})`)
      }`,
  );
};

const entriesUpdate: CommandHandler = async (context) => {
  const id = argument(context, 0, "a collection id (see: `w6w context list`)");
  const entryId = argument(context, 1, "an entry id (see: `w6w context entries-list`)");
  noExtraArguments(context, 2);
  const text = requiredFlag(context, "text", "--text <text>");
  const rev = revision(context);
  const entry = await guarded(
    "the entry",
    `w6w context entries-list ${id}`,
    () =>
      context.client().context.entries.update(
        id,
        entryId,
        { text, revision: rev },
        precondition(context),
      ),
  );
  context.out.emit(
    entry,
    (styles) =>
      `Updated ${styles.bold(entry.name)} ${
        styles.dim(`(${entry.id}, revision ${entry.revision})`)
      }`,
  );
};

// ---------------------------------------------------------------- agents

const agentRow = (a: Agent) => [
  a.id,
  cell(a.name),
  cell(a.modelRouteId),
  String(a.revision),
  a.archived ? "yes" : "no",
  "no",
];
const AGENT_HEAD = ["ID", "NAME", "MODEL ROUTE", "REVISION", "ARCHIVED", "RUNNABLE"];

const agentsList: CommandHandler = async (context) => {
  noExtraArguments(context, 0);
  const rows = await context.client().agents.list(includeArchived(context));
  context.out.emit(
    rows,
    (styles) =>
      rows.length === 0 ? styles.dim("No agents.") : table(AGENT_HEAD, rows.map(agentRow), styles),
  );
};

/** The fields `agents create|update` share, only those typed. */
function agentFields(context: CommandContext): CreateAgentInput {
  const fields: CreateAgentInput = {};
  const name = textFlag(context, "name");
  if (name !== undefined) fields.name = name;
  const instructions = textFlag(context, "instructions");
  if (instructions !== undefined) fields.instructions = instructions;
  const route = textFlag(context, "modelRouteId");
  if (route !== undefined) fields.modelRouteId = route;
  const skills = jsonList<SkillPin>(context, "skills");
  if (skills !== undefined) fields.skills = skills;
  const pins = jsonList<ContextPin>(context, "context");
  if (pins !== undefined) fields.context = pins;
  const vis = visibility(context);
  if (vis !== undefined) fields.visibility = vis;
  const project = textFlag(context, "project");
  if (project !== undefined) fields.project = project;
  return fields;
}

const agentsCreate: CommandHandler = async (context) => {
  noExtraArguments(context, 0);
  const agent = await context.client().agents.create(agentFields(context));
  context.out.emit(
    agent,
    (styles) =>
      `Created ${styles.bold(cell(agent.name))} ${
        styles.dim(`(${agent.id}, revision ${agent.revision})`)
      }`,
  );
};

const agentsGet: CommandHandler = async (context) => {
  const id = argument(context, 0, "an agent id (see: `w6w agents list`)");
  noExtraArguments(context, 1);
  const agent = await context.client().agents.get(id);
  context.out.emit(agent, (styles) => {
    const issues = agent.validation.map((v) => `  ! ${JSON.stringify(v)}`);
    return [
      table(AGENT_HEAD, [agentRow(agent)], styles),
      ...(agent.instructions.length > 0 ? ["", agent.instructions] : []),
      ...(issues.length > 0 ? ["", "Validation:", ...issues] : []),
    ].join("\n");
  });
};

const agentsUpdate: CommandHandler = async (context) => {
  const id = argument(context, 0, "an agent id (see: `w6w agents list`)");
  noExtraArguments(context, 1);
  const patch: UpdateAgentInput = { ...agentFields(context), revision: revision(context) };
  const agent = await guarded(
    "the agent",
    `w6w agents get ${id}`,
    () => context.client().agents.update(id, patch, precondition(context)),
  );
  context.out.emit(
    agent,
    (styles) =>
      `Updated ${styles.bold(cell(agent.name))} ${
        styles.dim(`(${id}, revision ${agent.revision})`)
      }`,
  );
};

const agentsArchive: CommandHandler = async (context) => {
  const id = argument(context, 0, "an agent id (see: `w6w agents list`)");
  noExtraArguments(context, 1);
  const agent = await context.client().agents.archive(id);
  context.out.emit(
    agent,
    (styles) => `Archived ${styles.bold(cell(agent.name))} ${styles.dim(`(${id})`)}`,
  );
};

/** Keys are the help tree's command paths (`naming.cli`). */
export const AGENT_STUDIO_COMMANDS: CommandRegistry = {
  "skills list": skillsList,
  "skills get": skillsGet,
  "skills versions": skillsVersions,
  "skills archive": skillsArchive,
  "context list": contextList,
  "context create": contextCreate,
  "context get": contextGet,
  "context update": contextUpdate,
  "context archive": contextArchive,
  "context entries-list": entriesList,
  "context entries-create": entriesCreate,
  "context entries-update": entriesUpdate,
  "agents list": agentsList,
  "agents create": agentsCreate,
  "agents get": agentsGet,
  "agents update": agentsUpdate,
  "agents archive": agentsArchive,
};
