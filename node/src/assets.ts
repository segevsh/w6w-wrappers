/**
 * `client.assets.*` — resumable uploads and stored assets (contract 0.11.0).
 *
 * Twelve operations, one HTTP call each. Two are **byte mode**: `uploads.putEntry`
 * sends a `Uint8Array` as `application/octet-stream` (never JSON-quoted or
 * base64'd) and `content` / `archiveDownload` return the response body as an
 * exact `Uint8Array`. A non-2xx in either mode still raises the typed
 * {@linkcode ApiError} from the error envelope (`src/http.ts`).
 *
 * @module
 */

import { type CallOptions, type HttpResponse, path, type RequestOptions } from "./http.ts";
import {
  type Asset,
  type AssetFinalizeResult,
  type AssetPurgeResult,
  type AssetsApi as AssetsApiShape,
  type AssetUploadCreateInput,
  type AssetUploadEntry,
  type AssetUploadStatus,
  type AssetVersion,
  type AssetVersionFiles,
  unwrap,
} from "./types.ts";

/** The slice of `W6WClient` this namespace needs: the transport and nothing else. */
export interface AssetsHost {
  /** Perform one request. */
  request<T>(options: RequestOptions): Promise<HttpResponse<T>>;
}

/** The `client.assets.uploads.*` half. */
class AssetUploadsApi {
  readonly #host: AssetsHost;

  constructor(host: AssetsHost) {
    this.#host = host;
  }

  /** Reserve an upload (declare the entries; no bytes yet). */
  async create(input: AssetUploadCreateInput, opts?: CallOptions): Promise<AssetUploadStatus> {
    const res = await this.#host.request<AssetUploadStatus>({
      method: "POST",
      path: "/asset-uploads",
      body: input,
      signal: opts?.signal,
    });
    return res.body;
  }

  /** Send one declared entry's exact bytes. */
  async putEntry(
    id: string,
    index: number,
    bytes: Uint8Array,
    opts?: CallOptions,
  ): Promise<AssetUploadEntry> {
    const res = await this.#host.request<unknown>({
      method: "PUT",
      path: path`/asset-uploads/${id}/entries/${String(index)}`,
      body: bytes,
      signal: opts?.signal,
    });
    return unwrap<AssetUploadEntry>(res, "entry");
  }

  /** Publish a fully received upload as an asset version. */
  async finalize(id: string, opts?: CallOptions): Promise<AssetFinalizeResult> {
    const res = await this.#host.request<AssetFinalizeResult>({
      method: "POST",
      path: path`/asset-uploads/${id}/finalize`,
      signal: opts?.signal,
    });
    return res.body;
  }

  /** Read an upload's status and per-entry state (the resume point). */
  async get(id: string, opts?: CallOptions): Promise<AssetUploadStatus> {
    const res = await this.#host.request<AssetUploadStatus>({
      method: "GET",
      path: path`/asset-uploads/${id}`,
      signal: opts?.signal,
    });
    return res.body;
  }

  /** Abort an open upload; returns its final view. */
  async abort(id: string, opts?: CallOptions): Promise<AssetUploadStatus> {
    const res = await this.#host.request<AssetUploadStatus>({
      method: "DELETE",
      path: path`/asset-uploads/${id}`,
      signal: opts?.signal,
    });
    return res.body;
  }
}

/** `client.assets` — see the module doc. */
export class AssetsApi implements AssetsApiShape {
  readonly #host: AssetsHost;
  /** Resumable uploads. */
  readonly uploads: AssetUploadsApi;

  constructor(host: AssetsHost) {
    this.#host = host;
    this.uploads = new AssetUploadsApi(host);
  }

  /** Fetch one asset. */
  async get(id: string, opts?: CallOptions): Promise<Asset> {
    const res = await this.#host.request<unknown>({
      method: "GET",
      path: path`/assets/${id}`,
      signal: opts?.signal,
    });
    return unwrap<Asset>(res, "asset");
  }

  /** List an asset's versions. */
  async versions(id: string, opts?: CallOptions): Promise<AssetVersion[]> {
    const res = await this.#host.request<unknown>({
      method: "GET",
      path: path`/assets/${id}/versions`,
      signal: opts?.signal,
    });
    return unwrap<AssetVersion[]>(res, "versions");
  }

  /** List the files of one version (`{version, files}`). */
  async files(id: string, versionId: string, opts?: CallOptions): Promise<AssetVersionFiles> {
    const res = await this.#host.request<AssetVersionFiles>({
      method: "GET",
      path: path`/assets/${id}/versions/${versionId}/files`,
      signal: opts?.signal,
    });
    return res.body;
  }

  /** Download one file's exact bytes. */
  async content(
    id: string,
    versionId: string,
    fileId: string,
    opts?: CallOptions,
  ): Promise<Uint8Array> {
    const res = await this.#host.request<Uint8Array>({
      method: "GET",
      path: path`/assets/${id}/versions/${versionId}/files/${fileId}/content`,
      responseType: "bytes",
      signal: opts?.signal,
    });
    return res.body;
  }

  /** Download one version as a store-only ZIP. */
  async archiveDownload(id: string, versionId: string, opts?: CallOptions): Promise<Uint8Array> {
    const res = await this.#host.request<Uint8Array>({
      method: "GET",
      path: path`/assets/${id}/versions/${versionId}/archive`,
      responseType: "bytes",
      signal: opts?.signal,
    });
    return res.body;
  }

  /** Archive an asset (bytes are kept). */
  async archive(id: string, opts?: CallOptions): Promise<Asset> {
    const res = await this.#host.request<unknown>({
      method: "POST",
      path: path`/assets/${id}/archive`,
      signal: opts?.signal,
    });
    return unwrap<Asset>(res, "asset");
  }

  /** Permanently delete an asset (account admin only). */
  async purge(id: string, opts?: CallOptions): Promise<AssetPurgeResult> {
    const res = await this.#host.request<AssetPurgeResult>({
      method: "DELETE",
      path: path`/assets/${id}`,
      signal: opts?.signal,
    });
    return res.body;
  }
}
