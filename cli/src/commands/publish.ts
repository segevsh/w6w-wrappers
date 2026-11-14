/**
 * `w6w apps publish [dir] [--version <semver>] [--builder <spec>]` — build an app
 * folder with the canonical builder and upload the artifact to the caller's own
 * private catalog (`appManagement.publishArtifact`, `POST /app-management/artifacts`).
 *
 * The build is {@linkcode runBuilder} through the same seam as `apps build`, into a
 * temp directory that is removed on every path (success, build failure, upload
 * refusal). The upload carries the built `manifest.json`, `app.js` and, if present,
 * `app.js.map`; what is printed is **the server's** answer (`id`, `version`,
 * `outcome`, `target`), never the local version.
 *
 * `--version` (R14) rewrites the app's `package.json` `version` in place BEFORE the
 * build, after a strict semver check; a bad value is a usage error with nothing built
 * or sent. Absent, `package.json` is untouched.
 *
 * Credential surface: there is no token flag or argument. Authentication is the CLI's
 * ordinary client resolution (`context.client()`: login, config store, environment),
 * the request goes only to the configured base URL, and no request body, bearer or
 * base64 is ever written to a stream — a refusal prints its `code: message` only.
 *
 * @module
 */

import type { CommandContext, CommandHandler } from "../../mod.ts";
import {
  appDir,
  builderArgs,
  DEFAULT_BUILDER,
  resolveResolution,
  runBuilder,
  type ToolchainResult,
} from "../app-toolchain.ts";
import { EXIT_SUCCESS } from "../exit.ts";
import type { Styles } from "../output.ts";
import { noExtraArguments, textFlag, usageError } from "./shared.ts";
import { ApiError } from "@w6w/sdk";

interface Fs {
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: string): Promise<void>;
  mkdtemp(prefix: string): Promise<string>;
  rm(path: string, options: { recursive: true; force: true }): Promise<void>;
}

interface Path {
  join(...parts: string[]): string;
}

interface Host {
  fs: Fs;
  path: Path;
  tmpdir(): string;
}

let hostPromise: Promise<Host> | undefined;

/** The `node:` built-ins, imported by variable so the npm build needs no host types. */
function host(): Promise<Host> {
  hostPromise ??= (async () => {
    const fsName = "node:fs/promises";
    const pathName = "node:path";
    const osName = "node:os";
    return {
      fs: (await import(fsName)) as Fs,
      path: (await import(pathName)) as Path,
      tmpdir: ((await import(osName)) as { tmpdir(): string }).tmpdir,
    };
  })();
  return hostPromise;
}

/** Strict semver 2.0.0: `MAJOR.MINOR.PATCH` with optional pre-release and build parts. */
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/** Rewrites `package.json`'s `version`, keeping its indentation and trailing newline. */
async function setVersion(
  context: CommandContext,
  h: Host,
  dir: string,
  version: string,
): Promise<void> {
  const file = h.path.join(dir, "package.json");
  let text: string;
  try {
    text = decode(await h.fs.readFile(file));
  } catch {
    throw usageError(context, `\`--version\` needs a \`package.json\` in \`${dir}\`.`);
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw usageError(context, `\`${file}\` is not valid JSON.`);
  }
  if (!isObject(data)) throw usageError(context, `\`${file}\` is not a JSON object.`);
  const indent = /^[ \t]+(?=")/m.exec(text)?.[0] ?? 2;
  data.version = version;
  await h.fs.writeFile(
    file,
    JSON.stringify(data, null, indent) + (text.endsWith("\n") ? "\n" : ""),
  );
}

/** The last few lines the builder wrote, quoted in a failure nobody can read otherwise. */
function said(result: ToolchainResult): string {
  const stream = result.stderr.trim() === "" ? result.stdout : result.stderr;
  return stream.split("\n").map((line) => line.trim()).filter((line) => line !== "").slice(-5)
    .join("\n");
}

/** `id`/`version` of the one app the builder just wrote to `<out>/index.json`. */
async function builtEntry(h: Host, out: string, dir: string): Promise<[string, string]> {
  const indexPath = h.path.join(out, "index.json");
  let index: unknown;
  try {
    index = JSON.parse(decode(await h.fs.readFile(indexPath)));
  } catch {
    throw new Error(
      `the app builder wrote no readable \`index.json\`, so \`${dir}\` was not built.`,
    );
  }
  const apps = isObject(index) && Array.isArray(index.apps) ? index.apps : [];
  const entry = apps[0];
  if (
    apps.length !== 1 || !isObject(entry) || typeof entry.id !== "string" ||
    typeof entry.version !== "string" || entry.id === "" || entry.version === ""
  ) {
    throw new Error(
      `the builder's \`index.json\` does not carry exactly one app with an id and version.`,
    );
  }
  return [entry.id, entry.version];
}

const appsPublish: CommandHandler = async (context) => {
  const dir = await appDir(context.invocation.positionals[0]);
  noExtraArguments(context, 1);

  const version = textFlag(context, "version");
  const spec = textFlag(context, "builder") ?? DEFAULT_BUILDER;
  if (version !== undefined && !SEMVER.test(version)) {
    throw usageError(
      context,
      `\`--version\` must be a semantic version (e.g. 1.2.3), got \`${version}\`.`,
    );
  }

  const h = await host();
  const resolution = await resolveResolution(dir);
  if (version !== undefined) await setVersion(context, h, dir, version);

  const out = await h.fs.mkdtemp(h.path.join(h.tmpdir(), "w6w-publish-"));
  try {
    const result = await runBuilder(
      await builderArgs(spec, dir, "build", { out, resolution }),
      dir,
    );
    if (result.code !== 0) {
      const detail = said(result);
      throw new Error(
        `the app builder could not build \`${dir}\` (exit ${result.code}).` +
          (detail === "" ? "" : `\n${detail}`),
      );
    }
    const [id, built] = await builtEntry(h, out, dir);
    const at = h.path.join(out, id, built);
    const read = async (name: string) => await h.fs.readFile(h.path.join(at, name));
    let artifact: unknown;
    try {
      artifact = JSON.parse(decode(await read("manifest.json")));
    } catch {
      throw new Error(`the builder wrote no readable \`manifest.json\` for \`${id}@${built}\`.`);
    }
    if (!isObject(artifact)) throw new Error("the built `manifest.json` is not a JSON object.");
    const exec = await read("app.js");
    let map: Uint8Array | undefined;
    try {
      map = await read("app.js.map");
    } catch {
      map = undefined; // the map is optional
    }

    let published;
    try {
      published = await context.client().appManagement.publishArtifact(
        map === undefined ? { artifact, exec } : { artifact, exec, map },
      );
    } catch (error) {
      // Only the server's code and message are surfaced — never the request or `raw`.
      if (error instanceof ApiError) {
        throw new ApiError(error.status, error.code, `${error.code}: ${error.message}`, null);
      }
      throw error;
    }
    context.out.emit(
      published,
      (styles: Styles) =>
        `${styles.green(published.outcome)} ${
          styles.bold(`${published.id}@${published.version}`)
        } (${published.target})`,
    );
    return EXIT_SUCCESS;
  } finally {
    await h.fs.rm(out, { recursive: true, force: true });
  }
};

export { appsPublish };
