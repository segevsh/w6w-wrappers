/**
 * `w6w apps build [dir] [-o|--out <dir>] [--pack <file>]`
 * `w6w build app <folder> [--out <dir>] [--pack <file>]` — package an app folder into
 * the canonical artifact, locally.
 *
 * Both names are the **same handler**: `build app` predates the `apps` group and is
 * kept as an alias, so a script written against it keeps working and there is one
 * place where a build can go wrong (intake F-2).
 *
 * The CLI compiles nothing. The developer builds their own JavaScript with whatever
 * tool they like; `package.json` names the result (`w6w.entry`, else `main`). This
 * command hands the folder to core's assembler ({@linkcode assemble}, vendored,
 * in-process, Node only), which generates the manifest, inlines the assets, digests,
 * and writes `<out>/<id>/<version>/{app.js,manifest.json}` — plus `app.js.map` when
 * the developer's build produced a source map. The command then writes
 * `<out>/index.json` with the one entry.
 *
 * So the command's stdout is **the index entry** (`id`, `version`, `execSha256`,
 * `digest`, `digestVersion`, `sourceDigest`), emitted as one document. Under `--json`
 * it is that object unchanged; otherwise one line naming the app and where it landed.
 * A refusal is the assembler's own `code: message`, on stderr, exit 1.
 *
 * With `--pack`, the pack file is updated with the built app's canonical entry — a
 * re-read, modify and rename done under an exclusive `<pack>.lock`, so many builds
 * may share one pack concurrently. Host access follows the package's rule (see
 * `src/store-fs.ts`): `node:` modules are imported through a non-literal specifier
 * with structural types. The assembler is behind {@linkcode useAssembler}.
 *
 * @module
 */

import type { CommandContext, CommandHandler, CommandRegistry } from "../../mod.ts";
import { appDir, assemble, type BuildResult } from "../app-toolchain.ts";
import { EXIT_SUCCESS } from "../exit.ts";
import type { Styles } from "../output.ts";
import { noExtraArguments, textFlag, usageError } from "./shared.ts";

// ---------------------------------------------------------------------------
// Host seam
// ---------------------------------------------------------------------------

interface Stat {
  isFile(): boolean;
}

interface Fs {
  readFile(path: string, encoding: "utf8"): Promise<string>;
  writeFile(path: string, data: string): Promise<void>;
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  stat(path: string): Promise<Stat & { mtimeMs: number }>;
  open(path: string, flags: "wx"): Promise<{ close(): Promise<void> }>;
  rename(from: string, to: string): Promise<void>;
  rm(path: string, options: { force: true }): Promise<void>;
}

interface Path {
  resolve(...parts: string[]): string;
  dirname(path: string): string;
  join(...parts: string[]): string;
}

interface Host {
  fs: Fs;
  path: Path;
}

let hostPromise: Promise<Host> | undefined;

