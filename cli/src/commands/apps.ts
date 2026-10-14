/**
 * `w6w apps by-ids <ids>` — look up apps by id.
 *
 * `<ids>` is one comma-separated argument (`sendgrid,slack`). The SDK dedupes and
 * chunks to the server's cap of 100 per request, so the CLI imposes no limit of
 * its own. An id that matches no app is simply absent from the result.
 *
 * @module
 */

import type { CommandHandler, CommandRegistry } from "../../mod.ts";
import type { Styles } from "../output.ts";
import { argument, noExtraArguments, table } from "./shared.ts";
import type { AppSummary } from "@w6w/sdk";

function renderApps(apps: AppSummary[], styles: Styles): string {
  if (apps.length === 0) return styles.dim("No matching apps.");
  return table(
    ["ID", "NAME", "VERSION"],
    apps.map((a) => [a.id, a.displayName, a.version]),
    styles,
  );
}

const byIds: CommandHandler = async (context) => {
  const text = argument(context, 0, "a comma-separated list of app ids (e.g. sendgrid,slack)");
  noExtraArguments(context, 1);
  const ids = text.split(",").map((id) => id.trim()).filter((id) => id.length > 0);
  const apps = await context.client().apps.byIds(ids);
  context.out.emit(apps, (styles) => renderApps(apps, styles));
};

export const APP_COMMANDS: CommandRegistry = {
  "apps by-ids": byIds,
};
