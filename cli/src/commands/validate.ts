/**
 * `w6w apps validate [dir] [--resolution sibling|registry] [--builder <spec>]` — skeleton.
 *
 * @module
 */

import type { CommandHandler, CommandRegistry } from "../../mod.ts";

const appsValidate: CommandHandler = () => {
  throw new Error("`apps validate` is not implemented yet.");
};

/** `w6w apps validate`. */
export const VALIDATE_COMMANDS: CommandRegistry = {
  "apps validate": appsValidate,
};
