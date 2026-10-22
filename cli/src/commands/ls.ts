/**
 * `w6w ls <integrations|workflows|functions|endpoints>` — one root verb to list a kind.
 *
 * A pure re-dispatch: `workflows`, `functions` and `integrations` run the very
 * handlers behind `workflows list`, `functions list` and `connections list`, so
 * the request, the output and the exit code are the delegate's, byte for byte.
 * `endpoints` lists through the SDK's **unstable** `console.endpoints` namespace
 * (not part of the stable contract) and says so in its human output.
 *
 * This root `ls` is distinct from the in-group `ls` alias for `list`
 * (`w6w documents ls`); `w6w run ls` still treats `ls` as a positional.
 *
 * It imports the three delegate registries directly, never the aggregated
 * `COMMANDS` — that would be an import cycle through `index.ts`.
 *
 * @module
 */

import type { CommandHandler, CommandRegistry } from "../../mod.ts";
import { CONNECTION_COMMANDS } from "./connections.ts";
import { FUNCTION_COMMANDS } from "./functions.ts";
import { WORKFLOW_COMMANDS } from "./workflows.ts";
import { table, usageError } from "./shared.ts";

const KINDS = ["integrations", "workflows", "functions", "endpoints"] as const;

const DELEGATES: Record<string, CommandHandler> = {
  workflows: WORKFLOW_COMMANDS["workflows list"],
  functions: FUNCTION_COMMANDS["functions list"],
  integrations: CONNECTION_COMMANDS["connections list"],
};

const ls: CommandHandler = async (context) => {
  const [kind, ...rest] = context.invocation.positionals;
  if (kind === undefined || !(KINDS as readonly string[]).includes(kind)) {
    throw usageError(
      context,
      (kind === undefined ? "`w6w ls` needs a kind to list." : `Unknown kind \`${kind}\`.`) +
        ` Kinds: ${KINDS.join(", ")}.`,
    );
  }
  const delegateContext = {
    ...context,
    invocation: { ...context.invocation, positionals: rest },
  };
  const delegate = DELEGATES[kind];
  if (delegate !== undefined) return await delegate(delegateContext);

  // endpoints — unstable console namespace.
  if (rest.length > 0) {
    throw usageError(context, `\`w6w ls endpoints\` takes no arguments, and got \`${rest[0]}\`.`);
  }
  const endpoints = await context.client().console.endpoints.list();
  context.out.emit(endpoints, (styles) =>
    [
      styles.dim("Endpoints (unstable: listed through the console API, which may change)"),
      endpoints.length === 0 ? styles.dim("No endpoints.") : table(
        ["ID", "KEY", "STATUS", "NAME"],
        endpoints.map((e) => [e.id, e.key, e.status, e.displayName]),
        styles,
      ),
    ].join("\n"));
};

/** The root `ls` command. */
export const LS_COMMANDS: CommandRegistry = { "ls": ls };
