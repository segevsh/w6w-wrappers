/**
 * The app toolchain seam — how `w6w apps validate|build` reach the canonical
 * `@w6w/app-build` builder.
 *
 * The CLI never bundles an app itself: it spawns `deno run` on the builder and
 * reads the answer. That spawn is behind {@linkcode useToolchainRunner} (replace and restore), so the test suite never starts Deno.
 *
 * Host access follows the package's rule: `node:` modules are imported through a
 * non-literal specifier with structural types.
 *
 * @module
 */

/** The builder spec used when `--builder` is absent (override only by flag). */
export const DEFAULT_BUILDER = "jsr:@w6w/app-build@0.2.0/cli";

/** How the builder resolves `@w6w/*` imports. */
export type Resolution = "sibling" | "registry";

/** What a toolchain spawn produced. */
export interface ToolchainResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Runs `deno <argv>` in `cwd`. Rejects with an error whose `code` is `"ENOENT"`
 * when Deno is not on PATH.
 */
export type ToolchainRunner = (argv: string[], cwd: string) => Promise<ToolchainResult>;

interface Fs {
  readFile(path: string, encoding: "utf8"): Promise<string>;
  stat(path: string): Promise<{ isFile(): boolean }>;
}
interface Path {
  resolve(...parts: string[]): string;
  dirname(path: string): string;
  join(...parts: string[]): string;
}

async function host(): Promise<{ fs: Fs; path: Path }> {
  const fsName = "node:fs/promises";
  const pathName = "node:path";
  return {
    fs: (await import(fsName)) as Fs,
    path: (await import(pathName)) as Path,
  };
}

interface SpawnedChild {
  stdout: { on(event: "data", l: (chunk: unknown) => void): unknown };
  stderr: { on(event: "data", l: (chunk: unknown) => void): unknown };
  on(event: "error", listener: (error: Error) => void): unknown;
  on(event: "close", listener: (code: number | null) => void): unknown;
}

