/**
 * `w6w connections list | get | delete [--force]` — find a connection, read one, remove one.
 *
 * `list` exists so a caller can find a `conn_…` id to pass to `w6w run`; it has
 * no filters and no pagination. `get` and `delete` address one by that id.
 * Creating, testing and reconnecting an app are NOT here — connect flows are
 * interactive (OAuth) and stay `outOfScope` in `endpoints.json`.
 *
 * `delete` has no confirmation prompt (this lane is non-interactive) and the
 * server scopes it to the caller's account: another account's id is a plain
 * 404, which exits 2.
 *
 * @module
 */

import type { CommandHandler, CommandRegistry } from "../../mod.ts";
import { ApiError } from "@w6w/sdk";
import type { ConnectionSummary } from "@w6w/sdk";
import type { Styles } from "../output.ts";
import { argument, noExtraArguments, table } from "./shared.ts";

/** One connection, as a table row. */
function row(connection: ConnectionSummary): string[] {
  return [connection.id, connection.appId, connection.state, connection.displayName];
}

/** The listing: one line per connection, or a line saying there are none. */
function renderList(connections: ConnectionSummary[], styles: Styles): string {
  if (connections.length === 0) return styles.dim("No connections.");
  return table(["ID", "APP", "STATE", "NAME"], connections.map(row), styles);
}

const list: CommandHandler = async (context) => {
  noExtraArguments(context, 0);
  const connections = await context.client().connections.list();
  context.out.emit(connections, (styles) => renderList(connections, styles));
};

const get: CommandHandler = async (context) => {
  const id = argument(context, 0, "a connection id (see: `w6w connections list`)");
  noExtraArguments(context, 1);
  const connection = await context.client().connections.get(id);
  context.out.emit(connection, (styles) =>
    [
      `${styles.bold(connection.displayName)} ${styles.dim(`(${connection.id})`)}`,
      "",
      JSON.stringify(connection, null, 2),
    ].join("\n"));
};

/** One dependent callable from a `connection_in_use` body, as `<kind> <displayName> (<id>)`. */
function dependentLines(raw: unknown): string[] {
  const callables = (raw as { error?: { dependents?: { callables?: unknown } } } | null)
    ?.error?.dependents?.callables;
  if (!Array.isArray(callables)) return [];
  return callables.map((c: { kind?: string; displayName?: string; id?: string }) =>
    `${c.kind} ${c.displayName} (${c.id})`
  );
}

const remove: CommandHandler = async (context) => {
  const id = argument(context, 0, "a connection id (see: `w6w connections list`)");
  noExtraArguments(context, 1);
  const force = context.invocation.options.force === true;
  try {
    await context.client().connections.delete(id, { force });
  } catch (err) {
    if (err instanceof ApiError && err.status === 409 && err.code === "connection_in_use") {
      const lines = dependentLines(err.raw);
      if (lines.length > 0) {
        context.out.error(
          [
            `Connection ${id} is in use by:`,
            ...lines.map((line) => `  ${line}`),
            "Re-run with --force to delete it anyway (the callables above are disabled, not edited).",
          ].join("\n"),
        );
      }
    }
    throw err;
  }
  // `null`: the SDK unwraps a delete to nothing; `--json` must not invent a body.
  context.out.emit(null, (styles) => styles.dim(`Deleted ${id}.`));
};

export const CONNECTION_COMMANDS: CommandRegistry = {
  "connections list": list,
  "connections get": get,
  "connections delete": remove,
};
