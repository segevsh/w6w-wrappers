/**
 * `w6w assets …` — uploads and assets at the command line.
 *
 * Two layers, one file:
 *
 * - **One SDK call each** for every contract operation (`upload-create`,
 *   `upload-put`, `upload-finalize`, `upload-status`, `upload-abort`, `get`,
 *   `versions`, `files`, `content`, `archive-download`, `archive`, `purge`).
 * - **`assets upload <dir|zip>`**, the one command that is a workflow rather than
 *   a call: walk a directory, hash every file, reserve the upload, send each
 *   entry's bytes, finalize.
 *
 * ── The upload's three rules ──
 *
 * 1. **A symlink aborts the whole upload before the first request.** The server
 *    rejects links in a package; refusing here too means nothing is reserved, and
 *    nothing is left half-sent, for a tree the host would refuse anyway. Links are
 *    never followed — a link out of the tree must not read the file it points at.
 * 2. **Each file is read once, and the digest is of the bytes that are sent.** The
 *    reserve call declares every sha256 before any byte moves, so the bytes are
 *    held between hashing and sending rather than re-read: a file edited in
 *    between cannot send content that disagrees with its declaration.
 * 3. **`--retry` resumes, it never re-sends what arrived.** The reserve call is
 *    replayed under a key derived from the manifest (same tree ⇒ same upload), the
 *    upload is read back with `GET /asset-uploads/:id`, and every entry already
 *    `received` is skipped. Without `--retry` the key is random, so a second run
 *    is a new upload and never silently resumes an old one.
 *
 * Progress goes to **stderr**, one line per entry, so `--json` on stdout stays one
 * parseable document. A uniform `404 not_found` is an ordinary `ApiError`, which
 * `main()` reports on one line with exit `2`; nothing here prints a stack trace.
 *
 * @module
 */

import type { CommandContext, CommandHandler, CommandRegistry } from "../../mod.ts";
import type {
  Asset,
  AssetFile,
  AssetUploadCreateInput,
  AssetUploadEntryInput,
  AssetUploadPurpose,
  AssetVersion,
} from "@w6w/sdk";
import type { Styles } from "../output.ts";
import { argument, noExtraArguments, requiredFlag, table, textFlag, usageError } from "./shared.ts";

// ---------------------------------------------------------------------------
// Host seam — files and raw stdout, probed rather than assumed.
// ---------------------------------------------------------------------------

/** A directory entry, as `readdir({ withFileTypes: true })` reports it. */
interface Dirent {
  name: string;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

/** The slice of `node:fs/promises` this module uses. Structural: no host types needed. */
interface Fs {
  readdir(path: string, options: { withFileTypes: true }): Promise<Dirent[]>;
  lstat(path: string): Promise<{ isSymbolicLink(): boolean; isDirectory(): boolean }>;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
}

let fsPromise: Promise<Fs> | undefined;

/** `node:fs/promises`, imported by variable so the npm build does not need Deno types. */
function fs(): Promise<Fs> {
  const specifier = "node:fs/promises";
  fsPromise ??= import(specifier) as Promise<Fs>;
  return fsPromise;
}

/** Writes raw bytes to stdout. */
type StdoutBytes = (bytes: Uint8Array) => Promise<void>;

interface HostGlobals {
  Deno?: { stdout: { write(bytes: Uint8Array): Promise<number> } };
  process?: { stdout: { write(bytes: Uint8Array, done: (error?: Error | null) => void): unknown } };
}

const hostStdout: StdoutBytes = async (bytes) => {
  const host = globalThis as unknown as HostGlobals;
  if (host.Deno) {
    let offset = 0;
    while (offset < bytes.length) offset += await host.Deno.stdout.write(bytes.subarray(offset));
    return;
  }
  const proc = host.process;
  if (!proc) throw new Error("no standard output is available to write bytes to.");
  await new Promise<void>((resolve, reject) =>
    proc.stdout.write(bytes, (error) => error ? reject(error) : resolve())
  );
};

let stdoutBytes: StdoutBytes = hostStdout;

/**
 * Replace the raw-stdout writer — the test suite's seam, mirroring the injectable
 * `io` every other command writes through (text goes through `Output`, which has
 * no byte channel). Returns a function that restores the previous writer.
 */
export function useStdoutBytes(writer: StdoutBytes): () => void {
  const previous = stdoutBytes;
  stdoutBytes = writer;
  return () => {
    stdoutBytes = previous;
  };
}

// ---------------------------------------------------------------------------
// Walking and hashing a directory.
// ---------------------------------------------------------------------------

/** One file ready to send: its package path, its bytes, and the digest of those bytes. */
interface LocalEntry {
  path: string;
  bytes: Uint8Array;
  sha256: string;
}

/** Lowercase hex sha256 of exactly these bytes. */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function joinPath(base: string, name: string): string {
  return base.endsWith("/") || base.endsWith("\\") ? `${base}${name}` : `${base}/${name}`;
}

/**
 * List every file under `root` as `/`-separated relative paths, sorted.
 *
 * Symlinks (and anything that is neither a file nor a directory) are collected
 * rather than followed or skipped: the caller refuses the whole upload if any
 * exist.
 */
async function walk(root: string): Promise<{ files: string[]; refused: string[] }> {
  const host = await fs();
  const files: string[] = [];
  const refused: string[] = [];
  const visit = async (dir: string, prefix: string): Promise<void> => {
    for (const entry of await host.readdir(dir, { withFileTypes: true })) {
      const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isSymbolicLink()) refused.push(relative);
      else if (entry.isDirectory()) await visit(joinPath(dir, entry.name), relative);
      else if (entry.isFile()) files.push(relative);
      else refused.push(relative);
    }
  };
  await visit(root, "");
  files.sort();
  refused.sort();
  return { files, refused };
}

