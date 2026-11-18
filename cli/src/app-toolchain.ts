/**
 * The app toolchain seam — how `w6w apps validate|build` reach the canonical
 * `@w6w/app-build` builder.
 *
 * The CLI never bundles an app itself: it spawns `deno run` on the builder and
 * reads the answer. That spawn is behind {@linkcode useToolchainRunner} (replace and restore), so the test suite never starts Deno.
 *
 * Which `deno` it spawns is {@linkcode resolveDeno}'s answer. The npm package
 * carries its own Deno — the official `@deno/<platform>` binary packages are
 * optional dependencies, npm installs only the one matching the machine — so
 * `w6w apps build` works with no Deno installed and no PATH set up.
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
 * when no Deno binary could be found.
 */
export type ToolchainRunner = (argv: string[], cwd: string) => Promise<ToolchainResult>;

interface Fs {
  readFile(path: string, encoding: "utf8"): Promise<string>;
  stat(path: string): Promise<{ isFile(): boolean; isDirectory(): boolean }>;
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

/** The env var that names a Deno binary explicitly; it wins over everything else. */
export const DENO_OVERRIDE_ENV = "W6W_DENO";

/**
 * The official per-platform Deno binary packages on npm, all optional
 * dependencies of `@w6w/cli`. Each declares `os`/`cpu`(/`libc`), so npm installs
 * exactly the one this machine can run (none on e.g. musl or 32-bit hosts).
 */
export const BUNDLED_DENO_PACKAGES = [
  "@deno/linux-x64-glibc",
  "@deno/linux-arm64-glibc",
  "@deno/darwin-x64",
  "@deno/darwin-arm64",
  "@deno/win32-x64",
  "@deno/win32-arm64",
] as const;

/** What {@linkcode resolveDeno} may ask of the host. Injectable so tests probe every branch. */
export interface DenoHost {
  /** Reads an environment variable. */
  env(name: string): string | undefined;
  /** The running Deno's own binary, when the CLI itself runs under Deno. */
  denoExecPath(): string | undefined;
  /** Node-style platform name (`linux`, `darwin`, `win32`). */
  platform: string;
  /** Node-style architecture name (`x64`, `arm64`). */
  arch: string;
  /** Where an installed package's `package.json` lives, or `undefined` if it is not installed. */
  resolvePackage(name: string): string | undefined;
  /** True when `path` is an existing file. */
  isFile(path: string): Promise<boolean>;
}

/**
 * The Deno binary to run the builder under, first hit wins:
 *
 *   1. `$W6W_DENO`, verbatim — the explicit override.
 *   2. The running Deno's own `execPath()`, when the CLI runs under Deno.
 *   3. The bundled `@deno/<platform>` package's binary.
 *   4. `$DENO_INSTALL/bin/deno`, then `~/.deno/bin/deno` — the official install
 *      script's location, which non-login shells, IDE tasks and CI often lack on PATH.
 *   5. Bare `deno`, resolved through PATH by the spawn.
 */
export async function resolveDeno(h: DenoHost): Promise<string> {
  const override = h.env(DENO_OVERRIDE_ENV);
  if (override) return override;

  const self = h.denoExecPath();
  if (self) return self;

  const exe = h.platform === "win32" ? "deno.exe" : "deno";
  const sep = h.platform === "win32" ? "\\" : "/";
  const dirOf = (file: string) =>
    file.slice(0, Math.max(file.lastIndexOf("/"), file.lastIndexOf("\\")));

  for (const name of BUNDLED_DENO_PACKAGES) {
    if (!name.startsWith(`@deno/${h.platform}-${h.arch}`)) continue;
    const manifest = h.resolvePackage(name);
    if (!manifest) continue;
    const bin = `${dirOf(manifest)}${sep}${exe}`;
    if (await h.isFile(bin)) return bin;
  }

  const installDirs = [h.env("DENO_INSTALL"), h.env("HOME") ?? h.env("USERPROFILE")]
    .map((root, i) => root ? (i === 0 ? root : `${root}${sep}.deno`) : undefined);
  for (const root of installDirs) {
    if (!root) continue;
    const bin = `${root}${sep}bin${sep}${exe}`;
    if (await h.isFile(bin)) return bin;
  }

  return "deno";
}

interface HostGlobals {
  Deno?: { execPath(): string; env: { get(name: string): string | undefined } };
  process?: { env: Record<string, string | undefined>; platform: string; arch: string };
}

/** The real host, probed by capability so the module compiles and runs under Deno and Node. */
async function systemDenoHost(): Promise<DenoHost> {
  const g = globalThis as unknown as HostGlobals;
  const { fs } = await host();
  const moduleName = "node:module";
  const { createRequire } = (await import(moduleName)) as {
    createRequire(url: string): { resolve(id: string): string };
  };
  const require = createRequire(import.meta.url);
  return {
    env: (name) => {
      try {
        return g.Deno ? g.Deno.env.get(name) : g.process?.env[name];
      } catch {
        return undefined; // Deno without --allow-env
      }
    },
    denoExecPath: () => g.Deno?.execPath(),
    platform: g.process?.platform ?? "linux",
    arch: g.process?.arch ?? "x64",
    resolvePackage: (name) => {
      try {
        return require.resolve(`${name}/package.json`);
      } catch {
        return undefined;
      }
    },
    isFile: async (path) => {
      try {
        return (await fs.stat(path)).isFile();
      } catch {
        return false;
      }
    },
  };
}

let resolvedDeno: Promise<string> | undefined;

const hostRunner: ToolchainRunner = async (argv, cwd) => {
  resolvedDeno ??= systemDenoHost().then(resolveDeno);
  const deno = await resolvedDeno;
  const name = "node:child_process";
  const { spawn } = (await import(name)) as {
    spawn(
      command: string,
      args: string[],
      options: { cwd: string; stdio: unknown[] },
    ): SpawnedChild;
  };
  return await new Promise<ToolchainResult>((resolve, reject) => {
    const child = spawn(deno, argv, { cwd, stdio: ["ignore", "pipe", "pipe"] });
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

/** The error shown when no Deno binary could be found (R7). */
export const DENO_MISSING =
  "Deno is required to validate and build apps. The Deno bundled with @w6w/cli is not " +
  "installed for this platform, and `deno` was not found on PATH or in ~/.deno/bin. " +
  "Install it from https://deno.com, or set W6W_DENO to its path, and re-run.";

/**
 * Run the builder through the current runner.
 *
 * @throws {Error} Naming the Deno prerequisite when the runner reports ENOENT.
 */
export async function runBuilder(argv: string[], cwd: string): Promise<ToolchainResult> {
  try {
    return await runner(argv, cwd);
  } catch (error) {
    if ((error as { code?: unknown })?.code !== "ENOENT") throw error;
    // A spawn into a missing cwd is ENOENT too — name the directory, not Deno.
    const { fs } = await host();
    const isDir = await fs.stat(cwd).then((s) => s.isDirectory(), () => false);
    throw new Error(isDir ? DENO_MISSING : `\`${cwd}\` is not a directory.`);
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
