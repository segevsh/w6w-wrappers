/**
 * `w6w apps init <id> [--template deno|node] [--dir <path>]` — skeleton.
 *
 * @module
 */

import type { CommandHandler, CommandRegistry } from "../../mod.ts";

const appsInit: CommandHandler = () => {
  throw new Error("`apps init` is not implemented yet.");
};

/** `w6w apps init`. */
export const INIT_COMMANDS: CommandRegistry = {
  "apps init": appsInit,
};
