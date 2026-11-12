/**
 * `client.console.aiCredentialPolicy.*` — the caller's OWN tenant's AI
 * credential policy (which key kinds AI calls may use).
 *
 * **Studio-internal, not the published partner contract** (`docs/console.md`).
 * **The tenant is never a parameter** — the route is scoped by the bearer's
 * tenant claim; `put` additionally needs a tenant admin (`403` otherwise).
 *
 * @module
 */

import { type HttpResponse, type RequestOptions } from "../http.ts";

/** The slice of `W6WClient` this namespace needs: the transport. */
export interface AiCredentialPolicyHost {
  /** Perform one request. */
  request<T>(options: RequestOptions): Promise<HttpResponse<T>>;
}

/** Which key kinds AI calls may use: both, account keys only, or personal keys only. */
export type AiCredentialPolicyMode = "both" | "account_only" | "user_only";

/** `GET`/`PUT /tenant/ai-credential-policy` body, returned as-is. */
export interface AiCredentialPolicyResponse {
  policy: { mode: AiCredentialPolicyMode };
  /** What the policy touches: how many account-keyed routes it affects. */
  effect: { accountRoutes: number };
}

/** Input of `put`. Only `mode` is ever sent. */
export interface SetAiCredentialPolicyInput {
  mode: AiCredentialPolicyMode;
}

/** The `console.aiCredentialPolicy` namespace on a `W6WClient`. */
export class AiCredentialPolicyApi {
  readonly #host: AiCredentialPolicyHost;

  /** @param host - The client this namespace issues requests through. */
  constructor(host: AiCredentialPolicyHost) {
    this.#host = host;
  }

  /** `GET /tenant/ai-credential-policy` (any member). */
  async get(): Promise<AiCredentialPolicyResponse> {
    const res = await this.#host.request<AiCredentialPolicyResponse>({
      method: "GET",
      path: "/tenant/ai-credential-policy",
    });
    return res.body;
  }

  /**
   * `PUT /tenant/ai-credential-policy` (tenant admin). The body is built from
   * an allowlist of exactly `mode`; a widened input cannot smuggle a key.
   *
   * @throws {ApiError} `403` when not a tenant admin; `400 invalid_body` for a bad mode.
   */
  async put(input: SetAiCredentialPolicyInput): Promise<AiCredentialPolicyResponse> {
    const res = await this.#host.request<AiCredentialPolicyResponse>({
      method: "PUT",
      path: "/tenant/ai-credential-policy",
      body: { mode: input.mode },
    });
    return res.body;
  }
}
