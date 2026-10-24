/**
 * `w6w models …`, `w6w model-routes …` and `w6w model-usage` — the model
 * registry at the command line.
 *
 * Six commands, **one SDK call each**. `model-routes complete` prints the flat
 * gateway envelope exactly as the server sent it (`invocationId`, `status`,
 * `key`, …): there is no unwrap to `output`, because the envelope is the
 * result. `--project` is optional everywhere; an absent flag sends no
 * `?project=` and the server resolves the account's default project.
 *
 * @module
 */

import type { CommandContext, CommandHandler, CommandRegistry } from "../../mod.ts";
import type { Model, ModelRoute } from "@w6w/sdk";
import type { Styles } from "../output.ts";
import { argument, noExtraArguments, requiredFlag, table, textFlag, usageError } from "./shared.ts";

/** The project scope for one call: the `--project` flag, or nothing at all. */
function scope(context: CommandContext): { project?: string } {
  const project = textFlag(context, "project");
  return project === undefined ? {} : { project };
}

/** A positive-integer flag, or `undefined` when absent. */
function count(context: CommandContext, name: string): number | undefined {
  const text = textFlag(context, name);
  if (text === undefined) return undefined;
  if (!/^[0-9]+$/.test(text) || Number(text) < 1) {
    throw usageError(context, `\`--${name}\` must be a positive integer.`);
  }
  return Number(text);
}

function text(value: unknown): string {
  return typeof value === "string"
    ? value
    : value === undefined || value === null
    ? "-"
    : String(value);
}

const listModels: CommandHandler = async (context) => {
  noExtraArguments(context, 0);
  const page = await context.client().models.list({
    provider: textFlag(context, "provider"),
    status: textFlag(context, "status"),
    limit: count(context, "limit"),
    cursor: textFlag(context, "cursor"),
  });
  context.out.emit(page, (styles: Styles) => {
    if (page.models.length === 0) return styles.dim("No models.");
    const rows = page.models.map((m: Model) => [m.id, text(m.provider), text(m.status)]);
    const body = table(["ID", "PROVIDER", "STATUS"], rows, styles);
    return page.nextCursor ? `${body}\n${styles.dim(`next: --cursor ${page.nextCursor}`)}` : body;
  });
};

const getModel: CommandHandler = async (context) => {
  const id = argument(context, 0, "a model id (see: `w6w models ls`)");
  noExtraArguments(context, 1);
  const model = await context.client().models.get(id);
  context.out.emit(model, () => JSON.stringify(model, null, 2));
};

const listRoutes: CommandHandler = async (context) => {
  noExtraArguments(context, 0);
  const routes = await context.client().modelRoutes.list(scope(context));
  context.out.emit(routes, (styles: Styles) => {
    if (routes.length === 0) return styles.dim("No model routes.");
    return table(
      ["NAME", "STATUS"],
      routes.map((r: ModelRoute) => [r.name, text(r.status)]),
      styles,
    );
  });
};

const getRoute: CommandHandler = async (context) => {
  const name = argument(context, 0, "a route name (see: `w6w model-routes list`)");
  noExtraArguments(context, 1);
  const route = await context.client().modelRoutes.get(name, scope(context));
  context.out.emit(route, () => JSON.stringify(route, null, 2));
};

/**
 * `w6w model-routes complete <name> --input <json>` — the flat envelope, as-is.
 * `--dialect` and `--response` are the **server's** enums; they are passed
 * through untouched so a value the server starts accepting is not refused here.
 */
const complete: CommandHandler = async (context) => {
  const name = argument(context, 0, "a route name (see: `w6w model-routes list`)");
  noExtraArguments(context, 1);
  const raw = requiredFlag(context, "input", "--input <json>");
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    throw usageError(context, "`--input` must be valid JSON.");
  }
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw usageError(context, "`--input` must be a JSON object.");
  }
  const envelope = await context.client().modelRoutes.complete(
    name,
    input as Record<string, unknown>,
    {
      ...scope(context),
      // deno-lint-ignore no-explicit-any
      dialect: textFlag(context, "dialect") as any,
      // deno-lint-ignore no-explicit-any
      response: textFlag(context, "response") as any,
    },
  );
  context.out.emit(envelope, () => JSON.stringify(envelope, null, 2));
};

const usage: CommandHandler = async (context) => {
  noExtraArguments(context, 0);
  const report = await context.client().modelUsage.query({
    ...scope(context),
    // deno-lint-ignore no-explicit-any
    groupBy: textFlag(context, "groupBy") as any,
    from: textFlag(context, "from"),
    to: textFlag(context, "to"),
    route: textFlag(context, "route"),
    model: textFlag(context, "model"),
    limit: count(context, "limit"),
    cursor: textFlag(context, "cursor"),
  });
  context.out.emit(report, () => JSON.stringify(report, null, 2));
};

/** The six model commands, keyed by canonical command path. */
export const MODEL_COMMANDS: CommandRegistry = {
  "models list": listModels,
  "models get": getModel,
  "model-routes list": listRoutes,
  "model-routes get": getRoute,
  "model-routes complete": complete,
  "model-usage": usage,
};
