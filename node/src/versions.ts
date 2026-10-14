/**
 * Version history, publish/revert and enable/disable — shared by
 * `client.workflows.*` and `client.functions.*`.
 *
 * The server serves both kinds from one route factory
 * (`admin/callable-routes.ts`), so the wire is identical except for the
 * collection segment and the verb a version run uses (`run` for a workflow,
 * `invoke` for a Function). This module is the one place that knows that: a
 * single path builder and one kind-parameterised request helper, which the two
 * resource classes call thinly. A third copy per kind is where a path typo
 * would hide.
 *
 * The types mirror the server's `bll/callable-versions.ts` response interfaces
 * (`callableId`, nullable `createdBy`), not any consumer's copy of them.
 */
import { type HttpResponse, path, type RequestOptions } from "./http.ts";
import { unwrap } from "./types.ts";

/** The two kinds that have a version surface in this SDK (Endpoints are not covered). */
export type VersionedKind = "workflows" | "functions";

/** What the version helpers need from a client: one transport call. */
export interface VersionsHost {
  /** Perform one request. */
  request<T>(options: RequestOptions): Promise<HttpResponse<T>>;
}

/** One row of {@linkcode VersionList.versions} — metadata only, no definition. */
export interface VersionSummary {
  /** 1-based, assigned by the server at publish time. */
  versionNumber: number;
  /** ISO-8601 timestamp of the publish. */
  createdAt: string;
  /** Who published it; `null` when the server did not record one. */
  createdBy: string | null;
  /** Whether this is the version runs use today. */
  isCurrentPublished: boolean;
}

/** What `listVersions` returns: the server's whole body. */
export interface VersionList {
  /** Whether the resource may be invoked at all. */
  enabled: boolean;
  /** The published version in effect; `null` before the first publish. */
  currentPublishedVersion: number | null;
  /** Published versions, metadata only. */
  versions: VersionSummary[];
}

/** What `getVersion` returns: one version, with its (server-redacted) definition. */
export interface VersionDetail extends VersionSummary {
  /** The definition as published; opaque, like `WorkflowDefinition` / `FunctionDefinition`. */
  definition: unknown;
}

/** What `publish` returns: the server's whole body. */
export interface PublishResult {
  version: {
    kind: string;
    /** The workflow's or Function's id. */
    callableId: string;
    versionNumber: number;
    createdAt: string;
    /** Who published it; `null` when the server did not record one. */
    createdBy: string | null;
  };
  /** The version runs use after this publish. */
  currentPublishedVersion: number;
}

/** What `revert` returns: the `reverted` object unwrapped from its envelope. */
export interface RevertResult {
  kind: string;
  /** The workflow's or Function's id. */
  callableId: string;
  /** The version the live definition was rewritten from. */
  versionNumber: number;
}

/**
 * The path of a version-scoped run: `run` for a workflow, `invoke` for a
 * Function. The id and the number are percent-encoded by the `path` tag.
 *
 * @param kind - Which collection.
 * @param id - The resource id (or key).
 * @param n - The version number.
 * @returns The path, e.g. `/functions/fn_1/versions/2/invoke`.
 */
export function versionRunPath(kind: VersionedKind, id: string, n: number): string {
  const verb = kind === "workflows" ? "run" : "invoke";
  return `${path`/${kind}/${id}/versions/${String(n)}`}/${verb}`;
}

/**
 * `GET /<kind>/{id}/versions`.
 *
 * @param host - The transport.
 * @param kind - Which collection.
 * @param id - The resource id.
 * @returns The server's whole body.
 * @throws {ApiError} Any non-2xx, untouched.
 */
export async function listVersions(
  host: VersionsHost,
  kind: VersionedKind,
  id: string,
): Promise<VersionList> {
  const res = await host.request<VersionList>({
    method: "GET",
    path: path`/${kind}/${id}/versions`,
  });
  return res.body;
}

/**
 * `GET /<kind>/{id}/versions/{n}`.
 *
 * @param host - The transport.
 * @param kind - Which collection.
 * @param id - The resource id.
 * @param n - The version number.
 * @returns The `version` object, unwrapped from its envelope.
 * @throws {ApiError} Any non-2xx untouched; `bad_response` when the envelope lacks `version`.
 */
export async function getVersion(
  host: VersionsHost,
  kind: VersionedKind,
  id: string,
  n: number,
): Promise<VersionDetail> {
  const res = await host.request<unknown>({
    method: "GET",
    path: path`/${kind}/${id}/versions/${String(n)}`,
  });
  return unwrap<VersionDetail>(res, "version");
}

/**
 * `POST /<kind>/{id}/publish`.
 *
 * @param host - The transport.
 * @param kind - Which collection.
 * @param id - The resource id.
 * @returns The server's whole body.
 * @throws {ApiError} Any non-2xx, untouched.
 */
export async function publishVersion(
  host: VersionsHost,
  kind: VersionedKind,
  id: string,
): Promise<PublishResult> {
  const res = await host.request<PublishResult>({
    method: "POST",
    path: path`/${kind}/${id}/publish`,
  });
  return res.body;
}

/**
 * `POST /<kind>/{id}/versions/{n}/revert`.
 *
 * @param host - The transport.
 * @param kind - Which collection.
 * @param id - The resource id.
 * @param n - The version to restore.
 * @returns The `reverted` object, unwrapped from its envelope.
 * @throws {ApiError} Any non-2xx untouched; `bad_response` when the envelope lacks `reverted`.
 */
export async function revertVersion(
  host: VersionsHost,
  kind: VersionedKind,
  id: string,
  n: number,
): Promise<RevertResult> {
  const res = await host.request<unknown>({
    method: "POST",
    path: path`/${kind}/${id}/versions/${String(n)}/revert`,
  });
  return unwrap<RevertResult>(res, "reverted");
}

/**
 * `POST /<kind>/{id}/enable` or `/disable`. Returns nothing: the server's
 * `{enabled}` echo carries no information the caller did not just ask for.
 *
 * @param host - The transport.
 * @param kind - Which collection.
 * @param id - The resource id.
 * @param enabled - `true` hits `/enable`, `false` hits `/disable`.
 * @throws {ApiError} Any non-2xx, untouched.
 */
export async function setEnabled(
  host: VersionsHost,
  kind: VersionedKind,
  id: string,
  enabled: boolean,
): Promise<void> {
  await host.request<unknown>({
    method: "POST",
    path: path`/${kind}/${id}/${enabled ? "enable" : "disable"}`,
  });
}
