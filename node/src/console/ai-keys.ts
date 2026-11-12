/**
 * `client.console.aiKeys.*` — the invoking user's personal AI-provider
 * defaults: which of their own ("Only me") connections is used for a provider
 * when a route says `invoking_user`.
 *
 * **Studio-internal, not the published partner contract** (`docs/console.md`).
 * **No subject, tenant or account parameter exists anywhere here** — the
 * server derives "me" from the bearer, and refuses a non end-user caller with
 * `403 user_context_required`.
 *
 * @module
 */

import { type HttpResponse, path, type RequestOptions } from "../http.ts";
import { unwrap } from "../types.ts";

/** The slice of `W6WClient` this namespace needs: the transport. */
export interface AiKeysHost {
  /** Perform one request. */
  request<T>(options: RequestOptions): Promise<HttpResponse<T>>;
}

/** One personal default: provider app → the caller's own connection. */
export interface AiKeyDefault {
  providerAppId: string;
  connectionId: string;
  /** `"unavailable"` when the connection/credential is disabled, revoked or invalid. */
  status: "active" | "unavailable";
}

/** The `console.aiKeys` namespace on a `W6WClient`. */
export class AiKeysApi {
  readonly #host: AiKeysHost;

  /** @param host - The client this namespace issues requests through. */
  constructor(host: AiKeysHost) {
    this.#host = host;
  }

  /** `GET /me/ai-keys/defaults` — the caller's defaults. Unwraps `{defaults}`. */
  async defaults(): Promise<AiKeyDefault[]> {
    const res = await this.#host.request<unknown>({
      method: "GET",
      path: "/me/ai-keys/defaults",
    });
    return unwrap<AiKeyDefault[]>(res, "defaults");
  }

  /**
   * `PUT /me/ai-keys/defaults/:providerAppId` — make `connectionId` the default.
   * The body is exactly `{connectionId}`. Unwraps `{default}`.
   *
   * @throws {ApiError} `404 unknown_connection`; `409 credential_scope_mismatch`;
   *   `400 invalid_body`; `403 user_context_required`.
   */
  async setDefault(providerAppId: string, connectionId: string): Promise<AiKeyDefault> {
    const res = await this.#host.request<unknown>({
      method: "PUT",
      path: path`/me/ai-keys/defaults/${providerAppId}`,
      body: { connectionId },
    });
    return unwrap<AiKeyDefault>(res, "default");
  }

  /** `DELETE /me/ai-keys/defaults/:providerAppId` — clear a default (204). */
  async clearDefault(providerAppId: string): Promise<void> {
    await this.#host.request<unknown>({
      method: "DELETE",
      path: path`/me/ai-keys/defaults/${providerAppId}`,
    });
  }
}
