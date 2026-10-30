/**
 * `client.dataStores.*` — the account's persistent key-value, document and
 * table storage (contract `0.15.0`, 14 operations, one HTTP call each).
 *
 * Stores are **project-scoped**: every route accepts an optional `?project=`,
 * resolved per call, then from the client's default, and otherwise left to the
 * server (the account's default project).
 *
 * Two operations use the explicit text transport (`docs/implementation.md` §3):
 * `importCsv` sends the CSV string verbatim as `text/csv`, and `exportCsv`
 * returns the body verbatim as a string. Errors keep the ordinary
 * {@linkcode ApiError} shape; the server's `field`/`row`/`column` extras are on
 * `error.raw.error`.
 *
 * @module
 */

import type { ResolvedConfig } from "./config.ts";
import { type CallOptions, type HttpResponse, path, type RequestOptions } from "./http.ts";
import type {
  DataStore,
  DataStoreEntry,
  DataStoreEntryPage,
  DataStoreKind,
  DataStorePage,
  DataStoreRowSet,
  DataStoreSchema,
} from "./types.ts";

/** The slice of `W6WClient` these namespaces need: the transport plus the default project. */
export interface DataStoresHost {
  /** The resolved configuration; only `project` is read. */
  readonly config: ResolvedConfig;
  /** Perform one request. */
  request<T>(options: RequestOptions): Promise<HttpResponse<T>>;
}

/** Per-call options shared by every data-store operation. */
export interface DataStoreOptions extends CallOptions {
  /** Project id to scope this call to; overrides the client's default. */
  project?: string;
}

/** Options of `dataStores.list`. */
export interface DataStoreListOptions extends DataStoreOptions {
  kind?: DataStoreKind;
  cursor?: string;
  limit?: number;
}

/** The body of `dataStores.create`. */
export interface DataStoreCreateInput {
  kind: DataStoreKind;
  name: string;
  description?: string;
  /** Table stores only. */
  schema?: DataStoreSchema;
}

/** The body of `dataStores.update`; an omitted field is left alone. */
export interface DataStorePatch {
  name?: string;
  description?: string;
  schema?: DataStoreSchema;
}

/** Options of `dataStores.entries.list`. */
export interface DataStoreEntryListOptions extends DataStoreOptions {
  prefix?: string;
  cursor?: string;
  limit?: number;
}

/** The body of `dataStores.entries.set`. */
export interface DataStoreEntrySetInput {
  value: unknown;
  /** Conditional write: only if the entry is at this version (`409 version_conflict`). */
  ifVersion?: number;
  ttlSeconds?: number;
}

/** Options of `dataStores.entries.insert`. */
export interface DataStoreInsertOptions extends DataStoreOptions {
  ttlSeconds?: number;
}

/** The filter of `dataStores.entries.query`. */
export interface DataStoreQuery {
  /** One `where[<col>]=<value>` query key per column. */
  where?: Record<string, string | number | boolean>;
  order?: string;
  limit?: number;
}

/** The `dataStores.entries` namespace. */
export class DataStoreEntriesApi {
  readonly #host: DataStoresHost;

  /** @param host - The client this namespace issues requests through. */
  constructor(host: DataStoresHost) {
    this.#host = host;
  }

  #project(options?: DataStoreOptions): string | undefined {
    return options?.project ?? this.#host.config.project ?? undefined;
  }

  /** List a store's entries, paged by key. */
  async list(id: string, options?: DataStoreEntryListOptions): Promise<DataStoreEntryPage> {
    const res = await this.#host.request<DataStoreEntryPage>({
      method: "GET",
      path: path`/data-stores/${id}/entries`,
      query: {
        prefix: options?.prefix,
        cursor: options?.cursor,
        limit: options?.limit,
        project: this.#project(options),
      },
      signal: options?.signal,
    });
    return res.body;
  }

  /** Fetch one entry by key. `404 entry_not_found` when absent. */
  async get(id: string, key: string, options?: DataStoreOptions): Promise<DataStoreEntry> {
    const res = await this.#host.request<DataStoreEntry>({
      method: "GET",
      path: path`/data-stores/${id}/entries/${key}`,
      query: { project: this.#project(options) },
      signal: options?.signal,
    });
    return res.body;
  }

  /** Create or replace one entry by key. */
  async set(
    id: string,
    key: string,
    input: DataStoreEntrySetInput,
    options?: DataStoreOptions,
  ): Promise<DataStoreEntry> {
    const res = await this.#host.request<DataStoreEntry>({
      method: "PUT",
      path: path`/data-stores/${id}/entries/${key}`,
      query: { project: this.#project(options) },
      body: { value: input.value, ifVersion: input.ifVersion, ttlSeconds: input.ttlSeconds },
    });
    return res.body;
  }

  /** Insert one row into a table store; the server generates the key. */
  async insert(
    id: string,
    row: Record<string, unknown>,
    options?: DataStoreInsertOptions,
  ): Promise<DataStoreEntry> {
    const res = await this.#host.request<DataStoreEntry>({
      method: "POST",
      path: path`/data-stores/${id}/entries`,
      query: { project: this.#project(options) },
      body: { value: row, ttlSeconds: options?.ttlSeconds },
    });
    return res.body;
  }

  /** Atomically add `by` (default 1, sent as no body) to a numeric entry. */
  async increment(
    id: string,
    key: string,
    by?: number,
    options?: DataStoreOptions,
  ): Promise<DataStoreEntry> {
    const res = await this.#host.request<DataStoreEntry>({
      method: "POST",
      path: path`/data-stores/${id}/entries/${key}/increment`,
      query: { project: this.#project(options) },
      ...(by === undefined ? {} : { body: { by } }),
    });
    return res.body;
  }

  /** Delete one entry by key. `404 entry_not_found` when absent. */
  async delete(id: string, key: string, options?: DataStoreOptions): Promise<void> {
    await this.#host.request<unknown>({
      method: "DELETE",
      path: path`/data-stores/${id}/entries/${key}`,
      query: { project: this.#project(options) },
    });
  }

  /** Filter and order a table store's rows (query mode: `{items}` only). */
  async query(
    id: string,
    query?: DataStoreQuery,
    options?: DataStoreOptions,
  ): Promise<DataStoreRowSet> {
    const where: Record<string, string | number | boolean> = {};
    for (const [col, v] of Object.entries(query?.where ?? {})) where[`where[${col}]`] = v;
    const res = await this.#host.request<DataStoreRowSet>({
      method: "GET",
      path: path`/data-stores/${id}/entries`,
      query: {
        ...where,
        order: query?.order,
        limit: query?.limit,
        project: this.#project(options),
      },
      signal: options?.signal,
    });
    return res.body;
  }
}

