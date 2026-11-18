/**
 * `w6w apps validate [dir]` — ask the app assembler whether an app folder would
 * package as a w6w app.
 *
 * The app is the developer's own build: `package.json` names one self-contained
 * JavaScript file (`w6w.entry`, else `main`). The CLI owns no half of the answer: it
 * resolves the app directory, asks core's assembler ({@linkcode validate}, vendored,
 * in-process, Node only) and prints its one JSON line. A validation that lived in two
 * places would be free to disagree with itself.
 *
 * Two consequences of that, both deliberate:
 *
 * - **The failure answer is data, and it goes to stdout.** `{"ok":false,…}` is the
 *   assembler's answer to a question that was asked successfully — the same shape as a
 *   workflow run that came back `failed`. So it is the command's payload and it is
 *   rendered through `context.out.emit`, which is what keeps `--json` one parseable
 *   document even when the app does not pass; the **exit code** is what tells the shell,
 *   and it is the CLI's one failure code (`EXIT_USAGE`), never a new number.
 * - **A check that could not run is not a validation failure.** A missing directory or
 *   an assembler crash is thrown: `main()` reports it on stderr once and the invocation
 *   exits `1`, exactly like every other command's local failure.
 *
 * @module
 */

import type { BuilderReport } from "../app-toolchain.ts";
import type { CommandHandler, CommandRegistry } from "../../mod.ts";
import { appDir, refusalLine, validate } from "../app-toolchain.ts";
import { EXIT_SUCCESS, EXIT_USAGE } from "../exit.ts";
import type { Styles } from "../output.ts";
import { noExtraArguments } from "./shared.ts";

/** The human rendering: `ok <id>@<version>`, or one `code: message` line per reason. */
function render(report: BuilderReport, styles: Styles): string {
  if (report.ok) return `${styles.green("ok")} ${styles.bold(`${report.id}@${report.version}`)}`;
  return report.errors.map((error) => refusalLine({ ...error, code: styles.red(error.code) }))
    .join("\n");
}

const appsValidate: CommandHandler = async (context) => {
  const dir = await appDir(context.invocation.positionals[0]);
  noExtraArguments(context, 1);

  const report = await validate(dir);
  context.out.emit(report, (styles) => render(report, styles));
  return report.ok ? EXIT_SUCCESS : EXIT_USAGE;
};

/** `w6w apps validate`. */
export const VALIDATE_COMMANDS: CommandRegistry = {
  "apps validate": appsValidate,
};
