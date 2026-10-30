/**
 * `w6w build app <folder> [--out <dir>] [--pack <file>]` — turn an app folder into a
 * self-describing bundle, locally.
 *
 * Declared in `endpoints.json` `cli.commands[]` (CLI-only: no API operation sits behind
 * it, so the node and python lanes do not implement it). It never touches the network.
 *
 * The folder is a Node package: a `package.json` with a `w6w` block, `version`,
 * `scripts.test`, `scripts.build` and a `main` that names the built single-file ESM
 * bundle. The command runs `npm run test`, then `npm run build` (both streamed to
 * stderr so `--json` stdout stays one document), and then writes, under the output
 * directory:
 *
 * - `app.js` — the built file, byte for byte; its sha256 is the app's **digest**;
 * - `manifest.json` — deterministic (no timestamps), with the app's definition read
 *   by importing the built file, and the names of its function-valued hooks. Every
 *   relative file the `w6w` block points at (icons) is embedded in its `app` block as a
 *   `data:` URI, so the bundle is self-contained.
 *
 * Nothing is written unless the tests and the build both pass. With `--pack`, the
 * pack or index file is updated with the app's `id`, `version` and `digest` — a
 * re-read, modify and rename done under an exclusive `<pack>.lock`, so many builds may
 * share one pack concurrently.
 *
 * Host access follows the package's rule (see `src/store-fs.ts`): `node:` modules are
 * imported through a non-literal specifier with structural types, so this compiles
 * under the npm build's `"types": []` and runs under Deno and Node alike. The `npm`
 * process is behind {@linkcode useBuildRunner}, the test suite's seam.
 *
 * @module
 */

import type { CommandContext, CommandHandler, CommandRegistry } from "../../mod.ts";
import { VERSION } from "../../mod.ts";
import { argument, noExtraArguments, textFlag, usageError } from "./shared.ts";

// ---------------------------------------------------------------------------
// Host seam
// ---------------------------------------------------------------------------

interface Stat {
  isFile(): boolean;
}

interface Fs {
  readFile(path: string): Promise<Uint8Array>;
  readFile(path: string, encoding: "utf8"): Promise<string>;
  writeFile(path: string, data: Uint8Array | string): Promise<void>;
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
  fileUrl(path: string): string;
}

let hostPromise: Promise<Host> | undefined;

/** The `node:` built-ins, imported by variable so the npm build needs no host types. */
function host(): Promise<Host> {
  hostPromise ??= (async () => {
    const fsName = "node:fs/promises";
    const pathName = "node:path";
    const urlName = "node:url";
    const fs = (await import(fsName)) as Fs;
    const path = (await import(pathName)) as Path;
    const url = (await import(urlName)) as { pathToFileURL(path: string): { href: string } };
    return { fs, path, fileUrl: (p) => url.pathToFileURL(p).href };
  })();
  return hostPromise;
}

/** Runs `npm <args>` in `cwd` with its output on stderr; resolves to the exit code. */
export type BuildRunner = (args: string[], cwd: string) => Promise<number>;

interface SpawnedChild {
  on(event: "error", listener: (error: Error) => void): unknown;
  on(event: "close", listener: (code: number | null) => void): unknown;
}