/**
 * The `dataStores` namespace on a `W6WClient`.
 *
 * @example
 * ```ts
 * const store = await client.dataStores.create({ kind: "kv", name: "counters" });
 * await client.dataStores.entries.increment(store.id, "visits");
 * ```
 */
export class DataStoresApi {
  readonly #host: DataStoresHost;
  /** Entry operations. */
  readonly entries: DataStoreEntriesApi;

  /** @param host - The client this namespace issues requests through. */
  constructor(host: DataStoresHost) {
    this.#host = host;
    this.entries = new DataStoreEntriesApi(host);
  }

  #project(options?: DataStoreOptions): string | undefined {
    return options?.project ?? this.#host.config.project ?? undefined;
  }

  /** List the project's stores. */
  async list(options?: DataStoreListOptions): Promise<DataStorePage> {
    const res = await this.#host.request<DataStorePage>({
      method: "GET",
      path: "/data-stores",
      query: {
        kind: options?.kind,
        cursor: options?.cursor,
        limit: options?.limit,
        project: this.#project(options),
      },
      signal: options?.signal,
    });
    return res.body;
  }

  /** Fetch one store. `404 data_store_not_found` when absent. */
  async get(id: string, options?: DataStoreOptions): Promise<DataStore> {
    const res = await this.#host.request<DataStore>({
      method: "GET",
      path: path`/data-stores/${id}`,
      query: { project: this.#project(options) },
      signal: options?.signal,
    });
    return res.body;
  }

  /** Create a store (the server answers `201`). */
  async create(input: DataStoreCreateInput, options?: DataStoreOptions): Promise<DataStore> {
    const res = await this.#host.request<DataStore>({
      method: "POST",
      path: "/data-stores",
      query: { project: this.#project(options) },
      body: {
        kind: input.kind,
        name: input.name,
        description: input.description,
        schema: input.schema,
      },
    });
    return res.body;
  }

  /** Patch a store's name, description or schema. */
  async update(id: string, patch: DataStorePatch, options?: DataStoreOptions): Promise<DataStore> {
    const res = await this.#host.request<DataStore>({
      method: "PATCH",
      path: path`/data-stores/${id}`,
      query: { project: this.#project(options) },
      body: { name: patch.name, description: patch.description, schema: patch.schema },
    });
    return res.body;
  }

  /** Archive a store (soft delete; `204`). */
  async archive(id: string, options?: DataStoreOptions): Promise<void> {
    await this.#host.request<unknown>({
      method: "DELETE",
      path: path`/data-stores/${id}`,
      query: { project: this.#project(options) },
    });
  }

  /** Import CSV text (header row = column names) into a table store. */
  async importCsv(
    id: string,
    csv: string,
    options?: DataStoreOptions,
  ): Promise<{ imported: number }> {
    const res = await this.#host.request<{ imported: number }>({
      method: "POST",
      path: path`/data-stores/${id}/import`,
      query: { project: this.#project(options) },
      body: csv,
      bodyEncoding: "csv",
    });
    return res.body;
  }

  /** Export a table store as CSV text, returned verbatim. */
  async exportCsv(id: string, options?: DataStoreOptions): Promise<string> {
    const res = await this.#host.request<string>({
      method: "GET",
      path: path`/data-stores/${id}/export`,
      query: { project: this.#project(options) },
      responseType: "text",
      signal: options?.signal,
    });
    return res.body;
  }
}
