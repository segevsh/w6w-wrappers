/**
 * `w6w endpoints list [--tag <tag>]` — list the caller's Endpoints.
 *
 * The sibling of `w6w functions list`: it is how a caller finds the key to pass to
 * `w6w endpoints run`. `run` lives in `src/commands/named-run.ts`. This is the
 * stable `endpoints.list` operation; `w6w ls endpoints` keeps listing through the
 * SDK's unstable `console.endpoints` namespace.
 *
 * @module
 */

import type { CommandHandler, CommandRegistry } from "../../mod.ts";
import type { EndpointSummary } from "@w6w/sdk";
import type { Styles } from "../output.ts";
import { noExtraArguments, table, textFlag } from "./shared.ts";

/** One Endpoint, as a table row. */
function row(endpoint: EndpointSummary): string[] {
  return [endpoint.id, endpoint.key, endpoint.incomplete ? "draft" : "ready", endpoint.updatedAt];
}

/** The listing: one line per Endpoint, or a line saying there are none. */
function renderList(endpoints: EndpointSummary[], styles: Styles): string {
  if (endpoints.length === 0) return styles.dim("No endpoints.");
  return table(["ID", "KEY", "STATE", "UPDATED"], endpoints.map(row), styles);
}

const list: CommandHandler = async (context) => {
  noExtraArguments(context, 0);
  const tag = textFlag(context, "tag");
  const endpoints = await context.client().endpoints.list(tag === undefined ? {} : { tag });
  context.out.emit(endpoints, (styles) => renderList(endpoints, styles));
};

export const ENDPOINT_COMMANDS: CommandRegistry = {
  "endpoints list": list,
};