const hostRunner: ToolchainRunner = async (argv, cwd) => {
  const name = "node:child_process";
  const { spawn } = (await import(name)) as {
    spawn(
      command: string,
      args: string[],
      options: { cwd: string; stdio: unknown[] },
    ): SpawnedChild;
  };
  return await new Promise<ToolchainResult>((resolve, reject) => {
    const child = spawn("deno", argv, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => stdout += String(c));
    child.stderr.on("data", (c) => stderr += String(c));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
};

let runner: ToolchainRunner = hostRunner;

/** Replace the Deno runner — the test suite's seam. Returns a function that restores it. */
export function useToolchainRunner(replacement: ToolchainRunner): () => void {
  const previous = runner;
  runner = replacement;
  return () => {
    runner = previous;
  };
}

/** The error shown when Deno is not installed (R7). */
export const DENO_MISSING =
  "Deno is required to validate and build apps, and `deno` was not found on PATH. " +
  "Install it from https://deno.com and re-run.";

/**
 * Run the builder through the current runner.
 *
 * @throws {Error} Naming the Deno prerequisite when the runner reports ENOENT.
 */
export async function runBuilder(argv: string[], cwd: string): Promise<ToolchainResult> {
  try {
    return await runner(argv, cwd);
  } catch (error) {
    if ((error as { code?: unknown })?.code === "ENOENT") throw new Error(DENO_MISSING);
    throw error;
  }
}

/** The app directory a command works on: the argument as given, else the process's cwd. */
export async function appDir(dir: string | undefined): Promise<string> {
  const { path } = await host();
  return path.resolve(dir ?? ".");
}

/** One reason the builder refused an app. */
export interface BuilderError {
  code: string;
  message: string;
}

/**
 * The one JSON line `--validate` prints: `{"ok":true,"id","version"}` on a pass,
 * `{"ok":false,"errors":[{"code","message"}]}` on a refusal.
 *
 * A failure is **data**, not a thrown error — it is the builder's answer to a
 * question that was asked successfully, which is why the command renders it and
 * exits by it instead of reporting it as a crash.
 */
export interface BuilderReport {
  ok: boolean;
  id?: string;
  version?: string;
  errors?: BuilderError[];
}

/** Why an answer could not be read as the pinned line, with the builder's own words. */
function unreadable(answer: string | undefined, stderr: string): Error {
  const said = answer === undefined
    ? "printed nothing on stdout"
    : `printed \`${
      answer.length <= 120 ? answer : `${answer.slice(0, 119)}…`
    }\`, which is not that line`;
  const detail = stderr
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .slice(-3)
    .join("\n");
  return new Error(
    `the app builder did not answer with its JSON line: it ${said}.` +
      (detail === "" ? "" : `\n${detail}`),
  );
}

/**
 * Read the builder's answer from its stdout.
 *
 * The last non-blank line is the line: `deno` and the builder may both write
 * progress above it, and none of that is the answer.
 *
 * @param stdout - Everything the builder wrote to stdout.
 * @param stderr - Everything it wrote to stderr, quoted when the answer is unreadable.
 * @returns The report.
 * @throws {Error} When the answer is not the pinned line.
 */
export function readReport(stdout: string, stderr = ""): BuilderReport {
  const lines = stdout.split("\n").map((line) => line.trim()).filter((line) => line !== "");
  const last = lines[lines.length - 1];
  let parsed: unknown;
  try {
    parsed = last === undefined ? undefined : JSON.parse(last);
  } catch {
    throw unreadable(last, stderr);
  }
  if (
    typeof parsed !== "object" || parsed === null ||
    typeof (parsed as BuilderReport).ok !== "boolean"
  ) {
    throw unreadable(last, stderr);
  }
  const report = parsed as BuilderReport;
  // A pass names the app; a refusal names at least one reason. Anything else is
  // not the pinned line, however well-formed its JSON is.
  if (report.ok === true) {
    if (typeof report.id !== "string" || typeof report.version !== "string") {
      throw unreadable(last, stderr);
    }
  } else if (!Array.isArray(report.errors) || report.errors.length === 0) {
    throw unreadable(last, stderr);
  }
  return report;
}

/**
 * The resolution to pass: the explicit flag wins; otherwise `registry` iff the app's
 * `deno.json` maps `@w6w/types` to a `jsr:` specifier, else `sibling`.
 *
 * @throws {Error} When the flag is neither `sibling` nor `registry`.
 */
export async function resolveResolution(dir: string, flag?: string): Promise<Resolution> {
  if (flag !== undefined) {
    if (flag === "sibling" || flag === "registry") return flag;
    throw new Error(`--resolution must be \`sibling\` or \`registry\`, got \`${flag}\`.`);
  }
  const { fs, path } = await host();
  try {
    const config = JSON.parse(await fs.readFile(path.join(dir, "deno.json"), "utf8")) as {
      imports?: Record<string, unknown>;
    };
    const mapped = config.imports?.["@w6w/types"];
    return typeof mapped === "string" && mapped.startsWith("jsr:") ? "registry" : "sibling";
  } catch {
    return "sibling";
  }
}

async function nearestDenoJson(from: string): Promise<string | undefined> {
  const { fs, path } = await host();
  let dir = path.resolve(from);
  while (true) {
    for (const name of ["deno.json", "deno.jsonc"]) {
      const candidate = path.join(dir, name);
      try {
        if ((await fs.stat(candidate)).isFile()) return candidate;
      } catch { /* keep climbing */ }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** Options for {@linkcode builderArgs}. */
export interface BuilderExtra {
  out?: string;
  resolution?: Resolution;
}

/**
 * The `deno` argv for one builder run:
 * `run -A --unstable-worker-options <cfg> <builder> <dir> (-o <out> | --validate) [--resolution r]`.
 *
 * `<cfg>` is `--no-config` for a `jsr:` spec and `--config <nearest deno.json above the
 * file>` for a local path or `file:` spec.
 */
export async function builderArgs(
  spec: string,
  dir: string,
  mode: "validate" | "build",
  extra: BuilderExtra = {},
): Promise<string[]> {
  const { path } = await host();
  const argv = ["run", "-A", "--unstable-worker-options"];
  let builder = spec;
  if (spec.startsWith("jsr:")) {
    argv.push("--no-config");
  } else {
    // Resolved once, to an absolute path: the spawn's cwd is the app dir, so a
    // relative spec would name a different file there than it did here.
    const file = spec.startsWith("file:") ? decodeURIComponent(new URL(spec).pathname) : spec;
    builder = path.resolve(file);
    const config = await nearestDenoJson(path.dirname(builder));
    if (config !== undefined) argv.push("--config", config);
  }
  argv.push(builder, path.resolve(dir));
  if (mode === "validate") argv.push("--validate");
  else if (extra.out !== undefined) argv.push("-o", extra.out);
  if (extra.resolution !== undefined) argv.push("--resolution", extra.resolution);
  return argv;
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

async function packHost(): Promise<{ fs: PackFs; path: Path; sha256: (text: string) => string }> {
  const fsName = "node:fs/promises";
  const pathName = "node:path";
  const cryptoName = "node:crypto";
  const crypto = (await import(cryptoName)) as {
    createHash(alg: "sha256"): { update(data: string): { digest(enc: "hex"): string } };
  };
  return {
    fs: (await import(fsName)) as PackFs,
    path: (await import(pathName)) as Path,
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
 * Builds every app a pack source lists with the SAME builder `apps build` uses
 * ({@linkcode builderArgs} + {@linkcode runBuilder}), into a staging directory beside
 * `<out>`, and only when ALL of them built moves the result to `<out>/w6w`
 * (`index.json` + `<id>/<version>/…`). Any failure leaves `<out>/w6w` untouched.
 *
 * `execSha256` in the index is the sha-256 of the `app.js` actually written; a
 * builder-reported value that disagrees is a failure.
 *
 * @param packPath The `w6w-pack.json` of the source; each `apps[].path` is relative to it.
 * @throws {PackageFailure} When the pack is unreadable or any app fails.
 */
export async function packageApps(
  packPath: string,
  out: string,
  options: {
    builder: string;
    resolution?: Resolution;
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
        const resolution = options.resolution ?? await resolveResolution(dir);
        const result = await runBuilder(
          await builderArgs(options.builder, dir, "build", { out: raw, resolution }),
          dir,
        );
        if (result.code !== 0) {
          const said = (result.stderr.trim() || result.stdout.trim()).split("\n").slice(-3).join(
            " | ",
          );
          throw new Error(`the builder exited ${result.code}${said ? `: ${said}` : ""}`);
        }
        const index: unknown = JSON.parse(await fs.readFile(path.join(raw, "index.json"), "utf8"));
        const entries = isRecord(index) && Array.isArray(index.apps) ? index.apps : [];
        const entry = entries[0];
        if (
          entries.length !== 1 || !isRecord(entry) || typeof entry.id !== "string" ||
          typeof entry.version !== "string"
        ) {
          throw new Error("the builder's index.json does not carry exactly one app");
        }
        const from = path.join(raw, entry.id, entry.version);
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
