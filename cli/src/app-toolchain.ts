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

// ---------------------------------------------------------------------------
// Registry package (`apps package`)
// ---------------------------------------------------------------------------

interface PackFs {
  readFile(path: string, encoding: "utf8"): Promise<string>;
  readdir(path: string): Promise<string[]>;
  writeFile(path: string, data: string): Promise<void>;
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  mkdtemp(prefix: string): Promise<string>;
  rename(from: string, to: string): Promise<void>;
  rm(path: string, options: { force: true; recursive: true }): Promise<void>;
}

interface PackPath {
  resolve(...parts: string[]): string;
  join(...parts: string[]): string;
  dirname(path: string): string;
}

async function packHost(): Promise<
  { fs: PackFs; path: PackPath; sha256: (text: string) => string }
> {
  const fsName = "node:fs/promises";
  const pathName = "node:path";
  const cryptoName = "node:crypto";
  const crypto = (await import(cryptoName)) as {
    createHash(alg: "sha256"): { update(data: string): { digest(enc: "hex"): string } };
  };
  return {
    fs: (await import(fsName)) as PackFs,
    path: (await import(pathName)) as PackPath,
    sha256: (text) => crypto.createHash("sha256").update(text).digest("hex"),
  };
}

/** One app in `<out>/w6w/index.json`. */
export interface PackagedApp {
  id: string;
  version: string;
  execSha256: string;
  digest?: string;
  sourceDigest?: string;
  [key: string]: unknown;
}

/** Thrown by {@linkcode packageApps}: every failure, nothing written to `<out>/w6w`. */
export class PackageFailure extends Error {
  constructor(readonly failures: string[]) {
    super(`packaging failed; nothing was written:\n${failures.map((f) => `  - ${f}`).join("\n")}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Packages every app a pack source lists with the SAME assembler `apps build` uses
 * ({@linkcode assembler}), into a staging directory beside
 * `<out>`, and only when ALL of them built moves the result to `<out>/w6w`
 * (`index.json` + `<id>/<version>/…`). Any failure leaves `<out>/w6w` untouched.
 *
 * `execSha256` in the index is the sha-256 of the `app.js` actually written; a
 * assembler-reported value that disagrees is a failure.
 *
 * @param packPath The `w6w-pack.json` of the source; each `apps[].path` is relative to it.
 * @throws {PackageFailure} When the pack is unreadable or any app fails.
 */
export async function packageApps(
  packPath: string,
  out: string,
  options: {
    name?: string;
    version?: string;
    license?: string;
  },
): Promise<PackagedApp[]> {
  const { fs, path, sha256 } = await packHost();
  const pack = path.resolve(packPath);
  let paths: string[];
  let packLicense: string | undefined;
  try {
    const data: unknown = JSON.parse(await fs.readFile(pack, "utf8"));
    if (isRecord(data) && typeof data.license === "string" && data.license !== "") {
      packLicense = data.license;
    }
    const apps = isRecord(data) && Array.isArray(data.apps) ? data.apps : undefined;
    if (apps === undefined) throw new Error("no `apps` array");
    paths = apps.map((a) => {
      if (!isRecord(a) || typeof a.path !== "string" || a.path === "") {
        throw new Error("every app needs a `path`");
      }
      return path.resolve(path.dirname(pack), a.path);
    });
    if (paths.length === 0) throw new Error("`apps` is empty");
  } catch (error) {
    throw new PackageFailure([`\`${packPath}\`: ${(error as Error).message}`]);
  }

  const absOut = path.resolve(out);
  // Validate existing publish manifests BEFORE anything is built or written.
  const manifests = await planManifests(
    absOut,
    path.dirname(pack).split(/[\\/]/).pop() ?? "",
    { ...options, packLicense },
  );
  await fs.mkdir(absOut, { recursive: true });
  const stage = await fs.mkdtemp(path.join(absOut, ".w6w-stage-"));
  try {
    const built: PackagedApp[] = [];
    const failures: string[] = [];
    for (const [i, dir] of paths.entries()) {
      const raw = path.join(stage, "raw", String(i));
      try {
        const { assembleApp } = await assembler();
        let result: BuildResult;
        try {
          result = await assembleApp(dir, raw);
        } catch (error) {
          if (isBuildError(error)) throw new Error(refusalLine(error));
          throw error;
        }
        const entry: PackagedApp = {
          id: result.id,
          version: result.version,
          execSha256: result.execSha256,
          digest: result.digest,
          sourceDigest: result.sourceDigest,
        };
        const from = result.outDir;
        const execSha256 = sha256(await fs.readFile(path.join(from, "app.js"), "utf8"));
        if (entry.execSha256 !== undefined && entry.execSha256 !== execSha256) {
          throw new Error(`reported execSha256 does not match the built app.js`);
        }
        const to = path.join(stage, "w6w", entry.id, entry.version);
        await fs.mkdir(path.dirname(to), { recursive: true });
        await fs.rename(from, to);
        built.push({ ...entry, id: entry.id, version: entry.version, execSha256 });
      } catch (error) {
        failures.push(`${dir}: ${(error as Error).message}`);
      }
    }
    if (failures.length > 0) throw new PackageFailure(failures);
    await fs.mkdir(path.join(stage, "w6w"), { recursive: true });
    await fs.writeFile(
      path.join(stage, "w6w", "index.json"),
      JSON.stringify({ apps: built, failures: [] }, null, 2) + "\n",
    );
    await fs.rm(path.join(absOut, "w6w"), { force: true, recursive: true });
    await fs.rename(path.join(stage, "w6w"), path.join(absOut, "w6w"));
    for (const [file, body] of manifests) {
      await fs.writeFile(path.join(absOut, file), JSON.stringify(body, null, 2) + "\n");
    }
    return built;
  } finally {
    await fs.rm(stage, { force: true, recursive: true });
  }
}

