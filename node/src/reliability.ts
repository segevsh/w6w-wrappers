/**
 * `client.reliability.*` — the project-scoped reliability board.
 *
 * Two reads:
 *
 * - `members(project)` — which app ids the project's calls touch (identifiers
 *   only, no status probes).
 * - `list(project, appIds)` — the board for an explicit set of those apps.
 *
 * **The server accepts at most 10 app ids per `list`.** More, or none, is a
 * `400 invalid_app_filter`; a missing `project` is `400 missing_project`. Both
 * surface as `ApiError` with the server's body intact. This namespace
 * deliberately has **no batching helper**: `list` sends exactly the ids it is
 * given, and splitting a larger set across calls (and scheduling or polling
 * them) is the host's decision.
 *
 * The wire types are declared once, in `./console/reliability.ts`, and
 * re-exported here.
 *
 * @module
 */

import type { ReliabilityServiceMembers, ReliabilityServices } from "./console/reliability.ts";
import type { CallOptions, HttpResponse, RequestOptions } from "./http.ts";

export type {
  ReliabilityComponentReport,
  ReliabilityErrorMix,
  ReliabilityService,
  ReliabilityServiceMembers,
  ReliabilityServices,
  ReliabilityState,
  ReliabilityTimelineEntry,
  ReliabilityUptimeDay,
  ReliabilityVendorStatus,
} from "./console/reliability.ts";

/** The slice of `W6WClient` this namespace needs: the transport, and nothing else. */
export interface ReliabilityHost {
  /** Perform one request. */
  request<T>(options: RequestOptions): Promise<HttpResponse<T>>;
}

/** Options for {@linkcode ReliabilityApi.list}. */
export interface ReliabilityListOptions extends CallOptions {
  /** Window size in days; omitted, the server applies its own default. */
  days?: number;
  /** Cap on services returned, most urgent first; omitted, no cap. */
  limit?: number;
}

/** Options for {@linkcode ReliabilityApi.members}. */
export interface ReliabilityMembersOptions extends CallOptions {
  /** Window size in days; omitted, the server applies its own default. */
  days?: number;
}

/**
 * The `reliability` namespace on a `W6WClient`.
 *
 * @example
 * ```ts
 * const { appIds } = await client.reliability.members("prj_123");
 * const board = await client.reliability.list("prj_123", appIds.slice(0, 10));
 * ```
 */
export class ReliabilityApi {
  readonly #host: ReliabilityHost;

  /**
   * @param host - The client this namespace issues requests through.
   */
  constructor(host: ReliabilityHost) {
    this.#host = host;
  }

  /**
   * Fetch one project's reliability board for an explicit set of apps.
   *
   * @param project - The project whose calls are reported (required).
   * @param appIds - The services to report; the server accepts 1 to 10 ids.
   * @param options - `days`, `limit`, `signal`.
   * @returns The board, exactly as the server sent it.
   * @throws {ApiError} On any non-2xx, including `400 invalid_app_filter` (zero or more than
   * ten ids) and `400 missing_project`.
   */
  async list(
    project: string,
    appIds: readonly string[],
    options: ReliabilityListOptions = {},
  ): Promise<ReliabilityServices> {
    const res = await this.#host.request<ReliabilityServices>({
      method: "GET",
      path: "/reliability/services",
      query: { project, apps: appIds.join(","), days: options.days, limit: options.limit },
      signal: options.signal,
    });
    return res.body;
  }

  /**
   * Discover which apps a project's calls touch, before issuing bounded `list` batches.
   *
   * @param project - The project (required).
   * @param options - `days`, `signal`.
   * @returns The membership, exactly as the server sent it.
   * @throws {ApiError} On any non-2xx, including `400 missing_project`.
   */
  async members(
    project: string,
    options: ReliabilityMembersOptions = {},
  ): Promise<ReliabilityServiceMembers> {
    const res = await this.#host.request<ReliabilityServiceMembers>({
      method: "GET",
      path: "/reliability/services/members",
      query: { project, days: options.days },
      signal: options.signal,
    });
    return res.body;
  }
}
