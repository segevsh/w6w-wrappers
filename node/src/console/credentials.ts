/**
 * `client.console.credentials.*` — the stored-credential resource: list, get,
 * create, rename, rotate, disable, enable, test, dependents, delete.
 *
 * **Console-only, not the published partner contract.** Like every other
 * connection write op, this namespace lives under the `console` subpath
 * export (`@w6w/sdk/console`), excluded from `endpoints.json`'s
 * `operations[]` and from the root barrel (D-E2; `docs/parity.md`). The
 * types below are hand-typed from the wire: the SDK never imports
 * `@w6w/types`.
 *
 * **Secret discipline.** `source` (on {@linkcode CredentialsApi.create} and
 * {@linkcode CredentialsApi.rotate}) is an opaque secret payload — forwarded
 * verbatim, never inspected, logged, transformed or echoed. No response type
 * here carries a source payload, ciphertext or token: {@linkcode
 * CredentialSummary} is a projection (`display` holds non-secret labels
 * only), so there is no field a caller could read a secret back from.
 *
 * Methods take no `project` parameter: credentials are scoped by
 * tenant/account from the credential alone, so {@linkcode CredentialsHost}
 * needs only the transport, mirroring `ConnectionsHost`.
 *
 * @module
 */

import { type HttpResponse, path, type RequestOptions } from "../http.ts";
import { unwrap } from "../types.ts";

/**
 * The slice of `W6WClient` this namespace needs: the transport, and nothing
 * else — mirrors `ConnectionsHost`.
 */
export interface CredentialsHost {
  /** Perform one request. */
  request<T>(options: RequestOptions): Promise<HttpResponse<T>>;
}

/** Lifecycle status of a stored credential. */
export type CredentialStatus = "active" | "disabled" | "revoked";

/** The closed set of credential failure codes a test (or a use) can report. */
export type CredentialErrorCode =
  | "credential_disabled"
  | "credential_missing"
  | "credential_revoked"
  | "delegation_rejected"
  | "provider_unsupported"
  | "scope_not_approved"
  | "auth_not_found"
  | "jit_unavailable_in_background"
  | "credential_invalid";

/**
 * A stored credential, as the server projects it. Never carries a source
 * payload, ciphertext or token.
 */
export interface CredentialSummary {
  /** Server-issued id. */
  id: string;
  /** Human-chosen label. */
  name: string;
  /** The credential contract, e.g. a provider-backed or `api_key` contract. */
  contract: string;
  /** Lifecycle status. */
  status: CredentialStatus;
  /** Bumped on every rotation. */
  revision: number;
  /** Non-secret display labels. */
  display: Record<string, string>;
  /** `true` when the credential is private to its creator. */
  private: boolean;
  /** How many connections currently use this credential. */
  connectionCount: number;
  /** ISO-8601 timestamp. */
  createdAt: string;
  /** ISO-8601 timestamp. */
  updatedAt: string;
}

/**
 * `test`'s result — the whole response body, no envelope key. `ok: false` is
 * still a 200 and resolves; `code` names the failure when there is one.
 */
export interface CredentialTestResult {
  ok: boolean;
  code?: CredentialErrorCode;
  message?: string;
}

/** `GET /credentials/:id/dependents` payload (the `dependents` key). */
export interface CredentialDependents {
  connections: { id: string; appId: string; authKey: string; displayName: string }[];
}

/** Optional filters for {@linkcode CredentialsApi.list}; only defined keys are sent. */
export interface CredentialListFilter {
  contract?: string;
  appId?: string;
  authKey?: string;
}

/**
 * The `console.credentials` namespace on a `W6WClient`.
 *
 * @example
 * ```ts
 * const cred = await client.console.credentials.create({
 *   name: "Ops mailbox",
 *   contract: "api_key",
 *   source: { key: "sk_live_…" },
 * });
 * await client.console.credentials.rotate(cred.id, { source: { key: "sk_new_…" } });
 * ```
 */
export class CredentialsApi {
  readonly #host: CredentialsHost;

  /**
   * @param host - The client this namespace issues requests through.
   */
  constructor(host: CredentialsHost) {
    this.#host = host;
  }

