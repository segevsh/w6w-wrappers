/**
 * `w6w app-management …` — manage the apps you own, at the command line.
 *
 * Seven commands, **one SDK call each** (`client.appManagement.*`). Nothing
 * here composes two requests. Errors are not caught: `main()` reports a throw
 * once on stderr and maps it to an exit code through `src/exit.ts`, so an
 * `ApiError` exits 2 (its `code` is on stderr) and a usage error exits 1 with
 * **zero requests**.
 *
 * Two things are deliberately not decided here. `--target` and `--scope` are
 * sent as typed: the server is the authority on which targets the caller may
 * use (the `targets` list of `list --json`). And a sync or source edit that
 * could not load the source is still a **200** whose `outcome` is `failed`: it
 * exits 0 and prints the outcome and `error.code` prominently; a script that
 * cares reads `outcome` from `--json`. There is no new exit code.
 *
 * @module
 */

import type { CommandHandler, CommandRegistry } from "../../mod.ts";
import { ApiError } from "@w6w/sdk";
import type {
  ListManagedAppsOptions,
  ManagedAppRow,
  RegisterAppInput,
  SourceInput,
  SyncResult,
  Target,
} from "@w6w/sdk";
import type { CommandContext } from "../../mod.ts";
import type { Styles } from "../output.ts";
import { argument, noExtraArguments, requiredFlag, table, textFlag, usageError } from "./shared.ts";

/** An integer flag, or `undefined` when absent. `min` is 0 (offset, revision) or 1 (limit). */
function intFlag(context: CommandContext, name: string, kebab: string, min: 0 | 1) {
  const value = textFlag(context, name);
  if (value === undefined) return undefined;
  if (!/^[0-9]+$/.test(value) || Number(value) < min) {
    throw usageError(
      context,
      `\`--${kebab}\` must be a ${min === 0 ? "non-negative" : "positive"} integer.`,
    );
  }
  return Number(value);
}

/**
 * A source argument: a value whose first non-space character is `{` is parsed
 * as JSON and must be an object (the `{"folder":{…}}` form); anything else is
 * sent as the string it is.
 */
function sourceArg(context: CommandContext, index: number): SourceInput {
  const raw = argument(context, index, "a source (a ref, or a JSON {folder} object)");
  if (!raw.trimStart().startsWith("{")) return raw;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw usageError(context, "The source looks like JSON but is not valid JSON.");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw usageError(context, "A JSON source must be an object.");
  }
  return value as SourceInput;
}

/** `--paths a,b` → `["a","b"]`: comma split, trimmed, empties dropped. */
function pathsFlag(context: CommandContext): string[] | undefined {
  const value = textFlag(context, "paths");
  if (value === undefined) return undefined;
  return value.split(",").map((p) => p.trim()).filter((p) => p.length > 0);
}

function printJson(context: CommandContext, value: unknown): void {
  context.out.emit(value, () => JSON.stringify(value, null, 2));
}

function appRow(row: ManagedAppRow): string[] {
  const record = row as unknown as Record<string, unknown>;
  return [
    String(record.id ?? "—"),
    String(record.version ?? "—"),
    row.management?.class ?? "—",
    row.source?.ref ?? row.source?.kind ?? "—",
    String(row.source?.revision ?? "—"),
    row.lastSync?.outcome ?? "—",
  ];
}

const list: CommandHandler = async (context) => {
  noExtraArguments(context, 0);
  const options: ListManagedAppsOptions = {};
  const scope = textFlag(context, "scope");
  if (scope !== undefined) options.scope = scope as ListManagedAppsOptions["scope"];
  const q = textFlag(context, "q");
  if (q !== undefined) options.q = q;
  const sort = textFlag(context, "sort");
  if (sort !== undefined) options.sort = sort as ListManagedAppsOptions["sort"];
  if (context.invocation.options.compact === true) options.compact = true;
  const snapshot = textFlag(context, "snapshot");
  if (snapshot !== undefined) options.snapshot = snapshot;
  const cursor = textFlag(context, "cursor");
  if (cursor !== undefined) options.cursor = cursor;
  const offset = intFlag(context, "offset", "offset", 0);
  if (offset !== undefined) options.offset = offset;
  const limit = intFlag(context, "limit", "limit", 1);
  if (limit !== undefined) options.limit = limit;

  const page = await context.client().appManagement.list(options);
  context.out.emit(page, (styles) => {
    const rows = table(
      ["ID", "VERSION", "CLASS", "SOURCE", "REV", "LAST SYNC"],
      page.apps.map(appRow),
      styles,
    );
    const lines = page.apps.length === 0 ? [styles.dim("No apps.")] : [rows];
    lines.push(styles.dim(`${page.apps.length} of ${page.total} (offset ${page.offset})`));
    if (page.nextCursor) lines.push(`Next page: --cursor ${page.nextCursor}`);
    return lines.join("\n");
  });
};

