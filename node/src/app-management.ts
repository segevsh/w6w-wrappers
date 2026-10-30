/**
 * `client.appManagement.*` — the stable app-definition management surface
 * (contract 0.14.0): inventory, detail, preview, register, edit source, sync
 * and remove, for the apps the caller manages.
 *
 * These routes have no envelope key, so nothing here unwraps: each method
 * returns the parsed body as sent. Bodies are built from the named keys only
 * (the server answers `400 invalid_body` on any unknown key), and `signal` is
 * never serialized.
 *
 * @module
 */

import { type CallOptions, type HttpResponse, path, type RequestOptions } from "./http.ts";
import type {
  AppManagementApi as AppManagementApiShape,
  AppManagementPreview,
  ListManagedAppsOptions,
  ManagedAppDetail,
  ManagedAppsPage,
  PreviewAppInput,
  RegisterAppInput,
  RegisterAppResult,
  SyncAppOptions,
  SyncResult,
  UpdateSourceInput,
} from "./types.ts";

/** The slice of `W6WClient` this namespace needs: the transport and nothing else. */
export interface AppManagementHost {
  /** Perform one request. */
  request<T>(options: RequestOptions): Promise<HttpResponse<T>>;
}

/** `client.appManagement` — see the module doc. */
export class AppManagementApi implements AppManagementApiShape {
  readonly #host: AppManagementHost;

  constructor(host: AppManagementHost) {
    this.#host = host;
  }

  /** The inventory of apps the caller manages, with live management state per row. */
  async list(opts?: ListManagedAppsOptions): Promise<ManagedAppsPage> {
    const res = await this.#host.request<ManagedAppsPage>({
      method: "GET",
      path: "/app-management/apps",
      query: {
        scope: opts?.scope,
        q: opts?.q,
        sort: opts?.sort,
        compact: opts?.compact,
        snapshot: opts?.snapshot,
        cursor: opts?.cursor,
        offset: opts?.offset,
        limit: opts?.limit,
      },
      signal: opts?.signal,
    });
    return res.body;
  }

  /** One managed app: the catalog detail plus management, source and last sync. */
  async get(id: string, opts?: CallOptions): Promise<ManagedAppDetail> {
    const res = await this.#host.request<ManagedAppDetail>({
      method: "GET",
      path: path`/app-management/apps/${id}`,
      signal: opts?.signal,
    });
    return res.body;
  }

  /** Preview a source for a target, without registering anything. */
  async preview(input: PreviewAppInput, opts?: CallOptions): Promise<AppManagementPreview> {
    const res = await this.#host.request<AppManagementPreview>({
      method: "POST",
      path: "/app-management/preview",
      body: { source: input.source, target: input.target },
      signal: opts?.signal,
    });
    return res.body;
  }

  /** Register an app (or a pack) from a source into a target. */
  async register(input: RegisterAppInput, opts?: CallOptions): Promise<RegisterAppResult> {
    const body: { target: unknown; source: unknown; paths?: string[] } = {
      target: input.target,
      source: input.source,
    };
    if (input.paths !== undefined) body.paths = input.paths;
    const res = await this.#host.request<RegisterAppResult>({
      method: "POST",
      path: "/app-management/apps",
      body,
      signal: opts?.signal,
    });
    return res.body;
  }

  /** Validate a candidate source and, if it loads, make it the app's active source. */
  async updateSource(
    id: string,
    input: UpdateSourceInput,
    opts?: CallOptions,
  ): Promise<SyncResult> {
    const res = await this.#host.request<SyncResult>({
      method: "PUT",
      path: path`/app-management/apps/${id}/source`,
      body: { source: input.source, expectedRevision: input.expectedRevision },
      signal: opts?.signal,
    });
    return res.body;
  }

  /** Re-fetch the app's active source and update the registry. */
  async sync(id: string, opts?: SyncAppOptions): Promise<SyncResult> {
    const body: { expectedRevision?: number } = {};
    if (opts?.expectedRevision !== undefined) body.expectedRevision = opts.expectedRevision;
    const res = await this.#host.request<SyncResult>({
      method: "POST",
      path: path`/app-management/apps/${id}/sync`,
      body,
      signal: opts?.signal,
    });
    return res.body;
  }

  /** Remove the app: all its versions and its source row. */
  async remove(id: string, opts?: CallOptions): Promise<{ removed: number }> {
    const res = await this.#host.request<{ removed: number }>({
      method: "DELETE",
      path: path`/app-management/apps/${id}`,
      signal: opts?.signal,
    });
    return res.body;
  }
}
