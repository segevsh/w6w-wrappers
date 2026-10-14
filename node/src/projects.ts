/**
 * `client.projects.list()` — the account's projects, read-only.
 *
 * One operation, `GET /projects`. Project create / rename / archive / delete
 * are not part of the partner contract.
 *
 * **Side effect to know about:** listing ensures the account has a default
 * project. If it has none yet, the `GET` creates it before answering, so a first
 * call on a fresh account returns one `isDefault: true` row rather than `[]`.
 * Archived projects are not listed.
 *
 * The wire type {@linkcode Project} is declared once, in
 * `./console/projects.ts`, and re-exported here.
 *
 * @module
 */

import type { Project } from "./console/projects.ts";
import type { CallOptions, HttpResponse, RequestOptions } from "./http.ts";
import { unwrap } from "./types.ts";

export type { Project } from "./console/projects.ts";

/** The slice of `W6WClient` this namespace needs: the transport, and nothing else. */
export interface ProjectsHost {
  /** Perform one request. */
  request<T>(options: RequestOptions): Promise<HttpResponse<T>>;
}

/**
 * The `projects` namespace on a `W6WClient`.
 *
 * @example
 * ```ts
 * const projects = await client.projects.list();
 * const home = projects.find((p) => p.isDefault);
 * ```
 */
export class ProjectsApi {
  readonly #host: ProjectsHost;

  /**
   * @param host - The client this namespace issues requests through.
   */
  constructor(host: ProjectsHost) {
    this.#host = host;
  }

  /**
   * List the account's active projects.
   *
   * @param options - Optional per-call transport options (`signal` to abort).
   * @returns The projects, unwrapped from the `projects` envelope.
   * @throws {ApiError} On any non-2xx.
   */
  async list(options?: CallOptions): Promise<Project[]> {
    const res = await this.#host.request<unknown>({
      method: "GET",
      path: "/projects",
      signal: options?.signal,
    });
    return unwrap<Project[]>(res, "projects");
  }
}
