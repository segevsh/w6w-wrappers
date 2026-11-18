/**
 * The `apps` command group.
 *
 * `apps by-ids <ids>` is a server lookup: `<ids>` is one comma-separated argument
 * (`sendgrid,slack`). The SDK dedupes and chunks to the server's cap of 100 per
 * request, so the CLI imposes no limit of its own. An id that matches no app is
 * simply absent from the result.
 *
 * `apps search <q>` searches an npm or JSR registry for installable apps. The
 * CLI always sends a `registry` — `npm` when `--registry` is absent — so the
 * request on the wire says what the search actually searched; `--limit` is sent
 * only when given (the server's default applies otherwise). `--registry` is
 * validated here rather than passed through: a typo (`--registry npmjs`) is then
 * a usage error with zero requests, not a `400 invalid_query` round trip.
 *
 * `apps build` is local and lives in `./build.ts`, because the `build app` alias and
 * the pack lock are one handler with one seam; registering it here keeps every
 * `apps …` spelling in this map (and `w6w build app` pointing at the same handler).
 *
 * `apps publish` (build → upload) is in `./publish.ts`; `apps list` is the very handler object
 * `app-management list` is registered under (exported from `./app-management.ts`).
 *
 * @module
 */

import type { CommandContext, CommandHandler, CommandRegistry } from "../../mod.ts";
import type { Styles } from "../output.ts";
import { listManagedApps } from "./app-management.ts";
import { DEFAULT_BUILDER, packageApps, PackageFailure } from "../app-toolchain.ts";
import { appsBuild } from "./build.ts";
import { appsPublish } from "./publish.ts";
import { argument, noExtraArguments, table, textFlag, usageError } from "./shared.ts";
import type {
  AppManagementDiscoverInput,
  AppManagementDiscoverItem,
  AppManagementDiscoverResult,
  AppSummary,
} from "@w6w/sdk";

function renderApps(apps: AppSummary[], styles: Styles): string {
  if (apps.length === 0) return styles.dim("No matching apps.");
  return table(
    ["ID", "NAME", "VERSION"],
    apps.map((a) => [a.id, a.displayName, a.version]),
    styles,
  );
}

const byIds: CommandHandler = async (context) => {
  const text = argument(context, 0, "a comma-separated list of app ids (e.g. sendgrid,slack)");
  noExtraArguments(context, 1);
  const ids = text.split(",").map((id) => id.trim()).filter((id) => id.length > 0);
  const apps = await context.client().apps.byIds(ids);
  context.out.emit(apps, (styles) => renderApps(apps, styles));
};

/** One hit per line: what it is called, which version, the ref to install, and if you have it. */
function discoverRow(item: AppManagementDiscoverItem): string[] {
  return [item.name, item.version, item.ref, item.installed ? "yes" : "—"];
}

function renderDiscover(result: AppManagementDiscoverResult, styles: Styles): string {
  const header = `${styles.bold(result.q)} in ${
    styles.bold(result.registry)
  } — ${result.items.length} result(s)`;
  if (result.items.length === 0) return `${header}\n${styles.dim("No matching apps.")}`;
  const rows = table(
    ["NAME", "VERSION", "REF", "INSTALLED"],
    result.items.map(discoverRow),
    styles,
  );
  return `${header}\n${rows}`;
}

/** `--limit <n>`: a positive integer, or a usage error before any request. */
function limitFlag(context: CommandContext): number | undefined {
  const value = textFlag(context, "limit");
  if (value === undefined) return undefined;
  if (!/^[0-9]+$/.test(value) || Number(value) < 1) {
    throw usageError(context, "`--limit` must be a positive integer.");
  }
  return Number(value);
}

const search: CommandHandler = async (context) => {
  const q = argument(context, 0, "a search query (1..100 characters)");
  noExtraArguments(context, 1);
  const registry = textFlag(context, "registry") ?? "npm";
  if (registry !== "npm" && registry !== "jsr") {
    throw usageError(context, "`--registry` must be `npm` or `jsr`.");
  }
  const input: AppManagementDiscoverInput = { registry, q };
  const limit = limitFlag(context);
  if (limit !== undefined) input.limit = limit;
  const result = await context.client().appManagement.discover(input);
  context.out.emit(result, (styles) => renderDiscover(result, styles));
};

/** `apps package <pack> --out <dir>`: build a pack source into a publishable `<dir>/w6w` tree. */
const appsPackage: CommandHandler = async (context) => {
  const pack = argument(context, 0, "the pack file (w6w-pack.json)");
  noExtraArguments(context, 1);
  const out = textFlag(context, "out") ?? "dist";
  const resolution = textFlag(context, "resolution");
  if (resolution !== undefined && resolution !== "sibling" && resolution !== "registry") {
    throw usageError(context, "`--resolution` must be `sibling` or `registry`.");
  }
  try {
    const apps = await packageApps(pack, out, {
      builder: textFlag(context, "builder") ?? DEFAULT_BUILDER,
      resolution,
    });
    context.out.emit(
      { out, apps },
      (styles) => `${styles.green("packaged")} ${apps.length} app(s) → ${out}/w6w`,
    );
  } catch (error) {
    if (error instanceof PackageFailure) throw new Error(error.message);
    throw error;
  }
};

export const APP_COMMANDS: CommandRegistry = {
  "apps by-ids": byIds,
  "apps build": appsBuild,
  "apps list": listManagedApps,
  "apps package": appsPackage,
  "apps publish": appsPublish,
  "apps search": search,
};
