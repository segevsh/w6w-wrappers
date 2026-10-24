/**
 * `client.agents.*` — agent DRAFTS (contract 0.11.0). Every agent answers
 * `runnable: false`: no Agent runtime, RAG or chat history exists (A22).
 *
 * `update` sends the body `revision` and, when given, the
 * `x-w6w-if-unmodified-since` header. A missing header is a `428`, a stale
 * revision a `409` carrying the current one — both surface as {@linkcode ApiError}.
 *
 * @module
 */

import { type CallOptions, type HttpResponse, path, type RequestOptions } from "./http.ts";
import {
  type Agent,
  type AgentsApi as AgentsApiShape,
  type CreateAgentInput,
  type ListArchivedOptions,
  type PreconditionOptions,
  unwrap,
  type UpdateAgentInput,
} from "./types.ts";

/** The precondition header (same name as the workflow and function arms). */
const PRECONDITION_HEADER = "x-w6w-if-unmodified-since";

/** The slice of `W6WClient` this namespace needs: the transport and nothing else. */
export interface AgentsHost {
  /** Perform one request. */
  request<T>(options: RequestOptions): Promise<HttpResponse<T>>;
}

/** `client.agents` — see the module doc. */
export class AgentsApi implements AgentsApiShape {
  readonly #host: AgentsHost;

  constructor(host: AgentsHost) {
    this.#host = host;
  }

  /** List agent drafts visible to the caller. */
  async list(opts?: ListArchivedOptions): Promise<Agent[]> {
    const res = await this.#host.request<unknown>({
      method: "GET",
      path: "/agents",
      query: { includeArchived: opts?.includeArchived },
      signal: opts?.signal,
    });
    return unwrap<Agent[]>(res, "agents");
  }

  /** Create an agent draft; every field is optional. */
  async create(input: CreateAgentInput = {}, opts?: CallOptions): Promise<Agent> {
    const res = await this.#host.request<unknown>({
      method: "POST",
      path: "/agents",
      body: input,
      signal: opts?.signal,
    });
    return unwrap<Agent>(res, "agent");
  }

  /** Fetch one agent draft. */
  async get(id: string, opts?: CallOptions): Promise<Agent> {
    const res = await this.#host.request<unknown>({
      method: "GET",
      path: path`/agents/${id}`,
      signal: opts?.signal,
    });
    return unwrap<Agent>(res, "agent");
  }

  /** Patch a draft. Sends body `revision` and the precondition header when given. */
  async update(id: string, patch: UpdateAgentInput, opts?: PreconditionOptions): Promise<Agent> {
    const res = await this.#host.request<unknown>({
      method: "PATCH",
      path: path`/agents/${id}`,
      body: patch,
      ...(opts?.ifUnmodifiedSince
        ? { headers: { [PRECONDITION_HEADER]: opts.ifUnmodifiedSince } }
        : {}),
      signal: opts?.signal,
    });
    return unwrap<Agent>(res, "agent");
  }

  /** Archive a draft; returns the archived row. */
  async archive(id: string, opts?: CallOptions): Promise<Agent> {
    const res = await this.#host.request<unknown>({
      method: "POST",
      path: path`/agents/${id}/archive`,
      signal: opts?.signal,
    });
    return unwrap<Agent>(res, "agent");
  }
}