/** The basename of a path, either separator. */
function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? path;
}

/**
 * Resolve what `assets upload` was pointed at into the entries to send.
 *
 * Makes **no API request** — every refusal (a symlink, an empty tree, a missing
 * path) happens here, before the client is even built.
 */
async function collect(
  context: CommandContext,
  target: string,
): Promise<{ entries: LocalEntry[]; archive: boolean }> {
  const host = await fs();
  let stat: Awaited<ReturnType<Fs["lstat"]>>;
  try {
    stat = await host.lstat(target);
  } catch {
    throw usageError(context, `\`${target}\` does not exist.`);
  }
  if (stat.isSymbolicLink()) {
    throw usageError(
      context,
      `\`${target}\` is a symlink. Links are never followed; point at the real path.`,
    );
  }
  if (!stat.isDirectory()) {
    if (!/\.zip$/i.test(target)) {
      throw usageError(context, `\`${target}\` must be a directory or a .zip file.`);
    }
    const bytes = await host.readFile(target);
    return {
      archive: true,
      entries: [{ path: basename(target), bytes, sha256: await sha256Hex(bytes) }],
    };
  }
  const { files, refused } = await walk(target);
  if (refused.length > 0) {
    throw usageError(
      context,
      `Refusing to upload: \`${target}\` contains ${refused.length} symlink(s) or special ` +
        `file(s), which are never followed:\n${refused.map((p) => `  ${p}`).join("\n")}\n` +
        `No request was made.`,
    );
  }
  if (files.length === 0) throw usageError(context, `\`${target}\` has no files to upload.`);
  const entries: LocalEntry[] = [];
  for (const path of files) {
    const bytes = await host.readFile(joinPath(target, path));
    entries.push({ path, bytes, sha256: await sha256Hex(bytes) });
  }
  return { entries, archive: false };
}

/** A key that is the same for the same manifest — what makes `--retry` a replay. */
async function manifestKey(input: AssetUploadCreateInput, archive: boolean): Promise<string> {
  const manifest = JSON.stringify({
    purpose: input.purpose,
    target: input.target ?? null,
    archive,
    entries: input.entries.map((e) => [e.path, e.sizeBytes, e.sha256]),
  });
  return `cli-${await sha256Hex(new TextEncoder().encode(manifest))}`;
}

// ---------------------------------------------------------------------------
// `assets upload`.
// ---------------------------------------------------------------------------

