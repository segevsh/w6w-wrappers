/**
 * The version lifecycle shared by `w6w workflows` and `w6w functions`.
 *
 * Seven commands per group — `versions`, `version`, `publish`, `revert`,
 * `enable`, `disable`, `run-version` — with the same spelling on both because the
 * server routes are uniform (`callable-routes.ts`) and the SDK exposes one
 * method name per behaviour on each resource. The CLI caps a command path at two
 * tokens, so the nested `versions list` of the SDK is flat here: `versions <id>`
 * lists, `version <id> <n>` reads one.
 *
 * Only `run-version` differs, because the two kinds run differently (a workflow
 * run is a run record that may fail; a Function returns its output) — so the
 * caller supplies that one handler and this module builds the other six.
 *
 * `enable` and `disable` are void ops: `--json` emits `null`, never the
 * server's `{ok: true}`, matching `delete`.
 *
 * @module
 */

import type { CommandContext, CommandHandler, CommandRegistry } from "../../mod.ts";
import type { PublishResult, RevertResult, VersionDetail, VersionList } from "@w6w/sdk";
import type { Styles } from "../output.ts";
import { argument, noExtraArguments, table, usageError } from "./shared.ts";

/** The two resource namespaces that carry versions. */
export type VersionedNamespace = "workflows" | "functions";

/**
 * A version number argument. The server's path slot is an integer; a value that
 * is not a positive integer is a usage error here rather than a 400 round trip.
 */
export function versionNumber(context: CommandContext, index: number): number {
  const text = argument(context, index, "a version number (see: `w6w <group> versions <id>`)");
  if (!/^[0-9]+$/.test(text) || Number(text) < 1) {
    throw usageError(context, `The version number must be a positive integer, got \`${text}\`.`);
  }
  return Number(text);
}

function renderVersions(list: VersionList, styles: Styles): string {
  const heading = `${list.enabled ? "enabled" : "disabled"}, published version ${
    list.currentPublishedVersion ?? "none"
  }`;
  if (list.versions.length === 0) return `${styles.dim(heading)}\n${styles.dim("No versions.")}`;
  const rows = list.versions.map((v) => [
    String(v.versionNumber),
    v.createdAt,
    v.createdBy ?? "-",
    v.isCurrentPublished ? "published" : "",
  ]);
  return `${styles.dim(heading)}\n${table(["VERSION", "CREATED", "BY", "STATE"], rows, styles)}`;
}

function renderVersion(detail: VersionDetail, styles: Styles): string {
  return [
    styles.bold(`version ${detail.versionNumber}`) + " " +
    styles.dim(`created ${detail.createdAt}`),
    "",
    JSON.stringify(detail.definition, null, 2),
  ].join("\n");
}

/** Builds the six version commands common to both groups, plus the caller's `run-version`. */
export function versionCommands(
  ns: VersionedNamespace,
  runVersion: CommandHandler,
): CommandRegistry {
  const idWhat = ns === "workflows"
    ? "a workflow id (see: `w6w workflows list`)"
    : "a function id or key (see: `w6w functions list`)";

  const versions: CommandHandler = async (context) => {
    const id = argument(context, 0, idWhat);
    noExtraArguments(context, 1);
    const list = await context.client()[ns].listVersions(id);
    context.out.emit(list, (styles) => renderVersions(list, styles));
  };

  const version: CommandHandler = async (context) => {
    const id = argument(context, 0, idWhat);
    const n = versionNumber(context, 1);
    noExtraArguments(context, 2);
    const detail = await context.client()[ns].getVersion(id, n);
    context.out.emit(detail, (styles) => renderVersion(detail, styles));
  };

  const publish: CommandHandler = async (context) => {
    const id = argument(context, 0, idWhat);
    noExtraArguments(context, 1);
    const result: PublishResult = await context.client()[ns].publish(id);
    context.out.emit(
      result,
      (styles) => styles.dim(`Published ${id} as version ${result.version.versionNumber}.`),
    );
  };

  const revert: CommandHandler = async (context) => {
    const id = argument(context, 0, idWhat);
    const n = versionNumber(context, 1);
    noExtraArguments(context, 2);
    const result: RevertResult = await context.client()[ns].revert(id, n);
    context.out.emit(
      result,
      (styles) => styles.dim(`Reverted ${id} to version ${result.versionNumber}.`),
    );
  };

  const toggle = (verb: "enable" | "disable"): CommandHandler => async (context) => {
    const id = argument(context, 0, idWhat);
    noExtraArguments(context, 1);
    await context.client()[ns][verb](id);
    // `null`: the SDK unwraps `{ok: true}` to nothing and `--json` must not invent a body.
    context.out.emit(
      null,
      (styles) => styles.dim(`${verb === "enable" ? "Enabled" : "Disabled"} ${id}.`),
    );
  };

  return {
    [`${ns} versions`]: versions,
    [`${ns} version`]: version,
    [`${ns} publish`]: publish,
    [`${ns} revert`]: revert,
    [`${ns} enable`]: toggle("enable"),
    [`${ns} disable`]: toggle("disable"),
    [`${ns} run-version`]: runVersion,
  };
}