const DEPENDENCY_KEYS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
  "bundledDependencies",
  "bundleDependencies",
];
const KEYWORD = "w6w-app";
const JSR_CONFIGS = ["jsr.json", "deno.json", "deno.jsonc"];

/** Parses JSON, tolerating `//` and `/* *\/` comments outside strings (for `deno.jsonc`). */
function parseJsonc(text: string): unknown {
  const stripped = text.replace(
    /"(?:[^"\\]|\\.)*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
    (m) => m.startsWith('"') ? m : "",
  );
  return JSON.parse(stripped);
}

function remoteImports(imports: unknown): string[] {
  if (!isRecord(imports)) return [];
  return Object.entries(imports)
    .filter(([, v]) => typeof v === "string" && /^(npm|jsr):/.test(v))
    .map(([k]) => k);
}

/**
 * Decides which publish manifests to write into `<out>` and validates the ones already there.
 * Returns `[fileName, body]` for the absent ones; throws {@linkcode PackageFailure} (before
 * anything is written) for an existing one that would make the package carry dependencies.
 */
async function planManifests(
  absOut: string,
  fallbackName: string,
  options: { name?: string; version?: string; license?: string; packLicense?: string },
): Promise<[string, Record<string, unknown>][]> {
  const { fs, path } = await packHost();
  const read = async (file: string): Promise<string | undefined> => {
    try {
      return await fs.readFile(path.join(absOut, file), "utf8");
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") return undefined;
      throw error;
    }
  };
  const failures: string[] = [];
  const plan: [string, Record<string, unknown>][] = [];
  const name = options.name ??
    `w6w-apps-${
      fallbackName.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[-.]+/, "") || "pack"
    }`;
  const version = options.version ?? "0.1.0";

  const pkgText = await read("package.json");
  let pkgLicense: string | undefined;
  if (pkgText === undefined) {
    plan.push(["package.json", { name, version, keywords: [KEYWORD], files: ["w6w/"] }]);
  } else {
    try {
      const pkg: unknown = JSON.parse(pkgText);
      if (!isRecord(pkg)) throw new Error("not a JSON object");
      if (typeof pkg.license === "string" && pkg.license !== "") pkgLicense = pkg.license;
      for (const key of DEPENDENCY_KEYS) {
        if (key in pkg) failures.push(`package.json: \`${key}\` is not allowed (even empty)`);
      }
      if (!Array.isArray(pkg.keywords) || !pkg.keywords.includes(KEYWORD)) {
        failures.push(`package.json: \`keywords\` must include \`${KEYWORD}\``);
      }
      for (const k of remoteImports(pkg.imports)) {
        failures.push(`package.json: import \`${k}\` points at an npm:/jsr: specifier`);
      }
    } catch (error) {
      failures.push(`package.json: ${(error as Error).message}`);
    }
  }

  let existing: string | undefined;
  for (const file of JSR_CONFIGS) {
    const text = await read(file);
    if (text === undefined) continue;
    existing = file;
    try {
      const cfg = parseJsonc(text);
      if (!isRecord(cfg)) throw new Error("not a JSON object");
      for (const k of remoteImports(cfg.imports)) {
        failures.push(`${file}: import \`${k}\` points at an npm:/jsr: specifier`);
      }
    } catch (error) {
      failures.push(`${file}: ${(error as Error).message}`);
    }
    break;
  }
  if (existing === undefined) {
    plan.push(["jsr.json", {
      name: name.startsWith("@") ? name : `@w6w-apps/${name.replace(/^w6w-apps-/, "")}`,
      version,
      license: pkgLicense ?? options.packLicense ?? options.license ?? "UNLICENSED",
      exports: "./w6w/index.json",
      publish: { include: ["jsr.json", "w6w/"] },
    }]);
  }
  if (failures.length > 0) throw new PackageFailure(failures);
  return plan;
}
