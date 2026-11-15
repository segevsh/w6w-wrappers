/**
 * `w6w apps validate [dir] [--resolution sibling|registry] [--builder <spec>]` — ask the
 * canonical `@w6w/app-build` builder whether an app folder is a valid w6w app.
 *
 * The CLI owns no half of this answer. It resolves the app directory, decides how the
 * builder should resolve `@w6w/*` (the flag if given, otherwise read off the app's
 * `deno.json`), spawns the builder through {@linkcode runBuilder}, and re-emits the one
 * JSON line the builder prints. Nothing here is bundled, imported or re-checked: a
 * validation that lived in two places would be free to disagree with itself.
 *
 * Two consequences of that, both deliberate:
 *
 * - **The failure answer is data, and it goes to stdout.** `{"ok":false,…}` is the
 *   builder's answer to a question that was asked successfully — the same shape as a
 *   workflow run that came back `failed`. So it is the command's payload and it is
 *   rendered through `context.out.emit`, which is what keeps `--json` one parseable
 *   document even when the app does not pass; the **exit code** is what tells the shell,
 *   and it is the CLI's one failure code (`EXIT_USAGE`), never a new number.
 * - **A builder that could not run is not a validation failure.** No JSON line, or a
 *   `deno` that is not installed, is thrown: `main()` reports it on stderr once and the
 *   invocation exits `1`, exactly like every other command's local failure.
 *
 * @module
 */

import type { BuilderReport } from "../app-toolchain.ts";
import type { CommandHandler, CommandRegistry } from "../../mod.ts";
import {
  appDir,
  builderArgs,
  DEFAULT_BUILDER,
  readReport,
  type Resolution,
  resolveResolution,
  runBuilder,
} from "../app-toolchain.ts";
import { EXIT_SUCCESS, EXIT_USAGE } from "../exit.ts";
import type { Styles } from "../output.ts";
import { noExtraArguments, textFlag, usageError } from "./shared.ts";

/** The human rendering of a pass: `ok <id>@<version>`. */
function renderOk(report: BuilderReport, styles: Styles): string {
  return `${styles.green("ok")} ${styles.bold(`${report.id}@${report.version}`)}`;
}

/** The human rendering of a refusal: one `code: message` line per reason, in the builder's order. */
function renderErrors(report: BuilderReport, styles: Styles): string {
  return (report.errors ?? []).map((error) => `${styles.red(error.code)}: ${error.message}`).join(
    "\n",
  );
}

const appsValidate: CommandHandler = async (context) => {
  const dir = await appDir(context.invocation.positionals[0]);
  noExtraArguments(context, 1);

  const spec = textFlag(context, "builder") ?? DEFAULT_BUILDER;
  const flag = textFlag(context, "resolution");
  let resolution: Resolution;
  try {
    resolution = await resolveResolution(dir, flag);
  } catch (error) {
    // A `--resolution` that is neither `sibling` nor `registry` is a bad invocation,
    // not a builder problem: report it with the command's own usage line.
    throw usageError(context, (error as Error).message);
  }

  const argv = await builderArgs(spec, dir, "validate", { resolution });
  const result = await runBuilder(argv, dir);
  const report = readReport(result.stdout, result.stderr);
  context.out.emit(
    report,
    (styles) => report.ok ? renderOk(report, styles) : renderErrors(report, styles),
  );
  return report.ok ? EXIT_SUCCESS : EXIT_USAGE;
};

/** `w6w apps validate`. */
export const VALIDATE_COMMANDS: CommandRegistry = {
  "apps validate": appsValidate,
};
