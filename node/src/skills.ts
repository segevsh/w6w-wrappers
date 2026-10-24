/**
 * `client.skills.*` — read and archive skills (contract 0.11.0).
 *
 * There is no `create`: a skill is uploaded with `assets.uploads` and
 * `purpose: "skill"`.
 *
 * @module
 */

import { type CallOptions, type HttpResponse, path, type RequestOptions } from "./http.ts";
import {
  type ListPagedOptions,
  type Skill,
  type SkillsApi as SkillsApiShape,
  type SkillVersion,
  unwrap,
} from "./types.ts";

/** The slice of `W6WClient` this namespace needs: the transport and nothing else. */
export interface SkillsHost {
  /** Perform one request. */
  request<T>(options: RequestOptions): Promise<HttpResponse<T>>;
}

/** `client.skills` — see the module doc. */
export class SkillsApi implements SkillsApiShape {
  readonly #host: SkillsHost;

  constructor(host: SkillsHost) {
    this.#host = host;
  }

  /** List skills visible to the caller. */
  async list(opts?: ListPagedOptions): Promise<Skill[]> {
    const res = await this.#host.request<unknown>({
      method: "GET",
      path: "/skills",
      query: { includeArchived: opts?.includeArchived, limit: opts?.limit },
      signal: opts?.signal,
    });
    return unwrap<Skill[]>(res, "skills");
  }

  /** Fetch one skill. */
  async get(id: string, opts?: CallOptions): Promise<Skill> {
    const res = await this.#host.request<unknown>({
      method: "GET",
      path: path`/skills/${id}`,
      signal: opts?.signal,
    });
    return unwrap<Skill>(res, "skill");
  }

  /** List a skill's immutable versions. */
  async versions(id: string, opts?: CallOptions): Promise<SkillVersion[]> {
    const res = await this.#host.request<unknown>({
      method: "GET",
      path: path`/skills/${id}/versions`,
      signal: opts?.signal,
    });
    return unwrap<SkillVersion[]>(res, "versions");
  }

  /** Archive a skill; returns the archived row. */
  async archive(id: string, opts?: CallOptions): Promise<Skill> {
    const res = await this.#host.request<unknown>({
      method: "POST",
      path: path`/skills/${id}/archive`,
      signal: opts?.signal,
    });
    return unwrap<Skill>(res, "skill");
  }
}
