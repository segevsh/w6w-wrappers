/**
 * `w6w me` (alias `w6w info`, D8) — the caller's identity plus w6w component
 * versions.
 *
 * One command, one SDK call — `client.me()`, which calls `GET /auth/me`, the
 * server's real identity route (verified live 2026-07-28). The server sends
 * `versions: {server, composition}` and the SDK adds `wrapper`; an older server
 * may send none or other keys, and every wrapper tolerates that. (For versions
 * with no identity, see `w6w version`.)
 *
 * **Display is a separate rule from what the data carries (D5).** The
 * `--json` payload is a faithful transcription of the wire: precedence is
 * server-wins, so a server-supplied `versions.wrapper: "0.0.0"` reaches the
 * caller unaltered — `context.out.emit`'s first argument is the raw `Me`
 * object, untouched. The human-readable table never shows a literal `0.0.0`
 * or an empty string for any version, though; it shows `dev` instead. That
 * substitution happens only inside `renderMe`.
 *
 * @module
 */

import type { CommandHandler, CommandRegistry } from "../../mod.ts";
import type { Me } from "@w6w/sdk";
import type { Styles } from "../output.ts";
import { displayVersion, noExtraArguments } from "./shared.ts";

/** The caller's identity, plus versions when the server reports any. */
function renderMe(me: Me, styles: Styles): string {
  const lines = [`${styles.bold(me.tenant)} · ${me.account} · ${me.subject} (${me.role})`];
  const versions = me.versions;
  if (versions && Object.keys(versions).length > 0) {
    lines.push("", styles.dim("versions:"));
    for (const [component, version] of Object.entries(versions)) {
      lines.push(`  ${component}: ${displayVersion(version)}`);
    }
  }
  return lines.join("\n");
}

const me: CommandHandler = async (context) => {
  noExtraArguments(context, 0);
  const identity = await context.client().me();
  context.out.emit(identity, (styles) => renderMe(identity, styles));
};

/**
 * The one `w6w me` command. `w6w info` reaches the same handler: `resolve()`
 * maps the alias back to the canonical `HelpCommand` before dispatch, and
 * dispatch looks the handler up by `command.path.join(" ")` — always `"me"`,
 * never `"info"` — so a second registry entry keyed `"info"` would be dead
 * code, not a second alias.
 */
export const ME_COMMANDS: CommandRegistry = {
  "me": me,
};
