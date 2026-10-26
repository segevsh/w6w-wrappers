/**
 * `client.context.*` — context collections and their text entries (contract 0.11.0).
 *
 * `entries.update` is a precondition write: it sends the body `revision` and,
 * when given, the `x-w6w-if-unmodified-since` header. A missing header is a
 * `428`, a stale one a `409` — both surface as {@linkcode ApiError}.
 *
 * @module
 */

import { type CallOptions, type HttpResponse, path, type RequestOptions } from "./http.ts";
import {
  type ContextApi as ContextApiShape,
  type ContextCollection,
  type ContextEntry,
  type ContextEntryView,
  type CreateContextCollectionInput,
  type CreateContextEntryInput,
  type CreateStandaloneContextEntryInput,
  type ListArchivedOptions,
  type ListContextEntriesOptions,
  type ListPagedOptions,
  type PreconditionOptions,
  unwrap,
  type UpdateContextCollectionInput,
  type UpdateContextEntryInput,
} from "./types.ts";

/** The precondition header (same name as the workflow and function arms). */
const PRECONDITION_HEADER = "x-w6w-if-unmodified-since";

/** The slice of `W6WClient` this namespace needs: the transport and nothing else. */
export interface ContextHost {
  /** Perform one request. */
  request<T>(options: RequestOptions): Promise<HttpResponse<T>>;
}

/** The `client.context.entries.*` half. */
class CollectionEntriesApi {
  readonly #host: ContextHost;

  constructor(host: ContextHost) {
    this.#host = host;
  }

  /** List a collection's entries. `id` is the collection id. */
  async list(id: string, opts?: ListArchivedOptions): Promise<ContextEntry[]> {
    const res = await this.#host.request<unknown>({
      method: "GET",
      path: path`/context-collections/${id}/entries`,
      query: { includeArchived: opts?.includeArchived },
      signal: opts?.signal,
    });
    return unwrap<ContextEntry[]>(res, "entries");
  }

  /** Add a text entry to a collection. */
  async create(
    id: string,
    input: CreateContextEntryInput,
    opts?: CallOptions,
  ): Promise<ContextEntryView> {
    const res = await this.#host.request<unknown>({
      method: "POST",
      path: path`/context-collections/${id}/entries`,
      body: input,
      signal: opts?.signal,
    });
    return unwrap<ContextEntryView>(res, "entry");
  }

  /** Replace an entry's text. Sends body `revision` and the precondition header when given. */
  async update(
    id: string,
    entryId: string,
    input: UpdateContextEntryInput,
    opts?: PreconditionOptions,
  ): Promise<ContextEntryView> {
    const res = await this.#host.request<unknown>({
      method: "PUT",
      path: path`/context-collections/${id}/entries/${entryId}`,
      body: input,
      ...(opts?.ifUnmodifiedSince
        ? { headers: { [PRECONDITION_HEADER]: opts.ifUnmodifiedSince } }
        : {}),
      signal: opts?.signal,
    });
    return unwrap<ContextEntryView>(res, "entry");
  }
}

/** `client.context` — see the module doc. */
export class ContextApi implements ContextApiShape {
  readonly #host: ContextHost;
  /** Text entries of a collection. */
  readonly entries: CollectionEntriesApi;

  constructor(host: ContextHost) {
    this.#host = host;
    this.entries = new CollectionEntriesApi(host);
  }

