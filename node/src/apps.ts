/**
 * `client.apps.byIds()` — a bounded lookup of apps by id, and nothing more.
 *
 * One operation. It exists so a host rendering a list of connections (or a
 * reliability board) can resolve the icons and labels of the apps it names
 * **without fetching the whole catalog**. Browsing, searching and paging the
 * catalog stay out of the partner contract (`endpoints.json` `outOfScope`):
 * they are the studio's.
 *
 * For a *connection's* app, prefer the `app` object already inlined on every
 * {@linkcode ConnectionSummary} from `connections.list()` / `connections.get()`
 * — that is the primary icon/label source and costs no extra request. Reach for
 * `byIds` for ids that do not come from a connection (a reliability row's
 * `appId`, a step's `app`).
 *
 * The server caps `GET /apps?ids=` at 100 ids per request and answers
 * `400 too_many_ids` beyond that. This method chunks to the cap client-side, so
 * the cap never reaches a caller.
 *
 * The wire type {@linkcode AppSummary} is declared once, in
 * `./console/apps.ts`, and re-exported here — the console namespace keeps
 * working unchanged.
 *
 * @module
 */

import type { AppsPage, AppSummary } from "./console/apps.ts";
import type { CallOptions, HttpResponse, RequestOptions } from "./http.ts";

export type { AppSummary } from "./console/apps.ts";

/**
 * The slice of `W6WClient` this namespace needs: the transport, and nothing
 * else. Apps are a global catalog read — no `?project=`.
 */
export interface AppsHost {
  /** Perform one request. */
  request<T>(options: RequestOptions): Promise<HttpResponse<T>>;
}

/** The server's own `ids` cap per `GET /apps` request; `byIds` chunks to it. */
const MAX_IDS_PER_REQUEST = 100;

/**
 * The `apps` namespace on a `W6WClient`.
 *
 * @example
 * ```ts
 * const apps = await client.apps.byIds(["sendgrid", "slack"]);
 * for (const a of apps) console.log(a.id, a.displayName);
 * ```
 */
export class AppsApi {
  readonly #host: AppsHost;

  /**
   * @param host - The client this namespace issues requests through.
   */
  constructor(host: AppsHost) {
    this.#host = host;
  }

  /**
   * Resolve a set of app ids to their catalog summaries.
   *
   * Duplicates are collapsed first. An empty set resolves to `[]` with **no
   * request at all** — never an unfiltered page of the catalog. Chunks of at
   * most 100 ids each become one `GET /apps?ids=a,b,…`, issued concurrently, and
   * the pages are concatenated in chunk order. Ids the catalog does not know are
   * simply absent from the result; that is not an error.
   *
   * @param ids - The app ids to look up.
   * @param options - Optional per-call transport options (`signal` reaches every chunk's request).
   * @returns The matching apps.
   * @throws {ApiError} On any non-2xx.
   */
  async byIds(ids: readonly string[], options?: CallOptions): Promise<AppSummary[]> {
    const unique = Array.from(new Set(ids));
    if (unique.length === 0) return [];
    const chunks: string[][] = [];
    for (let i = 0; i < unique.length; i += MAX_IDS_PER_REQUEST) {
      chunks.push(unique.slice(i, i + MAX_IDS_PER_REQUEST));
    }
    const pages = await Promise.all(
      chunks.map((chunk) =>
        this.#host.request<AppsPage>({
          method: "GET",
          path: "/apps",
          query: { ids: chunk.join(",") },
          signal: options?.signal,
        })
      ),
    );
    return pages.flatMap((res) => res.body.apps);
  }
}
