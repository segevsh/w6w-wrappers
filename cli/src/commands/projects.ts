/**
 * `w6w projects list` — the projects the credential can see.
 *
 * Read-only. The server creates the account's default project on the first
 * list if there is none; that side effect is the server's and is not hidden
 * here. Project create/archive/delete are not in the CLI.
 *
 * @module
 */

import type { CommandHandler, CommandRegistry } from "../../mod.ts";
import type { Project } from "@w6w/sdk";
import type { Styles } from "../output.ts";
import { noExtraArguments, table } from "./shared.ts";

function renderList(projects: Project[], styles: Styles): string {
  if (projects.length === 0) return styles.dim("No projects.");
  return table(
    ["ID", "NAME", "STATUS", "DEFAULT"],
    projects.map((p) => [p.id, p.name, p.status, p.isDefault ? "yes" : ""]),
    styles,
  );
}

const list: CommandHandler = async (context) => {
  noExtraArguments(context, 0);
  const projects = await context.client().projects.list();
  context.out.emit(projects, (styles) => renderList(projects, styles));
};

export const PROJECT_COMMANDS: CommandRegistry = {
  "projects list": list,
};