const upload: CommandHandler = async (context) => {
  const target = argument(context, 0, "a directory or .zip file to upload");
  noExtraArguments(context, 1);

  const purpose = requiredFlag(context, "purpose", "--purpose skill|context");
  if (purpose !== "skill" && purpose !== "context") {
    throw usageError(context, "`--purpose` must be `skill` or `context`.");
  }
  const skill = textFlag(context, "skill");
  const collection = textFlag(context, "collection");
  if (skill !== undefined && collection !== undefined) {
    throw usageError(context, "`--skill` and `--collection` cannot be combined.");
  }
  if (skill !== undefined && purpose !== "skill") {
    throw usageError(context, "`--skill` only applies to `--purpose skill`.");
  }
  if (collection !== undefined && purpose !== "context") {
    throw usageError(context, "`--collection` only applies to `--purpose context`.");
  }
  const retry = context.invocation.options.retry === true;

  // Everything that can refuse does so here — before a client exists, so before a request.
  const { entries, archive } = await collect(context, target);

  const input: AssetUploadCreateInput = {
    purpose: purpose as AssetUploadPurpose,
    idempotencyKey: "",
    entries: entries.map((e): AssetUploadEntryInput => ({
      path: e.path,
      sizeBytes: e.bytes.length,
      sha256: e.sha256,
    })),
    name: basename(target.replace(/\.zip$/i, "")),
    ...(skill !== undefined
      ? { target: { skillId: skill } }
      : collection !== undefined
      ? { target: { collectionId: collection } }
      : {}),
  };
  input.idempotencyKey = retry ? await manifestKey(input, archive) : crypto.randomUUID();

  const uploads = context.client().assets.uploads;
  // `archive` is the server's own field for a single-ZIP upload; the SDK type predates it.
  const created = await uploads.create(
    archive ? { ...input, archive: true } as typeof input : input,
  );
  const id = created.upload.id;
  const status = retry ? await uploads.get(id) : created;

  const pending = status.entries.filter((e) => e.state !== "received");
  const skipped = status.entries.length - pending.length;
  context.out.error(
    `upload ${id}: ${entries.length} file(s)` +
      (skipped > 0 ? `, ${skipped} already received` : ""),
  );
  let sent = 0;
  for (const entry of pending) {
    const local = entries[entry.index];
    if (!local || local.path !== entry.path || local.sha256 !== entry.sha256) {
      throw new Error(
        `upload ${id} entry ${entry.index} (${entry.path}) does not match the local files; ` +
          `the tree changed since it was reserved. Run again without --retry.`,
      );
    }
    sent += 1;
    context.out.error(
      `[${sent}/${pending.length}] ${entry.path} (${local.bytes.length} bytes)`,
    );
    await uploads.putEntry(id, entry.index, local.bytes);
  }

  const result = await uploads.finalize(id);
  context.out.emit(
    result,
    (styles: Styles) =>
      `${styles.green("Published")} asset ${result.assetId} version ${result.version} ` +
      `(${result.readiness})`,
  );
};

// ---------------------------------------------------------------------------
// One SDK call each.
// ---------------------------------------------------------------------------

function text(value: unknown): string {
  return typeof value === "string"
    ? value
    : value === undefined || value === null
    ? "-"
    : String(value);
}

function printJson(context: CommandContext, value: unknown): void {
  context.out.emit(value, () => JSON.stringify(value, null, 2));
}

/** A flag whose value must be a JSON value of the given shape. */
function jsonFlag(context: CommandContext, name: string, array: boolean): unknown {
  const raw = textFlag(context, name);
  if (raw === undefined) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw usageError(context, `\`--${name}\` must be valid JSON.`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value) !== array) {
    throw usageError(context, `\`--${name}\` must be a JSON ${array ? "array" : "object"}.`);
  }
  return value;
}

/**
 * `assets upload-create` — the reserve call, one flag per contract parameter.
 * (`assets upload` is the command that builds this from a directory.)
 */
const uploadCreate: CommandHandler = async (context) => {
  noExtraArguments(context, 0);
  const purpose = requiredFlag(context, "purpose", "--purpose asset|skill|context");
  const idempotencyKey = requiredFlag(context, "idempotencyKey", "--idempotency-key <key>");
  const entries = jsonFlag(context, "entries", true);
  if (entries === undefined) throw usageError(context, "needs `--entries <json>`.");
  const input = {
    purpose,
    idempotencyKey,
    entries,
    name: textFlag(context, "name"),
    visibility: textFlag(context, "visibility"),
    assetId: textFlag(context, "assetId"),
    target: jsonFlag(context, "target", false),
  };
  // `undefined` fields drop out of the JSON body: an absent flag sends nothing.
  printJson(context, await context.client().assets.uploads.create(input as AssetUploadCreateInput));
};

const uploadPut: CommandHandler = async (context) => {
  const id = argument(context, 0, "an upload id");
  const indexText = argument(context, 1, "an entry index");
  noExtraArguments(context, 2);
  if (!/^[0-9]+$/.test(indexText)) throw usageError(context, "The entry index must be an integer.");
  const file = requiredFlag(context, "file", "--file <path>");
  let bytes: Uint8Array;
  try {
    bytes = await (await fs()).readFile(file);
  } catch {
    throw usageError(context, `Cannot read \`${file}\`.`);
  }
  printJson(context, await context.client().assets.uploads.putEntry(id, Number(indexText), bytes));
};

