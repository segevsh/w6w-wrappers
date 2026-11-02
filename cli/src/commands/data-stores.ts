/**
 * `w6w data-stores …` — data stores and their entries, at the command line.
 *
 * Fourteen commands, **one SDK call each** (`client.dataStores.*`). The entry
 * verbs carry an `entry-` prefix (`entry-get`, `entry-set`, …) because the
 * command path is capped at two tokens (`src/args.ts`); a `data-stores entries
 * get` spelling would not resolve. Errors are not caught: `main()` reports a
 * throw once on stderr and maps it to an exit code, so an `ApiError` exits 2
 * (its `code` is on stderr, see {@linkcode withErrorCode}) and a usage error
 * exits 1 with **zero requests**.
 *
 * The CSV pair: `import <id> --file <path|->` sends the file (or stdin) as
 * `text/csv`; `export <id>` writes the CSV to stdout, or to `--out <path>`.
 *
 * @module
 */

import type { CommandHandler, CommandRegistry } from "../../mod.ts";
import { ApiError } from "@w6w/sdk";
import type { DataStoreKind, DataStoreOptions, DataStoreSchema } from "@w6w/sdk";
import type { CommandContext } from "../../mod.ts";
import { deliver, fs } from "./assets.ts";
import { argument, noExtraArguments, requiredFlag, textFlag, usageError } from "./shared.ts";

/** The project scope for one call: the `--project` flag, or nothing at all. */
function scope(context: CommandContext): DataStoreOptions {
  const project = textFlag(context, "project");
  return project === undefined ? {} : { project };
}

/** A non-negative integer flag, or `undefined` when absent. */
function intFlag(context: CommandContext, name: string, kebab: string): number | undefined {
  const value = textFlag(context, name);
  if (value === undefined) return undefined;
  if (!/^[0-9]+$/.test(value)) {
    throw usageError(context, `\`--${kebab}\` must be a non-negative integer.`);
  }
  return Number(value);
}

/** A JSON-valued flag, or `undefined` when absent; bad JSON is a usage error. */
function jsonFlag(context: CommandContext, name: string, kebab: string): unknown {
  const raw = textFlag(context, name);
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    throw usageError(context, `\`--${kebab}\` is not valid JSON.`);
  }
}

/** A JSON-valued flag that must be a JSON object. */
function objectFlag(
  context: CommandContext,
  name: string,
  kebab: string,
): Record<string, unknown> | undefined {
  const value = jsonFlag(context, name, kebab);
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw usageError(context, `\`--${kebab}\` must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function printJson(context: CommandContext, value: unknown): void {
  context.out.emit(value, () => JSON.stringify(value, null, 2));
}

const list: CommandHandler = async (context) => {
  noExtraArguments(context, 0);
  const kind = textFlag(context, "kind") as DataStoreKind | undefined;
  const cursor = textFlag(context, "cursor");
  const limit = intFlag(context, "limit", "limit");
  printJson(
    context,
    await context.client().dataStores.list({ kind, cursor, limit, ...scope(context) }),
  );
};

const get: CommandHandler = async (context) => {
  const id = argument(context, 0, "a data store id");
  noExtraArguments(context, 1);
  printJson(context, await context.client().dataStores.get(id, scope(context)));
};

const create: CommandHandler = async (context) => {
  const name = argument(context, 0, "a data store name");
  noExtraArguments(context, 1);
  const kind = requiredFlag(context, "kind", "--kind <kv|doc|table>") as DataStoreKind;
  const description = textFlag(context, "description");
  const schema = objectFlag(context, "schema", "schema") as DataStoreSchema | undefined;
  printJson(
    context,
    await context.client().dataStores.create({ kind, name, description, schema }, scope(context)),
  );
};

const update: CommandHandler = async (context) => {
  const id = argument(context, 0, "a data store id");
  noExtraArguments(context, 1);
  const schema = objectFlag(context, "schema", "schema") as DataStoreSchema | undefined;
  printJson(
    context,
    await context.client().dataStores.update(
      id,
      { name: textFlag(context, "name"), description: textFlag(context, "description"), schema },
      scope(context),
    ),
  );
};

const archive: CommandHandler = async (context) => {
  const id = argument(context, 0, "a data store id");
  noExtraArguments(context, 1);
  await context.client().dataStores.archive(id, scope(context));
  context.out.emit({ id, archived: true }, () => `Archived ${id}.`);
};

const importCsv: CommandHandler = async (context) => {
  const id = argument(context, 0, "a data store id");
  noExtraArguments(context, 1);
  const file = requiredFlag(context, "file", "--file <path>");
  let csv: string;
  if (file === "-") {
    csv = await context.stdin.read();
  } else {
    let bytes: Uint8Array;
    try {
      bytes = await (await fs()).readFile(file);
    } catch {
      throw usageError(context, `Cannot read \`${file}\`.`);
    }
    try {
      csv = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw usageError(context, `\`${file}\` is not valid UTF-8 text.`);
    }
  }
  const result = await context.client().dataStores.importCsv(id, csv, scope(context));
  context.out.emit(result, () => `Imported ${result.imported} row(s).`);
};

const exportCsv: CommandHandler = async (context) => {
  const id = argument(context, 0, "a data store id");
  noExtraArguments(context, 1);
  const csv = await context.client().dataStores.exportCsv(id, scope(context));
  await deliver(context, new TextEncoder().encode(csv));
};