  /** List collections visible to the caller. */
  async list(opts?: ListPagedOptions): Promise<ContextCollection[]> {
    const res = await this.#host.request<unknown>({
      method: "GET",
      path: "/context-collections",
      query: { includeArchived: opts?.includeArchived, limit: opts?.limit },
      signal: opts?.signal,
    });
    return unwrap<ContextCollection[]>(res, "collections");
  }

  /** Create an (empty) collection. */
  async create(
    input: CreateContextCollectionInput,
    opts?: CallOptions,
  ): Promise<ContextCollection> {
    const res = await this.#host.request<unknown>({
      method: "POST",
      path: "/context-collections",
      body: input,
      signal: opts?.signal,
    });
    return unwrap<ContextCollection>(res, "collection");
  }

  /** Fetch one collection. */
  async get(id: string, opts?: CallOptions): Promise<ContextCollection> {
    const res = await this.#host.request<unknown>({
      method: "GET",
      path: path`/context-collections/${id}`,
      signal: opts?.signal,
    });
    return unwrap<ContextCollection>(res, "collection");
  }

  /** Patch a collection's name, description or tags. */
  async update(
    id: string,
    patch: UpdateContextCollectionInput,
    opts?: CallOptions,
  ): Promise<ContextCollection> {
    const res = await this.#host.request<unknown>({
      method: "PATCH",
      path: path`/context-collections/${id}`,
      body: patch,
      signal: opts?.signal,
    });
    return unwrap<ContextCollection>(res, "collection");
  }

  /** Archive a collection; returns the archived row. */
  async archive(id: string, opts?: CallOptions): Promise<ContextCollection> {
    const res = await this.#host.request<unknown>({
      method: "POST",
      path: path`/context-collections/${id}/archive`,
      signal: opts?.signal,
    });
    return unwrap<ContextCollection>(res, "collection");
  }
}

/**
 * `client.contextEntries.*` — top-level, collection-independent context entries
 * (contract 0.12.0). `update` is a precondition write like `context.entries.update`.
 */
export class ContextEntriesApi {
  readonly #host: ContextHost;

  constructor(host: ContextHost) {
    this.#host = host;
  }

  /** List entries visible to the caller; `collectionId` filters to one collection. */
  async list(opts?: ListContextEntriesOptions): Promise<ContextEntry[]> {
    const res = await this.#host.request<unknown>({
      method: "GET",
      path: "/context-entries",
      query: {
        collectionId: opts?.collectionId,
        includeArchived: opts?.includeArchived,
        project: opts?.project,
      },
      signal: opts?.signal,
    });
    return unwrap<ContextEntry[]>(res, "entries");
  }

  /** Create a text entry, optionally a member of `collectionIds`. */
  async create(
    input: CreateStandaloneContextEntryInput,
    opts?: CallOptions,
  ): Promise<ContextEntryView> {
    const res = await this.#host.request<unknown>({
      method: "POST",
      path: "/context-entries",
      body: input,
      signal: opts?.signal,
    });
    return unwrap<ContextEntryView>(res, "entry");
  }

  /** Fetch one entry. */
  async get(id: string, opts?: CallOptions): Promise<ContextEntryView> {
    const res = await this.#host.request<unknown>({
      method: "GET",
      path: path`/context-entries/${id}`,
      signal: opts?.signal,
    });
    return unwrap<ContextEntryView>(res, "entry");
  }

  /** Replace an entry's text. Sends body `revision` and the precondition header when given. */
  async update(
    id: string,
    input: UpdateContextEntryInput,
    opts?: PreconditionOptions,
  ): Promise<ContextEntryView> {
    const res = await this.#host.request<unknown>({
      method: "PUT",
      path: path`/context-entries/${id}`,
      body: input,
      ...(opts?.ifUnmodifiedSince
        ? { headers: { [PRECONDITION_HEADER]: opts.ifUnmodifiedSince } }
        : {}),
      signal: opts?.signal,
    });
    return unwrap<ContextEntryView>(res, "entry");
  }

  /** Archive an entry. */
  async archive(id: string, opts?: CallOptions): Promise<ContextEntryView> {
    const res = await this.#host.request<unknown>({
      method: "POST",
      path: path`/context-entries/${id}/archive`,
      signal: opts?.signal,
    });
    return unwrap<ContextEntryView>(res, "entry");
  }

  /** Add an entry to a collection (idempotent). */
  async addToCollection(
    id: string,
    collectionId: string,
    opts?: CallOptions,
  ): Promise<ContextEntry> {
    const res = await this.#host.request<unknown>({
      method: "PUT",
      path: path`/context-entries/${id}/collections/${collectionId}`,
      signal: opts?.signal,
    });
    return unwrap<ContextEntry>(res, "entry");
  }

  /** Remove an entry from a collection (idempotent). */
  async removeFromCollection(
    id: string,
    collectionId: string,
    opts?: CallOptions,
  ): Promise<ContextEntry> {
    const res = await this.#host.request<unknown>({
      method: "DELETE",
      path: path`/context-entries/${id}/collections/${collectionId}`,
      signal: opts?.signal,
    });
    return unwrap<ContextEntry>(res, "entry");
  }
}
