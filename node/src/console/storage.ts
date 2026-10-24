/**
 * `client.console.storage.*` — the account's storage bindings and agent-limit
 * settings: the managed-store destination an account uploads to, and the caps
 * (§P4: `max_file_bytes`, `max_package_bytes`, `max_files`, `retentionDays`)
 * that apply to those uploads.
 *
 * **Studio-internal, not the published partner contract.** Both routes are
 * account-admin surfaces (a member's write answers `403 forbidden`; another
 * account's id is the uniform `404`) and live under the `console` subpath
 * export only — deliberately absent from `endpoints.json` and from the root
 * barrel, exactly like `console.models`' catalog edits (P-D5's console-only
 * rule).
 *
 * **Nothing here carries a destination or a credential.** T4.1.1's wire shape
 * is an allowlist: a binding never returns its bucket, region, endpoint, root
 * prefix, credential or a revision's `config`, and settings never return a
 * storage path — only the numeric limits and a binding *id*. The types below
 * model that allowlist, not the row, so there is no field for a caller to be
 * tempted by.
 *
 * **The account is never a parameter.** Both services resolve the account from
 * the caller's own credential (the account scope on the bearer) plus a
 * server-side admin check, never from an id this client sends — the same rule
 * `console.tenantLoginFlags` and `console.tenantOAuthApps` follow.
 *
 * @module
 */

import { ApiError } from "../errors.ts";
import { type HttpResponse, path, type RequestOptions } from "../http.ts";
import { unwrap } from "../types.ts";

/** The slice of `W6WClient` this namespace needs: the transport. */
export interface StorageConsoleHost {
  /** Perform one request. */
  request<T>(options: RequestOptions): Promise<HttpResponse<T>>;
}

/** Per-call options for the reads. */
export interface StorageConsoleOptions {
  /** Abort signal. */
  signal?: AbortSignal;
}

/** Options for `bindings.list`. */
export interface ListStorageBindingsOptions extends StorageConsoleOptions {
  /** Include retired bindings (the server elides them by default). */
  includeRetired?: boolean;
}

/** One binding's newest revision, as the wire exposes it: identity only, no destination. */
export interface StorageBindingRevisionRef {
  id: string;
  revision: number;
  createdAt: string;
}

/** The stored outcome of the last reachability probe: a code and a timestamp, never a free-form blob. */
export interface StorageBindingHealth {
  ok?: boolean;
  code?: string;
  checkedAt?: string;
}

/**
 * A storage binding, as the server sends it.
 *
 * `serverDefault` marks the account using the server's own store; `status` is
 * `active` until the binding is retired (`retiredAt` then carries the moment).
 */
export interface StorageBinding {
  id: string;
  name: string;
  /** Store kind — `s3` today. */
  provider: string;
  connectionId: string | null;
  serverDefault: boolean;
  status: string;
  health: StorageBindingHealth;
  activeRevisionId: string | null;
  revision: StorageBindingRevisionRef | null;
  createdAt: string;
  updatedAt: string;
  retiredAt: string | null;
}

/**
 * Body of `bindings.create`.
 *
 * The destination fields go **up** only: the caller supplies them once (they
 * reach the service through the account's connection), and no read returns
 * them. `rootPrefix` is refused when it is non-empty; the store's prefix is
 * the server's to choose.
 */
export interface CreateStorageBindingInput {
  name?: string;
  connectionId: string;
  bucket: string;
  region: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  rootPrefix?: string;
}

/** What `bindings.migrate` accepted: the jobs it enqueued, not the jobs themselves. */
export interface StorageMigration {
  bindingId: string;
  toRevisionId: string;
  /** How many copies the runner queued (`202 Accepted`). */
  enqueued: number;
}

/** The effective caps: `account setting ⊓ server ceiling`, per field. */
export interface AgentLimits {
  maxFileBytes: number;
  maxPackageBytes: number;
  maxFiles: number;
}

/** The account's own stored values; `null` means "not set — use the default". */
export interface AgentSettingsValues {
  maxFileBytes: number | null;
  maxPackageBytes: number | null;
  maxFiles: number | null;
  retentionDays: number | null;
  storageBindingId: string | null;
}

/**
 * `GET`/`PATCH /agent-settings` — the effective limits, the stored values
 * behind them, and when the row last changed (`null` until the first patch).
 */
export interface AgentSettings {
  limits: AgentLimits;
  settings: AgentSettingsValues;
  updatedAt: string | null;
}

/**
 * Body of `settings.patch` — an allowlist of the five settable fields, key by
 * key. An omitted field is left alone; `null` clears it back to the default.
 *
 * The server validates it (unknown field, a non-positive or non-integer value,
 * a value above the operator's ceiling ⇒ `422`; an unknown binding id ⇒ the
 * uniform `404`), so nothing is pre-validated here.
 */
export type AgentSettingsPatch = Partial<AgentSettingsValues>;

/**
 * A binding is answered FLAT (`c.json(bindingJson(view))`), not inside an
 * envelope. Accept that, and refuse a body that is not one.
 */
function bindingBody(res: HttpResponse<unknown>): StorageBinding {
  const body = res.body;
  if (
    typeof body === "object" && body !== null && !Array.isArray(body) &&
    typeof (body as Record<string, unknown>).id === "string"
  ) {
    return body as StorageBinding;
  }
  throw new ApiError(
    res.status,
    "bad_response",
    `Server returned a ${res.status} without a binding object in the response body.`,
    body,
  );
}

