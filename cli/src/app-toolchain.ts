/**
 * The app toolchain seam — how `w6w apps validate|build` reach the canonical
 * `@w6w/app-build` builder.
 *
 * The CLI never bundles an app itself: it spawns `deno run` on the builder and
 * reads the answer. That spawn is behind {@linkcode useToolchainRunner} (replace and
 * restore, mirroring `useBuildRunner`), so the test suite never starts Deno.
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
  const argv = ["run", "-A", "--unstable-worker-options"];
  if (spec.startsWith("jsr:")) {
    argv.push("--no-config");
  } else {
    const file = spec.startsWith("file:") ? new URL(spec).pathname : spec;
    const config = await nearestDenoJson((await host()).path.dirname(
      (await host()).path.resolve(file),
    ));
    if (config !== undefined) argv.push("--config", config);
  }
  argv.push(spec, dir);
  if (mode === "validate") argv.push("--validate");
  else if (extra.out !== undefined) argv.push("-o", extra.out);
  if (extra.resolution !== undefined) argv.push("--resolution", extra.resolution);
  return argv;
}