const uploadFinalize: CommandHandler = async (context) => {
  const id = argument(context, 0, "an upload id");
  noExtraArguments(context, 1);
  printJson(context, await context.client().assets.uploads.finalize(id));
};

const uploadStatus: CommandHandler = async (context) => {
  const id = argument(context, 0, "an upload id");
  noExtraArguments(context, 1);
  const status = await context.client().assets.uploads.get(id);
  context.out.emit(status, (styles: Styles) =>
    [
      `${status.upload.id}  ${status.upload.status}`,
      table(
        ["INDEX", "STATE", "PATH"],
        status.entries.map((e) => [String(e.index), e.state, e.path]),
        styles,
      ),
    ].join("\n"));
};

const uploadAbort: CommandHandler = async (context) => {
  const id = argument(context, 0, "an upload id");
  noExtraArguments(context, 1);
  printJson(context, await context.client().assets.uploads.abort(id));
};

const getAsset: CommandHandler = async (context) => {
  const id = argument(context, 0, "an asset id");
  noExtraArguments(context, 1);
  const asset: Asset = await context.client().assets.get(id);
  printJson(context, asset);
};

const versions: CommandHandler = async (context) => {
  const id = argument(context, 0, "an asset id");
  noExtraArguments(context, 1);
  const list = await context.client().assets.versions(id);
  context.out.emit(list, (styles: Styles) => {
    if (list.length === 0) return styles.dim("No versions.");
    return table(
      ["VERSION", "ID", "READINESS"],
      list.map((v: AssetVersion) => [text(v.version), v.id, text(v.readiness)]),
      styles,
    );
  });
};

const files: CommandHandler = async (context) => {
  const id = argument(context, 0, "an asset id");
  const versionId = argument(context, 1, "a version id (see: `w6w assets versions`)");
  noExtraArguments(context, 2);
  const listing = await context.client().assets.files(id, versionId);
  context.out.emit(listing, (styles: Styles) => {
    if (listing.files.length === 0) return styles.dim("No files.");
    return table(
      ["ID", "SIZE", "PATH"],
      listing.files.map((f: AssetFile) => [f.id, text(f.sizeBytes), f.path]),
      styles,
    );
  });
};

/** Write downloaded bytes to `--out`, or to stdout when it is absent. */
async function deliver(context: CommandContext, bytes: Uint8Array): Promise<void> {
  const out = textFlag(context, "out");
  if (out === undefined) {
    await stdoutBytes(bytes);
    return;
  }
  try {
    await (await fs()).writeFile(out, bytes);
  } catch {
    throw usageError(context, `Cannot write \`${out}\`.`);
  }
  context.out.emit(
    { path: out, bytes: bytes.length },
    () => `Wrote ${bytes.length} bytes to ${out}`,
  );
}

const content: CommandHandler = async (context) => {
  const id = argument(context, 0, "an asset id");
  const versionId = argument(context, 1, "a version id");
  const fileId = argument(context, 2, "a file id (see: `w6w assets files`)");
  noExtraArguments(context, 3);
  await deliver(context, await context.client().assets.content(id, versionId, fileId));
};

const archiveDownload: CommandHandler = async (context) => {
  const id = argument(context, 0, "an asset id");
  const versionId = argument(context, 1, "a version id");
  noExtraArguments(context, 2);
  await deliver(context, await context.client().assets.archiveDownload(id, versionId));
};

const archiveAsset: CommandHandler = async (context) => {
  const id = argument(context, 0, "an asset id");
  noExtraArguments(context, 1);
  printJson(context, await context.client().assets.archive(id));
};

const purge: CommandHandler = async (context) => {
  const id = argument(context, 0, "an asset id");
  noExtraArguments(context, 1);
  printJson(context, await context.client().assets.purge(id));
};

/** The `assets` commands, keyed by canonical command path. */
export const ASSET_COMMANDS: CommandRegistry = {
  "assets upload": upload,
  "assets upload-create": uploadCreate,
  "assets upload-put": uploadPut,
  "assets upload-finalize": uploadFinalize,
  "assets upload-status": uploadStatus,
  "assets upload-abort": uploadAbort,
  "assets get": getAsset,
  "assets versions": versions,
  "assets files": files,
  "assets content": content,
  "assets archive-download": archiveDownload,
  "assets archive": archiveAsset,
  "assets purge": purge,
};
