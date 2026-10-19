/**
 * The real config store: the only module that touches the file system or stdin.
 *
 * Like `src/runtime.ts`, access is a capability probe over structural types —
 * Deno first, then `node:fs/promises` — so this compiles under the npm build's
 * `"types": []` and runs unchanged under Deno and Node. The Node module is
 * imported through a non-literal specifier for the same reason (no Node typings
 * are loaded to resolve a literal one).
 *
 * Writing is: create the directory `0700` (and re-chmod it), write a temp file
 * **in that directory** created `0600`, rename it over `config.json`, chmod
 * `0600`. A pre-existing looser mode therefore ends tightened, and a reader never
 * sees a half-written file. Windows modes are best-effort no-ops.
 *
 * @module
 */

import type { EnvReader } from "./client.ts";
import { configPath, type ConfigStore } from "./config-store.ts";

interface DenoFs {
  readTextFile(path: string): Promise<string>;
  writeTextFile(
    path: string,
    data: string,
    options?: { mode?: number; createNew?: boolean },
  ): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  chmod(path: string, mode: number): Promise<void>;
  mkdir(path: string, options?: { recursive?: boolean; mode?: number }): Promise<void>;
  remove(path: string): Promise<void>;
  build?: { os?: string };
  stdin?: { readable: ReadableStream<Uint8Array>; isTerminal?: () => boolean };
}

interface NodeFs {
  readFile(path: string, encoding: string): Promise<string>;
  writeFile(path: string, data: string, options?: { mode?: number; flag?: string }): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  chmod(path: string, mode: number): Promise<void>;
  mkdir(path: string, options?: { recursive?: boolean; mode?: number }): Promise<unknown>;
  rm(path: string, options?: { force?: boolean }): Promise<void>;
}

interface NodeProcess {
  platform?: string;
  stdin?: AsyncIterable<Uint8Array | string> & { isTTY?: boolean; setEncoding?(e: string): void };
}

const host = globalThis as unknown as { Deno?: DenoFs; process?: NodeProcess };

/** `"win32"` on Windows, whatever the host calls everything else. */
export function platformName(): string {
  if (host.Deno) {
    return host.Deno.build?.os === "windows" ? "win32" : (host.Deno.build?.os ?? "linux");
  }
  return host.process?.platform ?? "linux";
}

interface Ops {
  read(path: string): Promise<string>;
  write(path: string, data: string, mode: number): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  chmod(path: string, mode: number): Promise<void>;
  mkdir(path: string, mode: number): Promise<void>;
  remove(path: string): Promise<void>;
}

async function hostOps(): Promise<Ops> {
  const deno = host.Deno;
  if (deno) {
    return {
      read: (p) => deno.readTextFile(p),
      write: (p, d, mode) => deno.writeTextFile(p, d, { mode, createNew: true }),
      rename: (a, b) => deno.rename(a, b),
      chmod: (p, m) => deno.chmod(p, m),
      mkdir: (p, mode) => deno.mkdir(p, { recursive: true, mode }),
      remove: (p) => deno.remove(p),
    };
  }
  const specifier = "node:fs/promises";
  const fs = (await import(specifier)) as NodeFs;
  return {
    read: (p) => fs.readFile(p, "utf8"),
    write: (p, d, mode) => fs.writeFile(p, d, { mode, flag: "wx" }),
    rename: (a, b) => fs.rename(a, b),
    chmod: (p, m) => fs.chmod(p, m),
    mkdir: async (p, mode) => {
      await fs.mkdir(p, { recursive: true, mode });
    },
    remove: (p) => fs.rm(p, { force: true }),
  };
}

function isNotFound(error: unknown): boolean {
  const e = error as { code?: unknown; name?: unknown } | null;
  return e?.code === "ENOENT" || e?.name === "NotFound";
}

function dirnameOf(path: string): string {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return path.slice(0, cut);
}

/** Best effort: Windows has no POSIX modes, and a chmod failure there is not an error. */
async function tryChmod(ops: Ops, path: string, mode: number): Promise<void> {
  try {
    await ops.chmod(path, mode);
  } catch (error) {
    if (platformName() !== "win32") throw error;
  }
}

/**
 * The file-backed store for this process's environment.
 *
 * @param env - The environment seam the path is resolved from.
 */
export function fsConfigStore(env: EnvReader): ConfigStore {
  // The path is resolved on demand, not at construction: building the store must
  // not read the environment, so help and `--version` keep needing no permissions.
  const resolve = () => configPath(env, platformName());
  return {
    get path() {
      return resolve();
    },
    async read() {
      const path = resolve();
      if (path === undefined) return undefined;
      const ops = await hostOps();
      try {
        return await ops.read(path);
      } catch (error) {
        if (isNotFound(error)) return undefined;
        throw error;
      }
    },
    async write(text) {
      const path = resolve();
      if (path === undefined) throw new Error("no config path");
      const ops = await hostOps();
      const dir = dirnameOf(path);
      await ops.mkdir(dir, 0o700);
      await tryChmod(ops, dir, 0o700);
      const tmp = `${dir}/.config.${Math.random().toString(36).slice(2)}.tmp`;
      try {
        await ops.write(tmp, text, 0o600);
        await ops.rename(tmp, path);
      } catch (error) {
        await ops.remove(tmp).catch(() => undefined);
        throw error;
      }
      await tryChmod(ops, path, 0o600);
    },
  };
}

/**
 * Everything on standard input as text, or `undefined` when the host has no
 * stdin. The caller decides whether to call this at all (never on a terminal).
 */
export async function readStdin(): Promise<string> {
  const deno = host.Deno;
  if (deno?.stdin) {
    return await new Response(deno.stdin.readable).text();
  }
  const stdin = host.process?.stdin;
  if (!stdin) return "";
  const chunks: string[] = [];
  const decoder = new TextDecoder();
  for await (const chunk of stdin) {
    chunks.push(typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true }));
  }
  return chunks.join("");
}

/** Whether standard input is a terminal. Unknown counts as "not a terminal"... except see caller. */
export function stdinIsTerminal(): boolean {
  const deno = host.Deno?.stdin;
  if (deno?.isTerminal) return deno.isTerminal();
  return host.process?.stdin?.isTTY === true;
}