  /**
   * List credentials, optionally filtered.
   *
   * @param filter - Sends only the keys that are defined; none ⇒ no query string.
   * @returns The credentials, unwrapped from the `credentials` envelope.
   */
  async list(filter?: CredentialListFilter): Promise<CredentialSummary[]> {
    const query: Record<string, string> = {};
    if (filter?.contract !== undefined) query.contract = filter.contract;
    if (filter?.appId !== undefined) query.appId = filter.appId;
    if (filter?.authKey !== undefined) query.authKey = filter.authKey;
    const res = await this.#host.request<unknown>({
      method: "GET",
      path: "/credentials",
      query,
    });
    return unwrap<CredentialSummary[]>(res, "credentials");
  }

  /**
   * Fetch one credential.
   *
   * @throws {ApiError} `404 unknown_credential` (also for a foreign id).
   */
  async get(id: string): Promise<CredentialSummary> {
    const res = await this.#host.request<unknown>({
      method: "GET",
      path: path`/credentials/${id}`,
    });
    return unwrap<CredentialSummary>(res, "credential");
  }

  /**
   * Create a credential. `source` is opaque — see the module header.
   *
   * @throws {ApiError} `400 invalid_contract` (a `legacy:*` contract);
   *   `400 provider_unsupported`.
   */
  async create(
    body: { name: string; contract: string; source: Record<string, unknown> },
  ): Promise<CredentialSummary> {
    const res = await this.#host.request<unknown>({
      method: "POST",
      path: "/credentials",
      body,
    });
    return unwrap<CredentialSummary>(res, "credential");
  }

  /**
   * Rename a credential.
   *
   * The response envelope is `{credential}` (pinned by the project's
   * RECONCILE R-11; I-5 left it unspecified).
   *
   * @throws {ApiError} `404 unknown_credential`.
   */
  async update(id: string, body: { name: string }): Promise<CredentialSummary> {
    const res = await this.#host.request<unknown>({
      method: "PATCH",
      path: path`/credentials/${id}`,
      body,
    });
    return unwrap<CredentialSummary>(res, "credential");
  }

  /**
   * Replace a credential's secret. `source` is opaque — see the module header.
   *
   * @throws {ApiError} `404 unknown_credential`.
   */
  async rotate(id: string, body: { source: Record<string, unknown> }): Promise<CredentialSummary> {
    const res = await this.#host.request<unknown>({
      method: "POST",
      path: path`/credentials/${id}/rotate`,
      body,
    });
    return unwrap<CredentialSummary>(res, "credential");
  }

  /**
   * Disable a credential (reversible with {@linkcode enable}).
   *
   * @throws {ApiError} `404 unknown_credential`.
   */
  async disable(id: string): Promise<CredentialSummary> {
    const res = await this.#host.request<unknown>({
      method: "POST",
      path: path`/credentials/${id}/disable`,
    });
    return unwrap<CredentialSummary>(res, "credential");
  }

  /**
   * Re-enable a disabled credential.
   *
   * @throws {ApiError} `404 unknown_credential`.
   */
  async enable(id: string): Promise<CredentialSummary> {
    const res = await this.#host.request<unknown>({
      method: "POST",
      path: path`/credentials/${id}/enable`,
    });
    return unwrap<CredentialSummary>(res, "credential");
  }

  /**
   * Probe a credential. **No envelope key — the whole body IS the result.**
   * A failed probe (`ok: false`) is still a 200 and resolves; only a genuine
   * non-2xx (e.g. `404 unknown_credential`) raises `ApiError`.
   */
  async test(id: string): Promise<CredentialTestResult> {
    const res = await this.#host.request<CredentialTestResult>({
      method: "POST",
      path: path`/credentials/${id}/test`,
    });
    return res.body;
  }

  /**
   * Which connections use this credential? Unwraps `{dependents}`.
   *
   * @throws {ApiError} `404 unknown_credential`.
   */
  async dependents(id: string): Promise<CredentialDependents> {
    const res = await this.#host.request<unknown>({
      method: "GET",
      path: path`/credentials/${id}/dependents`,
    });
    return unwrap<CredentialDependents>(res, "dependents");
  }

  /**
   * Delete a credential. Returns nothing. There is **no force option** (D-B5):
   * a credential in use is refused, never cascaded.
   *
   * @throws {ApiError} `404 unknown_credential`; `409 credential_in_use` — the
   *   dependents are at `raw.error.dependents.connections`.
   */
  async delete(id: string): Promise<void> {
    await this.#host.request<unknown>({
      method: "DELETE",
      path: path`/credentials/${id}`,
    });
  }
}