/** The `node:` built-ins, imported by variable so the npm build needs no host types. */
function host(): Promise<Host> {
  hostPromise ??= (async () => {
    const fsName = "node:fs/promises";
    const pathName = "node:path";
    return {
      fs: (await import(fsName)) as Fs,
      path: (await import(pathName)) as Path,
    };
  })();
  return hostPromise;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toJson(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}

/**
 * One app's line in `<out>/index.json` — the canonical record, and what this command
 * prints.
 */
export interface BuildEntry {
  id: string;
  version: string;
  execSha256: string;
  digest: string;
  digestVersion?: number;
  sourceDigest: string;
  [key: string]: unknown;
}

/** The index entry for a build: the result minus the local-only fields. */
function entryOf(result: BuildResult): BuildEntry {
  const { id, version, execSha256, digest, digestVersion, sourceDigest } = result;
  return { id, version, execSha256, digest, digestVersion, sourceDigest };
}

// ---------------------------------------------------------------------------
// Pack file
// ---------------------------------------------------------------------------

interface PackFile {
  path: string;
  dir: string;
  data: Json & { apps: Json[] };
}

function parsePack(context: CommandContext, packFlag: string, text: string | undefined) {
  let data: unknown = { apps: [] };
  if (text !== undefined) {
    try {
      data = JSON.parse(text);
    } catch {
      throw usageError(context, `\`${packFlag}\` is not valid JSON.`);
    }
  }
  if (!isObject(data) || !Array.isArray(data.apps)) {
    throw usageError(context, `\`${packFlag}\` has no \`apps\` array.`);
  }
  return data as PackFile["data"];
}

async function readPackText(h: Host, path: string): Promise<string | undefined> {
  try {
    return await h.fs.readFile(path, "utf8");
  } catch {
    return undefined; // a missing pack is created
  }
}

/** Validates the pack up front, so a bad file fails before anything is built. */
async function checkPack(context: CommandContext, h: Host, packFlag: string): Promise<PackFile> {
  const path = h.path.resolve(packFlag);
  const data = parsePack(context, packFlag, await readPackText(h, path));
  return { path, dir: h.path.dirname(path), data };
}

/** Applies the built app's canonical entry: by `path` if a line names this folder, else by `id`. */
function updatePack(h: Host, pack: PackFile, folder: string, entry: BuildEntry): void {
  const apps = pack.data.apps;
  const byPath = apps.find((item) =>
    isObject(item) && typeof item.path === "string" &&
    h.path.resolve(pack.dir, item.path) === folder
  );
  const target = byPath ?? apps.find((item) => isObject(item) && item.id === entry.id);
  if (target) {
    Object.assign(target, entry);
    return;
  }
  apps.push({ ...entry });
}

const LOCK_TIMEOUT_MS = 30_000;
const LOCK_STALE_MS = 30_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Runs `work` while holding `<pack>.lock` (created with `wx`; stale locks are removed). */
async function withPackLock<T>(h: Host, packPath: string, work: () => Promise<T>): Promise<T> {
  const lock = `${packPath}.lock`;
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      await (await h.fs.open(lock, "wx")).close();
      break;
    } catch (error) {
      if ((error as { code?: string }).code !== "EEXIST") throw error;
      try {
        if (Date.now() - (await h.fs.stat(lock)).mtimeMs > LOCK_STALE_MS) {
          await h.fs.rm(lock, { force: true });
          continue;
        }
      } catch {
        continue; // released between the open and the stat: try again at once
      }
      if (Date.now() > deadline) {
        throw new Error(`timed out waiting for the pack lock \`${lock}\`.`);
      }
      await sleep(25 + Math.floor(Math.random() * 75));
    }
  }
  try {
    return await work();
  } finally {
    await h.fs.rm(lock, { force: true });
  }
}

/** Re-reads the pack, applies the entry, and renames a temp file over it, under the lock. */
async function commitPack(
  context: CommandContext,
  h: Host,
  packFlag: string,
  pack: PackFile,
  folder: string,
  entry: BuildEntry,
): Promise<void> {
  await h.fs.mkdir(pack.dir, { recursive: true });
  await withPackLock(h, pack.path, async () => {
    const fresh: PackFile = {
      ...pack,
      data: parsePack(context, packFlag, await readPackText(h, pack.path)),
    };
    updatePack(h, fresh, folder, entry);
    const temp = `${pack.path}.${Math.random().toString(36).slice(2)}.tmp`;
    try {
      await h.fs.writeFile(temp, toJson(fresh.data));
      await h.fs.rename(temp, pack.path);
    } catch (error) {
      await h.fs.rm(temp, { force: true });
      throw error;
    }
  });
}

// ---------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------

/** Where the artifact landed: `<out>/<id>/<version>`. */
function artifactDir(h: Host, out: string, entry: BuildEntry): string {
  return h.path.join(out, entry.id, entry.version);
}

const appsBuild: CommandHandler = async (context) => {
  const dir = await appDir(context.invocation.positionals[0]);
  noExtraArguments(context, 1);

  const outFlag = textFlag(context, "out");
  const packFlag = textFlag(context, "pack");

  const h = await host();
  // Relative to the invocation, not to the app: `-o out` names the same directory
  // wherever the app folder lives. Absent, it is `./out`.
  const out = h.path.resolve(outFlag ?? "out");

  // Before the build, so a malformed pack fails before anything is written.
  const pack = packFlag === undefined ? undefined : await checkPack(context, h, packFlag);

  const result = await assemble(dir, out);
  const entry = entryOf(result);
  await h.fs.writeFile(h.path.join(out, "index.json"), toJson({ apps: [entry], failures: [] }));
  if (pack) await commitPack(context, h, packFlag as string, pack, dir, entry);

  for (const warning of result.warnings ?? []) context.out.note(`warning: ${warning}`);
  context.out.emit(
    entry,
    (styles: Styles) =>
      `${styles.green("built")} ${styles.bold(`${entry.id}@${entry.version}`)} → ${
        artifactDir(h, out, entry)
      }`,
  );
  return EXIT_SUCCESS;
};

/** `w6w build app` — the alias `w6w apps build` is registered under, in `apps.ts`. */
export { appsBuild };

/** `w6w build app` (alias of `apps build`). */
export const BUILD_COMMANDS: CommandRegistry = {
  "build app": appsBuild,
};
