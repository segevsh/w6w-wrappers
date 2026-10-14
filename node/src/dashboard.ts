/**
 * `client.dashboard.stats()` — the account-scoped run rollup.
 *
 * One operation, `GET /dashboard/stats`. It is **account-scoped**: the account
 * comes from the credential, so there is no `project` parameter and the client's
 * default project is never sent. The response has no envelope key — the rollup
 * IS the body.
 *
 * The wire types are declared once, in `./console/dashboard.ts`, and
 * re-exported here.
 *
 * @module
 */

import type { DashboardStats, DashboardStatsParams } from "./console/dashboard.ts";
import type { CallOptions, HttpResponse, RequestOptions } from "./http.ts";

export type { DashboardStats, DashboardStatsParams } from "./console/dashboard.ts";

/** The slice of `W6WClient` this namespace needs: the transport, and nothing else. */
export interface DashboardHost {
  /** Perform one request. */
  request<T>(options: RequestOptions): Promise<HttpResponse<T>>;
}

/** Window/bucketing for `stats`, plus the per-call transport options. */
export interface DashboardStatsOptions extends DashboardStatsParams, CallOptions {}

/**
 * The `dashboard` namespace on a `W6WClient`.
 *
 * @example
 * ```ts
 * const rollup = await client.dashboard.stats({ bucket: "week" });
 * console.log(rollup.headline.workflowRuns);
 * ```
 */
export class DashboardApi {
  readonly #host: DashboardHost;

  /**
   * @param host - The client this namespace issues requests through.
   */
  constructor(host: DashboardHost) {
    this.#host = host;
  }

  /**
   * Fetch the account-scoped dashboard rollup.
   *
   * @param options - Optional `from` / `to` / `bucket` (each sent only when given; the server
   * applies its own defaults) and `signal`.
   * @returns The rollup, exactly as the server sent it.
   * @throws {ApiError} On any non-2xx.
   */
  async stats(options: DashboardStatsOptions = {}): Promise<DashboardStats> {
    const res = await this.#host.request<DashboardStats>({
      method: "GET",
      path: "/dashboard/stats",
      query: { from: options.from, to: options.to, bucket: options.bucket },
      signal: options.signal,
    });
    return res.body;
  }
}
