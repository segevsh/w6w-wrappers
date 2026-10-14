/**
 * `w6w reliability list | members` — health and performance of the apps a
 * project uses.
 *
 * `list` takes `--apps` as one comma-separated value; the server accepts at
 * most 10 ids and its error is surfaced as-is (no client batching — scheduling
 * and polling belong to the caller). `--days` and `--limit` are positive
 * integers, validated here so a typo is a usage error rather than a 400.
 *
 * @module
 */

import type { CommandContext, CommandHandler, CommandRegistry } from "../../mod.ts";
import type { ReliabilityServiceMembers, ReliabilityServices } from "@w6w/sdk";
import type { Styles } from "../output.ts";
import { noExtraArguments, requiredFlag, table, textFlag, usageError } from "./shared.ts";

function positiveInt(context: CommandContext, name: string): number | undefined {
  const text = textFlag(context, name);
  if (text === undefined) return undefined;
  if (!/^[0-9]+$/.test(text) || Number(text) < 1) {
    throw usageError(context, `\`--${name}\` must be a positive integer, got \`${text}\`.`);
  }
  return Number(text);
}

function renderServices(result: ReliabilityServices, styles: Styles): string {
  const heading = styles.dim(
    `${result.window.from} to ${result.window.to} (${result.window.days}d)`,
  );
  if (result.services.length === 0) return `${heading}\n${styles.dim("No services.")}`;
  const rows = result.services.map((s) => [
    s.appId,
    String(s.state),
    String(s.calls),
    s.p95Ms === null ? "-" : `${s.p95Ms}ms`,
    String(s.openAdvisories),
  ]);
  return `${heading}\n${table(["APP", "STATE", "CALLS", "P95", "ADVISORIES"], rows, styles)}`;
}

function renderMembers(result: ReliabilityServiceMembers, styles: Styles): string {
  const heading = styles.dim(
    `${result.window.from} to ${result.window.to} (${result.window.days}d)`,
  );
  if (result.appIds.length === 0) return `${heading}\n${styles.dim("No apps.")}`;
  return `${heading}\n${result.appIds.join("\n")}`;
}

const list: CommandHandler = async (context) => {
  noExtraArguments(context, 0);
  const project = requiredFlag(context, "project", "--project <id>");
  const apps = requiredFlag(context, "apps", "--apps <ids>");
  const ids = apps.split(",").map((id) => id.trim()).filter((id) => id.length > 0);
  if (ids.length === 0) throw usageError(context, "`--apps` needs at least one app id.");
  const days = positiveInt(context, "days");
  const limit = positiveInt(context, "limit");
  const result = await context.client().reliability.list(project, ids, {
    ...(days !== undefined ? { days } : {}),
    ...(limit !== undefined ? { limit } : {}),
  });
  context.out.emit(result, (styles) => renderServices(result, styles));
};

const members: CommandHandler = async (context) => {
  noExtraArguments(context, 0);
  const project = requiredFlag(context, "project", "--project <id>");
  const days = positiveInt(context, "days");
  const result = await context.client().reliability.members(project, {
    ...(days !== undefined ? { days } : {}),
  });
  context.out.emit(result, (styles) => renderMembers(result, styles));
};

export const RELIABILITY_COMMANDS: CommandRegistry = {
  "reliability list": list,
  "reliability members": members,
};
