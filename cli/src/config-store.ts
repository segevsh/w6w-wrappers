/**
 * The per-user config file `w6w auth login` writes, and the rules for it.
 *
 * Everything here is **pure**: where the file lives, what a valid file looks
 * like, how it is parsed and serialised. The one thing that touches a disk is
 * the {@linkcode ConfigStore} a caller injects — the real one lives in
 * `src/store-fs.ts`, the only module that does file I/O, and the default
 * ({@linkcode NO_STORE}) is "nothing stored, nowhere to store it", so a test that
 * wires nothing never sees a real home directory.
 *
 * ```json
 * {"version":1,"baseUrl":"https://api.w6w.io","hosts":{"https://api.w6w.io":{"token":"…"}}}
 * ```
 *
 * `hosts` is keyed by the canonical base URL (the SDK's `joinBaseUrl` form), and a
 * token is only ever looked up by exact key — that binding is what stops a token
 * saved for one host from being sent to another.
 *
 * @module
 */

import { ConfigError } from "@w6w/sdk";
import type { EnvReader } from "./client.ts";

/** What the file holds, once validated. */
export interface StoredConfig {
  readonly version: 1;
  /** The base URL the last `auth login` targeted. Canonical. */
  readonly baseUrl: string;
  /** Token per canonical base URL. */
  readonly hosts: Readonly<Record<string, { readonly token: string }>>;
}

/** Nothing stored. The value used when the file does not exist. */
export const NO_CONFIG: StoredConfig = { version: 1, baseUrl: "", hosts: {} };

/**
 * Where the config text lives. The only seam to a disk.
 *
 * `read` answers `undefined` for a file that does not exist (nothing stored);
 * any other failure throws. `write` replaces the file atomically and leaves it
 * `0600` in a `0700` directory (best-effort on Windows).
 */
export interface ConfigStore {
  /** Absolute path of the file, or `undefined` where none can be resolved. */
  readonly path: string | undefined;
  read(): Promise<string | undefined>;
  write(text: string): Promise<void>;
}

/** Standard input, as the `auth login` command needs it. Injected; never read ambiently. */
export interface StdinSource {
  /** Whether input is an interactive terminal (then `auth login` never reads it). */
  isTerminal(): boolean;
  /** Everything on standard input. */
  read(): Promise<string>;
}

/** The default stdin: an interactive terminal with nothing on it, so nothing is ever read. */
export const NO_STDIN: StdinSource = { isTerminal: () => true, read: () => Promise.resolve("") };

/** The default store: nothing stored, nowhere to store it, no I/O. */
export const NO_STORE: ConfigStore = {
  path: undefined,
  read: () => Promise.resolve(undefined),
  write: () =>
    Promise.reject(
      new ConfigError(
        "There is nowhere to store the token: no per-user config directory resolved.",
      ),
    ),
};

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\");
}

/**
 * The config file's path, from the environment alone.
 *
 * - Windows: `%APPDATA%\w6w\config.json`.
 * - Elsewhere: `$XDG_CONFIG_HOME/w6w/config.json` when that is set, non-blank and
 *   **absolute** (the XDG spec says a relative value is ignored), else
 *   `$HOME/.config/w6w/config.json`.
 * - Otherwise `undefined`: nothing can be stored.
 *
 * @param env - The environment seam (not `os.homedir`: tests substitute it).
 * @param platform - `"win32"` for Windows; anything else is POSIX-like.
 */
export function configPath(env: EnvReader, platform: string): string | undefined {
  const pick = (name: string) => {
    const value = env(name);
    return value === undefined || value.trim().length === 0 ? undefined : value;
  };
  if (platform === "win32") {
    const appData = pick("APPDATA");
    return appData === undefined
      ? undefined
      : `${appData.replace(/[\\/]+$/, "")}\\w6w\\config.json`;
  }
  const xdg = pick("XDG_CONFIG_HOME");
  if (xdg !== undefined && isAbsolutePath(xdg)) {
    return `${xdg.replace(/\/+$/, "")}/w6w/config.json`;
  }
  const home = pick("HOME");
  return home === undefined ? undefined : `${home.replace(/\/+$/, "")}/.config/w6w/config.json`;
}

function malformed(path: string | undefined, why: string): ConfigError {
  // The message names the file and the reason class — never the file's content,
  // which holds tokens.
  return new ConfigError(
    `The w6w config file ${path ?? "(unknown path)"} is unreadable or malformed (${why}). ` +
      "Fix or delete it; w6w will not repair or overwrite it.",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate the file's text.
 *
 * @throws {ConfigError} Naming `path` and the kind of problem; never the content.
 */
export function parseConfig(text: string, path: string | undefined): StoredConfig {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw malformed(path, "not valid JSON");
  }
  if (!isRecord(data)) throw malformed(path, "not a JSON object");
  if (data.version !== 1) throw malformed(path, "unsupported version");
  if (typeof data.baseUrl !== "string") throw malformed(path, "`baseUrl` is not a string");
  if (!isRecord(data.hosts)) throw malformed(path, "`hosts` is not an object");
  const hosts: Record<string, { token: string }> = {};
  for (const [key, entry] of Object.entries(data.hosts)) {
    if (!isRecord(entry) || typeof entry.token !== "string") {
      throw malformed(path, "a host entry has no string `token`");
    }
    hosts[key] = { token: entry.token };
  }
  return { version: 1, baseUrl: data.baseUrl, hosts };
}

/** The file's text for a config: exactly the pinned shape, newline-terminated. */
export function serializeConfig(config: StoredConfig): string {
  return JSON.stringify({ version: 1, baseUrl: config.baseUrl, hosts: config.hosts }, null, 2) +
    "\n";
}

/**
 * Read and validate the store.
 *
 * @returns {@linkcode NO_CONFIG} for a missing file.
 * @throws {ConfigError} For an unreadable or malformed one.
 */
export async function loadConfig(store: ConfigStore): Promise<StoredConfig> {
  let text: string | undefined;
  try {
    text = await store.read();
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    throw malformed(store.path, "could not be read");
  }
  if (text === undefined) return NO_CONFIG;
  return parseConfig(text, store.path);
}