const hostRunner: BuildRunner = async (args, cwd) => {
  const name = "node:child_process";
  const { spawn } = (await import(name)) as {
    spawn(
      command: string,
      args: string[],
      options: { cwd: string; stdio: unknown[]; shell: boolean },
    ): SpawnedChild;
  };
  const windows = (globalThis as { process?: { platform?: string } }).process?.platform ===
      "win32" ||
    (globalThis as { Deno?: { build?: { os?: string } } }).Deno?.build?.os === "windows";
  return await new Promise<number>((resolve, reject) => {
    // stdout is redirected to stderr (fd 2) so the command's own stdout stays clean.
    const child = spawn("npm", args, { cwd, stdio: ["ignore", 2, 2], shell: windows });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
};

let runner: BuildRunner = hostRunner;

/**
 * Replace the `npm` runner — the test suite's seam. Returns a function that restores
 * the previous one.
 */
export function useBuildRunner(replacement: BuildRunner): () => void {
  const previous = runner;
  runner = replacement;
  return () => {
    runner = previous;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function isFile(fs: Fs, path: string): Promise<boolean> {
  try {
    return (await fs.stat(path)).isFile();
  } catch {
    return false;
  }
}

async function readJson(fs: Fs, path: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(path, "utf8"));
}

function toJson(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Names of an item's function-valued properties, in declaration order. */
function hookNames(item: unknown): string[] {
  if (!isObject(item)) return [];
  return Object.keys(item).filter((key) => typeof item[key] === "function");
}

/** The JSON form of one definition item, plus the hooks it carries. */
function describeItem(item: unknown): unknown {
  const plain = JSON.parse(JSON.stringify(item ?? null)) as unknown;
  if (!isObject(plain)) return plain;
  return { ...plain, hooks: hookNames(item) };
}

const DEFINITION_LISTS = ["actions", "auth", "triggers", "healthChecks"] as const;

function describeDefinition(definition: unknown): Json {
  if (!isObject(definition)) {
    throw new Error("the built file's default export is not an app definition (an object).");
  }
  const result: Json = {};
  for (const key of DEFINITION_LISTS) {
    const value = definition[key];
    const list = value === undefined || value === null
      ? []
      : Array.isArray(value)
      ? value
      : [value];
    result[key] = list.map(describeItem);
  }
  for (const key of Object.keys(definition)) {
    if ((DEFINITION_LISTS as readonly string[]).includes(key)) continue;
    const value = definition[key];
    if (typeof value === "function" || value === undefined) continue;
    result[key] = JSON.parse(JSON.stringify(value)) as unknown;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Pack file
// ---------------------------------------------------------------------------

interface PackEntry {
  id: string;
  version: string;
  digest: string;
}

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

/** Validates the pack up front, so a bad file fails before test/build. */
async function checkPack(context: CommandContext, h: Host, packFlag: string): Promise<PackFile> {
  const path = h.path.resolve(packFlag);
  const data = parsePack(context, packFlag, await readPackText(h, path));
  return { path, dir: h.path.dirname(path), data };
}

function updatePack(h: Host, pack: PackFile, folder: string, entry: PackEntry): void {
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
  entry: PackEntry,
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
// Assets
// ---------------------------------------------------------------------------

const MIME_TYPES: Record<string, string> = {
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  ico: "image/x-icon",
};

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/**
 * Every string leaf of `value` that names an existing relative file, replaced in place by
 * a `data:` URI. `http(s):` and `data:` values are not relative paths and stay as they are.
 */
async function embedAssets(
  h: Host,
  folder: string,
  value: unknown,
  skip: Set<string>,
  context: CommandContext,
): Promise<unknown> {
  if (typeof value === "string") {
    if (!(value.startsWith("./") || value.startsWith("../"))) return value;
    const source = h.path.resolve(folder, value);
    if (skip.has(source) || !(await isFile(h.fs, source))) return value;
    const dot = source.lastIndexOf(".");
    const extension = dot < 0 ? "" : source.slice(dot + 1).toLowerCase();
    const mime = MIME_TYPES[extension];
    if (mime === undefined) {
      throw usageError(
        context,
        `cannot embed \`${value}\`: unsupported asset type \`${
          extension ? "." + extension : "(none)"
        }\` ` +
          `(supported: ${Object.keys(MIME_TYPES).map((e) => "." + e).join(", ")}).`,
      );
    }
    return `data:${mime};base64,${base64(await h.fs.readFile(source))}`;
  }
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const item of value) out.push(await embedAssets(h, folder, item, skip, context));
    return out;
  }
  if (isObject(value)) {
    const out: Json = {};
    for (const key of Object.keys(value)) {
      out[key] = await embedAssets(h, folder, value[key], skip, context);
    }
    return out;
  }
  return value;
}

// ---------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------

const buildApp: CommandHandler = async (context) => {
  const folderArg = argument(context, 0, "an app folder, like `./apps/2chat`");
  noExtraArguments(context, 1);
  const outFlag = textFlag(context, "out");
  const packFlag = textFlag(context, "pack");

  const h = await host();
  const { fs, path } = h;
  const folder = path.resolve(folderArg);

  // 1. package.json
  const packagePath = path.join(folder, "package.json");
  let pkg: unknown;
  try {
    pkg = await readJson(fs, packagePath);
  } catch (error) {
    const reason = error instanceof SyntaxError ? "is not valid JSON" : "could not be read";
    throw usageError(context, `\`${packagePath}\` ${reason}.`);
  }
  if (!isObject(pkg)) throw usageError(context, `\`${packagePath}\` is not a JSON object.`);
  const block = pkg.w6w;
  const scripts = isObject(pkg.scripts) ? pkg.scripts : {};
  const missing: string[] = [];
  if (!isObject(block) || !nonEmptyString(block.id)) missing.push("w6w.id");
  if (!nonEmptyString(pkg.version)) missing.push("version");
  if (!nonEmptyString(scripts.test)) missing.push("scripts.test");
  if (!nonEmptyString(scripts.build)) missing.push("scripts.build");
  if (!nonEmptyString(pkg.main)) missing.push("main");
  if (missing.length > 0) {
    throw usageError(context, `\`${packagePath}\` is missing: ${missing.join(", ")}.`);
  }
  const w6w = block as Json;
  const id = w6w.id as string;
  const version = pkg.version as string;

  const pack = packFlag === undefined ? undefined : await checkPack(context, h, packFlag);

  // 2-3. test, then build
  for (const script of ["test", "build"]) {
    const code = await runner(["run", script], folder);
    if (code !== 0) {
      throw new Error(`\`npm run ${script}\` failed with exit code ${code}. Nothing was written.`);
    }
  }

  // 4. the built file
  const builtFile = path.resolve(folder, pkg.main as string);
  if (!(await isFile(fs, builtFile))) {
    throw new Error(`the build did not produce \`${builtFile}\` (package.json \`main\`).`);
  }
  const bytes = await fs.readFile(builtFile);
  const digest = await sha256Hex(bytes);

  // 7. definition (before anything is written, so an unloadable bundle writes nothing)
  let definition: Json;
  try {
    const module = (await import(h.fileUrl(builtFile))) as { default?: unknown };
    definition = describeDefinition(module.default);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`could not load \`${builtFile}\`: ${reason}`);
  }

  // 6. assets (resolved before writing, for the same reason)
  const appBlock: Json = { ...w6w };
  const skip = new Set<string>();
  if (typeof appBlock.entry === "string") skip.add(path.resolve(folder, appBlock.entry));
  delete appBlock.entry;
  delete appBlock.build;
  delete appBlock.internal;
  const app = await embedAssets(h, folder, appBlock, skip, context) as Json;

  // 5. output
  const out = outFlag === undefined ? path.dirname(builtFile) : path.resolve(outFlag);
  await fs.mkdir(out, { recursive: true });
  const execTarget = path.join(out, "app.js");
  if (path.resolve(execTarget) !== builtFile) await fs.writeFile(execTarget, bytes);

  // 8. manifest
  const manifest = {
    manifestVersion: "1",
    id,
    name: pkg.name,
    version,
    description: pkg.description,
    license: pkg.license,
    app,
    exec: { file: "app.js", sha256: digest, bytes: bytes.length, format: "esm" },
    digest,
    definition,
    builder: `@w6w/cli@${VERSION}`,
  };
  await fs.writeFile(path.join(out, "manifest.json"), toJson(manifest));

  // 9. pack
  if (pack) {
    await commitPack(context, h, packFlag as string, pack, folder, { id, version, digest });
  }

  // 10. result
  const files = ["app.js", "manifest.json"];
  const payload = {
    id,
    version,
    digest,
    out,
    files,
    ...(pack ? { pack: pack.path } : {}),
  };
  context.out.emit(
    payload,
    () => `built ${id}@${version} → ${out} (sha256 ${digest.slice(0, 12)})`,
  );
};

/** `w6w build app`. */
export const BUILD_COMMANDS: CommandRegistry = {
  "build app": buildApp,
};