const get: CommandHandler = async (context) => {
  const id = argument(context, 0, "an app id");
  noExtraArguments(context, 1);
  printJson(context, await context.client().appManagement.get(id));
};

const preview: CommandHandler = async (context) => {
  const source = sourceArg(context, 0);
  noExtraArguments(context, 1);
  const target = requiredFlag(context, "target", "--target account|tenant|personal") as Target;
  printJson(context, await context.client().appManagement.preview({ source, target }));
};

const register: CommandHandler = async (context) => {
  const source = sourceArg(context, 0);
  noExtraArguments(context, 1);
  const target = requiredFlag(context, "target", "--target account|tenant|personal") as Target;
  const paths = pathsFlag(context);
  const input: RegisterAppInput = paths === undefined
    ? { target, source }
    : { target, source, paths };
  const result = await context.client().appManagement.register(input);
  context.out.emit(result, (styles) => {
    const head = `Registered into ${styles.bold(result.target)} (${result.kind})`;
    return `${head}\n${JSON.stringify(result, null, 2)}`;
  });
};

/** A sync result for people: the outcome, and on `failed` the error code first. */
function renderSync(result: SyncResult, styles: Styles): string {
  const lines = [`${styles.bold(result.appId)}: ${result.outcome}`];
  if (result.outcome === "failed") {
    lines.push(
      `error: ${result.error?.code ?? "unknown"}${
        result.error?.message ? ` — ${result.error.message}` : ""
      }`,
    );
  } else {
    lines.push(`version: ${result.previousVersion ?? "—"} -> ${result.version ?? "—"}`);
  }
  lines.push(styles.dim(`source revision ${result.source?.revision}`));
  return lines.join("\n");
}

const updateSource: CommandHandler = async (context) => {
  const id = argument(context, 0, "an app id");
  const source = sourceArg(context, 1);
  noExtraArguments(context, 2);
  const expectedRevision = intFlag(context, "expectedRevision", "expected-revision", 0);
  if (expectedRevision === undefined) {
    throw usageError(context, "`app-management update-source` needs `--expected-revision <n>`.");
  }
  const result = await context.client().appManagement.updateSource(id, {
    source,
    expectedRevision,
  });
  context.out.emit(result, (styles) => renderSync(result, styles));
};

const sync: CommandHandler = async (context) => {
  const id = argument(context, 0, "an app id");
  noExtraArguments(context, 1);
  const expectedRevision = intFlag(context, "expectedRevision", "expected-revision", 0);
  const result = await context.client().appManagement.sync(
    id,
    expectedRevision === undefined ? undefined : { expectedRevision },
  );
  context.out.emit(result, (styles) => renderSync(result, styles));
};

const remove: CommandHandler = async (context) => {
  const id = argument(context, 0, "an app id");
  noExtraArguments(context, 1);
  const result = await context.client().appManagement.remove(id);
  context.out.emit(result, () => `Removed ${id} (${result.removed} version(s)).`);
};

/**
 * Names the server's error `code` on stderr. `main()` prints only an error's
 * message, and for this group the code (`unknown_app`, `stale_source`,
 * `local_import_forbidden`, …) is what a caller acts on. The error is rethrown
 * as an `ApiError` with the same status, code and body, so it still exits 2
 * through `exitCodeFor`; nothing is swallowed.
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

/** Every `w6w app-management …` command, keyed by canonical command path. */
export const APP_MANAGEMENT_COMMANDS: CommandRegistry = {
  "app-management list": withErrorCode(list),
  "app-management get": withErrorCode(get),
  "app-management preview": withErrorCode(preview),
  "app-management register": withErrorCode(register),
  "app-management update-source": withErrorCode(updateSource),
  "app-management sync": withErrorCode(sync),
  "app-management remove": withErrorCode(remove),
};
