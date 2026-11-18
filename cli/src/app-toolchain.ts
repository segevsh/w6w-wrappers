/**
 * The app toolchain seam — how `w6w apps validate|build|publish` package an app.
 *
 * A w6w app arrives **already built**: the developer bundles their TypeScript (or
 * anything else) into one self-contained JavaScript file with whatever tool they
 * like, and `package.json` names it (`w6w.entry`, else `main`). The CLI compiles
 * nothing. It generates the manifest, inlines the assets, digests the result and
 * writes `<out>/<id>/<version>/{app.js,manifest.json[,app.js.map]}` — the source map
 * is packaged when the developer's build produced one.
 *
 * That packaging is core's `@w6w/app-build` `assembleApp`/`validateAssembled`, the
 * same implementation the first-party pipeline runs, vendored into
 * `src/vendor/app-assemble.js` (`npm run vendor:assemble`) so the CLI needs only
 * Node — no Deno, no JSR, no network. It is loaded on first use, so commands that do
 * not touch apps never pay for it, and it is replaceable through
 * {@linkcode useAssembler} so the unit tests never load it.
 *
 * Host access follows the package's rule: `node:` modules are imported through a
 * non-literal specifier with structural types.
 *
 * @module
 */

/** Size caps the assembler takes; both default to core's own limits. */
export interface AssembleOptions {
  /** Per-asset byte cap. */
  maxAssetBytes?: number;
  /** Per-app inlined-asset byte cap. */
  maxAppAssetBytes?: number;
}

/** What one successful assembly produced. */
export interface BuildResult {
  id: string;
  version: string;
  /** sha-256 (hex) of `app.js`. */
  execSha256: string;
  /** The registry content digest this artifact would register under. */
  digest: string;
  digestVersion: 1 | 2;
  sourceDigest: string;
  /** `<outRoot>/<id>/<version>`, absolute. */
  outDir: string;
  /** Non-fatal findings; absent when there are none. */
  warnings?: string[];
  /** Counts behind the output-contract warnings; absent when all are zero. */
  outputWarnings?: Record<string, number>;
}

/** One reason the assembler refused an app. */
export interface BuilderError {
  code: string;
  message: string;
}

/**
 * The one JSON line `apps validate` prints: `{"ok":true,"id","version"}` on a pass,
 * `{"ok":false,"errors":[{"code","message"}]}` on a refusal.
 *
 * A failure is **data**, not a thrown error — it is the assembler's answer to a
 * question that was asked successfully, which is why the command renders it and
 * exits by it instead of reporting it as a crash.
 */
export type BuilderReport =
  | { ok: true; id: string; version: string }
  | { ok: false; errors: BuilderError[] };

/** The assembler's API — exactly what `src/vendor/app-assemble.js` exports. */
export interface Assembler {
  /** Package one app into `<outRoot>/<id>/<version>/…`. Throws a `BuildError` on refusal. */
  assembleApp(appDir: string, outRoot: string, opts?: AssembleOptions): Promise<BuildResult>;
  /** Run every check `assembleApp` runs, writing nothing. */
  validateAssembled(appDir: string, opts?: AssembleOptions): Promise<BuilderReport>;
}

let replacement: Assembler | undefined;
let vendored: Promise<Assembler> | undefined;

/** The vendored assembler, imported once, on first use. */
function loadVendored(): Promise<Assembler> {
  vendored ??= import("./vendor/app-assemble.js").then((mod) => mod as unknown as Assembler);
  return vendored;
}

/** The assembler in force: the test replacement if one is installed, else the vendored one. */
export function assembler(): Promise<Assembler> {
  return replacement ? Promise.resolve(replacement) : loadVendored();
}

/** Replace the assembler — the test suite's seam. Returns a function that restores it. */
export function useAssembler(fake: Assembler): () => void {
  const previous = replacement;
  replacement = fake;
  return () => {
    replacement = previous;
  };
}

/**
 * A refusal: anything thrown with a string `code` and `message` — core's
 * `BuildError`, recognised by shape so a vendored class and a test double both count.
 */
export function isBuildError(error: unknown): error is Error & BuilderError {
  if (typeof error !== "object" || error === null) return false;
  const e = error as { code?: unknown; message?: unknown };
  return typeof e.code === "string" && e.code !== "" && typeof e.message === "string";
}

/**
 * A refusal as `{code, message}`, the message without the `[code] ` prefix core's
 * `BuildError` puts in front of it — the code is its own field, never said twice.
 */
export function refusal(error: BuilderError): BuilderError {
  const prefix = `[${error.code}] `;
  const message = error.message.startsWith(prefix)
    ? error.message.slice(prefix.length)
    : error.message;
  return { code: error.code, message };
}

/** The `code: message` line a refusal renders as. */
export function refusalLine(error: BuilderError): string {
  const { message } = refusal(error);
  return `${error.code}: ${message}`;
}

/**
 * Package `dir` into `out`. A refusal becomes an `Error` that names the app folder
 * and carries the `code: message` line — `main()` prints it and exits 1.
 */
export async function assemble(dir: string, out: string): Promise<BuildResult> {
  await requireDirectory(dir);
  const { assembleApp } = await assembler();
  try {
    return await assembleApp(dir, out);
  } catch (error) {
    if (!isBuildError(error)) throw error;
    throw new Error(`could not build \`${dir}\`.\n${refusalLine(error)}`);
  }
}

/**
 * Ask whether `dir` would package. A refusal thrown instead of returned is folded
 * into the same `{ok:false}` report, so the command has one answer to render.
 */
export async function validate(dir: string): Promise<BuilderReport> {
  await requireDirectory(dir);
  const { validateAssembled } = await assembler();
  let report: BuilderReport;
  try {
    report = await validateAssembled(dir);
  } catch (error) {
    if (!isBuildError(error)) throw error;
    return { ok: false, errors: [refusal(error)] };
  }
  return report.ok ? report : { ok: false, errors: report.errors.map(refusal) };
}

interface Fs {
  stat(path: string): Promise<{ isDirectory(): boolean }>;
}
interface Path {
  resolve(...parts: string[]): string;
}

async function host(): Promise<{ fs: Fs; path: Path }> {
  const fsName = "node:fs/promises";
  const pathName = "node:path";
  return {
    fs: (await import(fsName)) as Fs,
    path: (await import(pathName)) as Path,
  };
}

/** A missing app folder is the invocation's mistake: named here, before any packaging. */
async function requireDirectory(dir: string): Promise<void> {
  const { fs } = await host();
  const isDir = await fs.stat(dir).then((s) => s.isDirectory(), () => false);
  if (!isDir) throw new Error(`\`${dir}\` is not a directory.`);
}

/** The app directory a command works on: the argument as given, else the process's cwd. */
export async function appDir(dir: string | undefined): Promise<string> {
  const { path } = await host();
  return path.resolve(dir ?? ".");
}
