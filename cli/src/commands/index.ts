/**
 * The command registry — every command this build can run, in one map.
 *
 * `main()` dispatches by canonical command path (`"documents list"`,
 * `"vars get-by-name"`), so this file is a union of the per-group registries and
 * nothing else: no logic, no ordering, no conditionals. A command group owns its
 * handlers, its arguments and its help; joining them is all that happens here.
 *
 * **This is the merge point.** Each command-group node adds one import and one
 * spread, and nothing else in the file moves — which is what keeps two groups
 * landing in the same release from conflicting over it. A group that is not
 * spread in below is not runnable: `main()` answers a command with no handler
 * with a usage error saying it is not available in this build, which is a better
 * answer than a silent success.
 *
 * @module
 */

import type { CommandRegistry } from "../../mod.ts";
import { DOCUMENT_COMMANDS } from "./documents.ts";
import { VAR_COMMANDS } from "./vars.ts";
import { ME_COMMANDS } from "./me.ts";
import { CONNECTION_COMMANDS } from "./connections.ts";
import { FUNCTION_COMMANDS } from "./functions.ts";
import { NAMED_RUN_COMMANDS } from "./named-run.ts";
import { WORKFLOW_COMMANDS } from "./workflows.ts";
import { RUN_COMMANDS } from "./run.ts";
import { TEAM_COMMANDS } from "./team.ts";
import { APP_COMMANDS } from "./apps.ts";
import { DASHBOARD_COMMANDS } from "./dashboard.ts";
import { PROJECT_COMMANDS } from "./projects.ts";
import { RELIABILITY_COMMANDS } from "./reliability.ts";
import { AUTH_COMMANDS } from "./auth.ts";
import { CONFIG_COMMANDS } from "./config.ts";
import { LS_COMMANDS } from "./ls.ts";
import { MODEL_COMMANDS } from "./models.ts";
import { ASSET_COMMANDS } from "./assets.ts";
import { AGENT_STUDIO_COMMANDS } from "./agents-studio.ts";

export { DOCUMENT_COMMANDS } from "./documents.ts";
export { VAR_COMMANDS } from "./vars.ts";
export { ME_COMMANDS } from "./me.ts";
export { CONNECTION_COMMANDS } from "./connections.ts";
export { FUNCTION_COMMANDS } from "./functions.ts";
export { NAMED_RUN_COMMANDS } from "./named-run.ts";
export { WORKFLOW_COMMANDS } from "./workflows.ts";
export { RUN_COMMANDS } from "./run.ts";
export { TEAM_COMMANDS } from "./team.ts";
export { APP_COMMANDS } from "./apps.ts";
export { DASHBOARD_COMMANDS } from "./dashboard.ts";
export { PROJECT_COMMANDS } from "./projects.ts";
export { RELIABILITY_COMMANDS } from "./reliability.ts";
export { AUTH_COMMANDS } from "./auth.ts";
export { CONFIG_COMMANDS } from "./config.ts";
export { LS_COMMANDS } from "./ls.ts";
export { MODEL_COMMANDS } from "./models.ts";
export { ASSET_COMMANDS } from "./assets.ts";
export { AGENT_STUDIO_COMMANDS } from "./agents-studio.ts";

/** Every wired command, keyed by canonical command path. */
export const COMMANDS: CommandRegistry = {
  ...DOCUMENT_COMMANDS,
  ...MODEL_COMMANDS,
  ...ASSET_COMMANDS,
  ...AGENT_STUDIO_COMMANDS,
  ...VAR_COMMANDS,
  ...ME_COMMANDS,
  ...CONNECTION_COMMANDS,
  ...WORKFLOW_COMMANDS,
  ...FUNCTION_COMMANDS,
  ...NAMED_RUN_COMMANDS,
  ...RUN_COMMANDS,
  ...TEAM_COMMANDS,
  ...APP_COMMANDS,
  ...DASHBOARD_COMMANDS,
  ...PROJECT_COMMANDS,
  ...RELIABILITY_COMMANDS,
  ...AUTH_COMMANDS,
  ...CONFIG_COMMANDS,
  ...LS_COMMANDS,
};
