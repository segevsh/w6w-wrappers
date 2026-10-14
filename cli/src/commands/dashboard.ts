/**
 * `w6w dashboard stats` — the account's run-ledger rollup.
 *
 * Account-scoped: there is no `--project`. `--from`/`--to`/`--bucket` are sent
 * only when given; the server applies its own defaults otherwise.
 *
 * @module
 */

import type { CommandHandler, CommandRegistry } from "../../mod.ts";
import type { DashboardStats } from "@w6w/sdk";
import type { Styles } from "../output.ts";
import { noExtraArguments, textFlag } from "./shared.ts";

function renderStats(stats: DashboardStats, styles: Styles): string {
  const { range, headline } = stats;
  return [
    styles.dim(`${range.from} to ${range.to} (by ${range.bucket})`),
    `workflow runs: ${headline.workflowRuns}  succeeded: ${headline.succeeded}  failed: ${headline.failed}`,
    styles.dim(`${stats.series.length} series points, ${stats.recent.length} recent events`),
  ].join("\n");
}

const stats: CommandHandler = async (context) => {
  noExtraArguments(context, 0);
  const from = textFlag(context, "from");
  const to = textFlag(context, "to");
  const bucket = textFlag(context, "bucket");
  const result = await context.client().dashboard.stats({
    ...(from !== undefined ? { from } : {}),
    ...(to !== undefined ? { to } : {}),
    // Open string on purpose: `day|week` is documentation, the server decides.
    ...(bucket !== undefined ? { bucket: bucket as "day" | "week" } : {}),
  });
  context.out.emit(result, (styles) => renderStats(result, styles));
};

export const DASHBOARD_COMMANDS: CommandRegistry = {
  "dashboard stats": stats,
};