/** The same allowlist for settings, whose only required key is the effective `limits`. */
function settingsBody(res: HttpResponse<unknown>): AgentSettings {
  const body = res.body;
  if (
    typeof body === "object" && body !== null && !Array.isArray(body) &&
    typeof (body as Record<string, unknown>).limits === "object"
  ) {
    return body as AgentSettings;
  }
  throw new ApiError(
    res.status,
    "bad_response",
    `Server returned a ${res.status} without a settings object in the response body.`,
    body,
  );
}

/**
 * `client.console.storage.bindings.*` — `GET|POST /storage-bindings`,
 * `GET|DELETE /storage-bindings/:id`, `POST /storage-bindings/:id/migrate`.
 *
 * Reads are open to account members; `create`, `delete` and `migrate` need an
 * account admin (`403 forbidden` otherwise).
 */
export class StorageBindingsApi {
  readonly #host: StorageConsoleHost;

  /** @param host - The client this namespace issues requests through. */
  constructor(host: StorageConsoleHost) {
    this.#host = host;
  }

  /** `GET /storage-bindings` — the account's bindings, retired ones elided unless asked for. */
  async list(options?: ListStorageBindingsOptions): Promise<StorageBinding[]> {
    const res = await this.#host.request<unknown>({
      method: "GET",
      path: "/storage-bindings",
      query: { includeRetired: options?.includeRetired },
      signal: options?.signal,
    });
    return unwrap<StorageBinding[]>(res, "bindings");
  }

  /**
   * `POST /storage-bindings` — store a destination (`201`, the binding answered flat).
   *
   * @throws {ApiError} `403 forbidden` (not an account admin), `422` for a refused
   *   destination (a non-empty `rootPrefix`, an unreachable endpoint).
   */
  async create(
    input: CreateStorageBindingInput,
    options?: StorageConsoleOptions,
  ): Promise<StorageBinding> {
    const res = await this.#host.request<unknown>({
      method: "POST",
      path: "/storage-bindings",
      body: input,
      signal: options?.signal,
    });
    return bindingBody(res);
  }

  /**
   * `GET /storage-bindings/:id` — one binding.
   *
   * @throws {ApiError} `404 not_found` — uniform, so another account's id is
   *   indistinguishable from a nonexistent one.
   */
  async get(id: string, options?: StorageConsoleOptions): Promise<StorageBinding> {
    const res = await this.#host.request<unknown>({
      method: "GET",
      path: path`/storage-bindings/${id}`,
      signal: options?.signal,
    });
    return bindingBody(res);
  }

  /**
   * `DELETE /storage-bindings/:id` — retire a binding. Resolves to nothing.
   *
   * Retire, not erase: the row stays readable (with `includeRetired`) so
   * versions that live on it keep their provenance.
   *
   * @throws {ApiError} `409` while asset versions still sit under the binding
   *   (`connection_in_use`-shaped refusal), `403 forbidden`, `404 not_found`.
   */
  async delete(id: string, options?: StorageConsoleOptions): Promise<void> {
    await this.#host.request<unknown>({
      method: "DELETE",
      path: path`/storage-bindings/${id}`,
      signal: options?.signal,
    });
  }

  /**
   * `POST /storage-bindings/:id/migrate` — enqueue copy → verify → swap onto a
   * new revision (`202`).
   *
   * The migration is asynchronous: the answer counts the jobs, and the caller
   * polls the binding (`get`) or the version it moves.
   *
   * @throws {ApiError} `403 forbidden`, `404 not_found`, `409` when a migration
   *   is already running.
   */
  async migrate(id: string, options?: StorageConsoleOptions): Promise<StorageMigration> {
    const res = await this.#host.request<StorageMigration>({
      method: "POST",
      path: path`/storage-bindings/${id}/migrate`,
      signal: options?.signal,
    });
    return res.body;
  }
}

/**
 * `client.console.storage.settings.*` — `GET|PATCH /agent-settings`.
 *
 * Account-scoped (§P4/A-D4): members may read, only an account admin may patch.
 */
export class AgentSettingsApi {
  readonly #host: StorageConsoleHost;

  /** @param host - The client this namespace issues requests through. */
  constructor(host: StorageConsoleHost) {
    this.#host = host;
  }

  /** `GET /agent-settings` — the effective limits and the stored values behind them. */
  async get(options?: StorageConsoleOptions): Promise<AgentSettings> {
    const res = await this.#host.request<unknown>({
      method: "GET",
      path: "/agent-settings",
      signal: options?.signal,
    });
    return settingsBody(res);
  }

  /**
   * `PATCH /agent-settings` — change the stored values. Fields are sent by
   * omission; `null` clears one back to the default.
   *
   * @throws {ApiError} `403 forbidden` (not an account admin), `422` for an
   *   unknown field, a non-positive value or one above the server ceiling, and
   *   the uniform `404` for an unknown `storageBindingId`.
   */
  async patch(input: AgentSettingsPatch, options?: StorageConsoleOptions): Promise<AgentSettings> {
    const res = await this.#host.request<unknown>({
      method: "PATCH",
      path: "/agent-settings",
      body: input,
      signal: options?.signal,
    });
    return settingsBody(res);
  }
}

/**
 * The `console.storage` namespace on a `W6WClient` — bindings and the agent
 * limits they bound.
 *
 * @example
 * ```ts
 * const [binding] = await client.console.storage.bindings.list();
 * await client.console.storage.settings.patch({ maxFileBytes: 10 * 1024 * 1024 });
 * ```
 */
export class StorageConsoleApi {
  /** `console.storage.bindings.*`. */
  readonly bindings: StorageBindingsApi;
  /** `console.storage.settings.*`. */
  readonly settings: AgentSettingsApi;

  /** @param host - The client this namespace group issues requests through. */
  constructor(host: StorageConsoleHost) {
    this.bindings = new StorageBindingsApi(host);
    this.settings = new AgentSettingsApi(host);
  }
}