const entryList: CommandHandler = async (context) => {
  const id = argument(context, 0, "a data store id");
  noExtraArguments(context, 1);
  printJson(
    context,
    await context.client().dataStores.entries.list(id, {
      prefix: textFlag(context, "prefix"),
      cursor: textFlag(context, "cursor"),
      limit: intFlag(context, "limit", "limit"),
      ...scope(context),
    }),
  );
};

const entryGet: CommandHandler = async (context) => {
  const id = argument(context, 0, "a data store id");
  const key = argument(context, 1, "an entry key");
  noExtraArguments(context, 2);
  printJson(context, await context.client().dataStores.entries.get(id, key, scope(context)));
};

const entrySet: CommandHandler = async (context) => {
  const id = argument(context, 0, "a data store id");
  const key = argument(context, 1, "an entry key");
  noExtraArguments(context, 2);
  requiredFlag(context, "value", "--value <json>");
  const value = jsonFlag(context, "value", "value");
  const ifVersion = intFlag(context, "ifVersion", "if-version");
  const ttlSeconds = intFlag(context, "ttlSeconds", "ttl-seconds");
  printJson(
    context,
    await context.client().dataStores.entries.set(
      id,
      key,
      { value, ifVersion, ttlSeconds },
      scope(context),
    ),
  );
};

const entryInsert: CommandHandler = async (context) => {
  const id = argument(context, 0, "a data store id");
  noExtraArguments(context, 1);
  requiredFlag(context, "value", "--value <json>");
  const row = objectFlag(context, "value", "value") as Record<string, unknown>;
  const ttlSeconds = intFlag(context, "ttlSeconds", "ttl-seconds");
  printJson(
    context,
    await context.client().dataStores.entries.insert(id, row, { ttlSeconds, ...scope(context) }),
  );
};

const entryIncrement: CommandHandler = async (context) => {
  const id = argument(context, 0, "a data store id");
  const key = argument(context, 1, "an entry key");
  noExtraArguments(context, 2);
  const raw = textFlag(context, "by");
  let by: number | undefined;
  if (raw !== undefined) {
    by = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(by)) {
      throw usageError(context, "`--by` must be a number.");
    }
  }
  printJson(
    context,
    await context.client().dataStores.entries.increment(id, key, by, scope(context)),
  );
};

const entryDelete: CommandHandler = async (context) => {
  const id = argument(context, 0, "a data store id");
  const key = argument(context, 1, "an entry key");
  noExtraArguments(context, 2);
  await context.client().dataStores.entries.delete(id, key, scope(context));
  context.out.emit({ id, key, deleted: true }, () => `Deleted ${key}.`);
};

/** `--where c=v` (repeatable) → `{c: "v"}`; the value is everything after the first `=`. */
function whereFlags(context: CommandContext): Record<string, string> | undefined {
  const values = context.invocation.lists?.where;
  if (values === undefined) return undefined;
  const where: Record<string, string> = {};
  for (const pair of values) {
    const at = pair.indexOf("=");
    if (at < 1) throw usageError(context, "`--where` must be `<col>=<value>`.");
    where[pair.slice(0, at)] = pair.slice(at + 1);
  }
  return where;
}

const entryQuery: CommandHandler = async (context) => {
  const id = argument(context, 0, "a data store id");
  noExtraArguments(context, 1);
  const where = whereFlags(context);
  const order = textFlag(context, "order");
  const limit = intFlag(context, "limit", "limit");
  printJson(
    context,
    await context.client().dataStores.entries.query(id, { where, order, limit }, scope(context)),
  );
};

/**
 * Names the server's error `code` on stderr. `main()` prints only an error's
 * message, and for this group the code (`invalid_value`, `invalid_key`,
 * `invalid_cursor`, `unknown_project`, …) is what a caller acts on. The error
 * is rethrown as an `ApiError` with the same status, code and body, so it still
 * exits 2; nothing is swallowed.
 */
function withErrorCode(handler: CommandHandler): CommandHandler {
  return async (context) => {
    try {
      return await handler(context);
    } catch (error) {
      if (error instanceof ApiError && !error.message.includes(error.code)) {
        throw new ApiError(error.status, error.code, `${error.message} (${error.code})`, error.raw);
      }
      throw error;
    }
  };
}

/** Every `w6w data-stores …` command, keyed by canonical command path. */
export const DATA_STORE_COMMANDS: CommandRegistry = {
  "data-stores list": withErrorCode(list),
  "data-stores get": withErrorCode(get),
  "data-stores create": withErrorCode(create),
  "data-stores update": withErrorCode(update),
  "data-stores archive": withErrorCode(archive),
  "data-stores import": withErrorCode(importCsv),
  "data-stores export": withErrorCode(exportCsv),
  "data-stores entry-list": withErrorCode(entryList),
  "data-stores entry-get": withErrorCode(entryGet),
  "data-stores entry-set": withErrorCode(entrySet),
  "data-stores entry-insert": withErrorCode(entryInsert),
  "data-stores entry-increment": withErrorCode(entryIncrement),
  "data-stores entry-delete": withErrorCode(entryDelete),
  "data-stores entry-query": withErrorCode(entryQuery),
};
