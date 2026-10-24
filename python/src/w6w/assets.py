"""`client.assets.*` — resumable uploads and stored assets (contract 0.11.0).

Twelve operations, **one HTTP call each**, in the shape `endpoints.json` gives
them. Five live under :attr:`AssetsApi.uploads` — reserve, send one entry's
bytes, finalize, read the resume point, abort — and seven under
:class:`AssetsApi` itself.

Two of them are **byte mode** (§3 of `docs/implementation.md`, contract 0.11.0):

- :meth:`AssetUploadsApi.put_entry` sends `bytes`, and they reach the wire
  untouched as `application/octet-stream`. Never JSON-quoted, never base64'd:
  the `sha256` the caller declared for the entry is computed over exactly these
  bytes, so any transformation would make the server reject the entry it was
  told to expect.
- :meth:`AssetsApi.content` and :meth:`AssetsApi.archive_download` return the
  response body as raw `bytes`. It is never decoded as text — a store-only ZIP
  and an arbitrary uploaded file are not UTF-8, and a `\\xff\\xfe\\x00` sequence
  in a payload must arrive unmodified.

A non-2xx on either kind is the ordinary typed :class:`w6w.ApiError` carrying
the envelope's `code`; byte mode changes the success path and nothing else.

The payloads here are returned **as the server sent them** — dicts and lists,
unwrapped from their envelopes (`{upload, entries}`, `{asset}`, `{versions}`, …)
and otherwise untouched, exactly like the `node` lane's `client.assets`. Only
the two byte operations return something the wire did not spell as JSON.
"""

from __future__ import annotations

from typing import Any, Dict, List, Mapping, Optional, Protocol

from ._http import OCTET_STREAM, HttpResponse, path
from .types import unwrap_list, unwrap_object

#: An upload's purpose. `skill` and `context` run a purpose handler at finalize.
AssetUploadPurpose = str

#: Who may see an asset: `private`, `project` or `account`.
AssetVisibility = str


class AssetsHost(Protocol):
    """The slice of `Client` this namespace needs: the transport, nothing else.

    Structural rather than a concrete client type, for the same two reasons as
    `documents`' host: the namespace stays independently constructible in a
    test, and this module never imports the client back (an import cycle as well
    as a layering inversion).

    One member, not two: unlike `documents`, every `/assets` and
    `/asset-uploads` route is addressed by id and scopes itself server-side, so
    there is no default project to read off the client's configuration.
    """

    def request(
        self,
        method: str,
        path: str,
        query: Optional[Mapping[str, Any]] = None,
        body: Optional[Any] = None,
        response_encoding: Optional[str] = None,
    ) -> HttpResponse:
        """Perform one request.

        :param method: HTTP method.
        :param path: Base-relative path.
        :param query: Query parameters; `None` values are dropped.
        :param body: Request body; `bytes` is sent as `application/octet-stream`.
        :param response_encoding: `"octet-stream"` returns the body as `bytes`.
        :returns: The status and parsed body.
        """
        ...  # pragma: no cover - a protocol body is never executed.


class AssetUploadsApi:
    """The `client.assets.uploads.*` half: reserve → put → finalize.

    Reached as `client.assets.uploads`; never constructed directly by a caller.

    Example::

        upload = client.assets.uploads.create(
            purpose="skill",
            idempotency_key="acme-skill-v3",
            entries=[{"path": "SKILL.md", "sizeBytes": 128, "sha256": digest}],
        )
        client.assets.uploads.put_entry(upload["upload"]["id"], 0, raw_bytes)
        client.assets.uploads.finalize(upload["upload"]["id"])
    """

    def __init__(self, host: AssetsHost) -> None:
        """Bind the namespace to the client it issues requests through.

        :param host: The client. Only its transport is used; nothing here is
            module state.
        """
        self._host = host

    def create(
        self,
        purpose: AssetUploadPurpose,
        idempotency_key: str,
        entries: List[Mapping[str, Any]],
        name: Optional[str] = None,
        visibility: Optional[AssetVisibility] = None,
        asset_id: Optional[str] = None,
        target: Optional[Mapping[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Reserve an upload: declare every entry, send no bytes yet.

        The declaration is what the later `put_entry` calls are checked
        against — `sizeBytes` and `sha256` per entry — so a payload that does not
        match what was reserved is rejected rather than silently stored.

        The optional fields default to `None`, and here `None` means
        **omitted**, not "null" (as in `documents.create`): there is no prior
        value to preserve, so "leave it alone" and "do not send it" are the same
        request.

        :param purpose: `"asset"`, `"skill"` or `"context"`.
        :param idempotency_key: Replays of the same key with the identical
            request return the same upload, so a retried `create` cannot reserve
            twice.
        :param entries: One mapping per file, each with `path`, `sizeBytes` and
            `sha256` (and optionally `mediaType`). **Position is the entry
            `index`** the later PUTs address.
        :param name: Name of the asset to create at publish; ignored when
            `asset_id` is given.
        :param visibility: `"private"` (the server default), `"project"` or
            `"account"`.
        :param asset_id: Publish a new version of this existing asset instead of
            creating one.
        :param target: Purpose-specific destination, e.g. `{"skillId": "skl_…"}`
            or `{"collectionId": "ctx_…"}`.
        :returns: The upload and its entries, as sent.
        :raises ConfigError: When no token is configured.
        :raises ApiError: On any non-2xx, e.g. `409 idempotency_key_conflict`
            for a reuse of the key with a different request.
        """
        body: Dict[str, Any] = {
            "purpose": purpose,
            "idempotencyKey": idempotency_key,
            "entries": list(entries),
        }
        if name is not None:
            body["name"] = name
        if visibility is not None:
            body["visibility"] = visibility
        if asset_id is not None:
            body["assetId"] = asset_id
        if target is not None:
            body["target"] = target
        return self._host.request("POST", "/asset-uploads", body=body).body

    def put_entry(
        self,
        id: str,
        index: int,
        data: bytes,
    ) -> Dict[str, Any]:
        """Send one declared entry's exact bytes (**byte mode**).

        The `data` reaches the wire byte for byte as `application/octet-stream`
        — it is not JSON-quoted, base64-encoded or re-encoded as text, because
        the entry's declared `sha256` is a digest of exactly these bytes.

        :param id: The `upl_…` id `create` returned.
        :param index: Position of the entry in the array `create` declared.
        :param data: The file's bytes, unmodified.
        :returns: The entry and its `received` state, unwrapped from `{entry}`.
        :raises ConfigError: When no token is configured.
        :raises ApiError: On any non-2xx, e.g. `422 sha256_mismatch` or
            `413 payload_too_large`. The envelope's `code` reaches the caller
            intact — the error path is unchanged by byte mode.
        """
        response = self._host.request(
            "PUT",
            path("/asset-uploads/{id}/entries/{index}", id=id, index=str(index)),
            body=data,
        )
        return _unwrap_entry(response)

    def finalize(self, id: str) -> Dict[str, Any]:
        """Publish a fully received upload as an asset version.

        :param id: The `upl_…` id.
        :returns: `uploadId`, `assetId`, `versionId`, `version`, `readiness`,
            `derived` and `created`, as sent. `created` is `False` when this
            call found the upload already published, which is what makes a
            retried finalize safe.
        :raises ConfigError: When no token is configured.
        :raises ApiError: On any non-2xx, e.g. `409 upload_incomplete` while an
            entry is still `pending`.
        """
        return self._host.request(
            "POST",
            path("/asset-uploads/{id}/finalize", id=id),
        ).body

    def get(self, id: str) -> Dict[str, Any]:
        """Read an upload's status and per-entry state — the resume point.

        This is what a `--retry` reads: every entry already `received` is
        skipped rather than re-sent.

        :param id: The `upl_…` id.
        :returns: The upload and its entries, as sent.
        :raises ConfigError: When no token is configured.
        :raises ApiError: `404 not_found` when there is no such upload.
        """
        return self._host.request("GET", path("/asset-uploads/{id}", id=id)).body

    def abort(self, id: str) -> Dict[str, Any]:
        """Abort an open upload and release what it reserved.

        :param id: The `upl_…` id.
        :returns: The upload's final view, as sent.
        :raises ConfigError: When no token is configured.
        :raises ApiError: `404 not_found` when there is no such upload.
        """
        return self._host.request("DELETE", path("/asset-uploads/{id}", id=id)).body


class AssetsApi:
    """`client.assets` — fetch, inspect, download, archive and purge assets.

    Reached as `client.assets`; never constructed directly by a caller.

    Example::

        asset = client.assets.get("ast_01H")
        for version in client.assets.versions(asset["id"]):
            print(version["version"], version["readiness"])
        raw = client.assets.content(asset["id"], version_id, file_id)
    """

    def __init__(self, host: AssetsHost) -> None:
        """Bind the namespace to the client it issues requests through.

        :param host: The client. Only its transport is used.
        """
        self._host = host
        #: Resumable uploads — see :class:`AssetUploadsApi`.
        self.uploads: AssetUploadsApi = AssetUploadsApi(host)

    def get(self, id: str) -> Dict[str, Any]:
        """Fetch one asset.

        :param id: The `ast_…` id.
        :returns: The asset, unwrapped from `{asset}`.
        :raises ConfigError: When no token is configured.
        :raises ApiError: `404 not_found` when there is no such asset.
        """
        return _unwrap_asset(self._host.request("GET", path("/assets/{id}", id=id)))

    def versions(self, id: str) -> List[Dict[str, Any]]:
        """List an asset's versions.

        :param id: The `ast_…` id.
        :returns: The versions, unwrapped from `{versions}`.
        :raises ConfigError: When no token is configured.
        :raises ApiError: `404 not_found` when there is no such asset.
        """
        response = self._host.request("GET", path("/assets/{id}/versions", id=id))
        return _unwrap_versions(response)

    def files(self, id: str, version_id: str) -> Dict[str, Any]:
        """List the files of one version.

        There is no envelope key to unwrap here: the body is `{version, files}`,
        which is exactly what the caller wants, so it is returned as sent.

        :param id: The `ast_…` id.
        :param version_id: The `asv_…` id.
        :returns: The version and its files, as sent.
        :raises ConfigError: When no token is configured.
        :raises ApiError: `404 not_found` when there is no such version.
        """
        return self._host.request(
            "GET",
            path("/assets/{id}/versions/{versionId}/files", id=id, versionId=version_id),
        ).body

    def content(self, id: str, version_id: str, file_id: str) -> bytes:
        """Download one file's exact bytes (**byte mode**).

        :param id: The `ast_…` id.
        :param version_id: The `asv_…` id.
        :param file_id: The `asf_…` id.
        :returns: The file's bytes, unmodified — never decoded as text, so a
            non-UTF-8 payload survives.
        :raises ConfigError: When no token is configured.
        :raises ApiError: `404 not_found` when there is no such file.
        """
        return self._host.request(
            "GET",
            path(
                "/assets/{id}/versions/{versionId}/files/{fileId}/content",
                id=id,
                versionId=version_id,
                fileId=file_id,
            ),
            response_encoding=OCTET_STREAM,
        ).body

    def archive_download(self, id: str, version_id: str) -> bytes:
        """Download one version as a store-only ZIP (**byte mode**).

        :param id: The `ast_…` id.
        :param version_id: The `asv_…` id.
        :returns: The ZIP's bytes, unmodified.
        :raises ConfigError: When no token is configured.
        :raises ApiError: On any non-2xx, e.g. `404 not_found`.
        """
        return self._host.request(
            "GET",
            path("/assets/{id}/versions/{versionId}/archive", id=id, versionId=version_id),
            response_encoding=OCTET_STREAM,
        ).body

    def archive(self, id: str) -> Dict[str, Any]:
        """Archive an asset. Its bytes are kept; it just stops being listed.

        :param id: The `ast_…` id.
        :returns: The archived asset, unwrapped from `{asset}`.
        :raises ConfigError: When no token is configured.
        :raises ApiError: `404 not_found` when there is no such asset.
        """
        return _unwrap_asset(self._host.request("POST", path("/assets/{id}/archive", id=id)))

    def purge(self, id: str) -> Dict[str, Any]:
        """Permanently delete an asset and every version's objects (admin only).

        :param id: The `ast_…` id.
        :returns: `assetId`, `versionsDeleted` and `objectsDeleted`, as sent.
        :raises ConfigError: When no token is configured.
        :raises ApiError: `403 forbidden` for a caller who is not an account
            admin, `404 not_found` when there is no such asset.
        """
        return self._host.request("DELETE", path("/assets/{id}", id=id)).body


def _unwrap_entry(response: HttpResponse) -> Dict[str, Any]:
    """Read the `{entry}` envelope `put_entry` answers with.

    :param response: The response the transport returned.
    :returns: The entry object.
    :raises ApiError: `bad_response` when the envelope is missing or malformed.
    """
    return unwrap_object(response, "entry")


def _unwrap_asset(response: HttpResponse) -> Dict[str, Any]:
    """Read the `{asset}` envelope `get` and `archive` answer with.

    :param response: The response the transport returned.
    :returns: The asset object.
    :raises ApiError: `bad_response` when the envelope is missing or malformed.
    """
    return unwrap_object(response, "asset")


def _unwrap_versions(response: HttpResponse) -> List[Dict[str, Any]]:
    """Read the `{versions}` envelope `versions` answers with.

    :param response: The response the transport returned.
    :returns: The version objects.
    :raises ApiError: `bad_response` when the envelope is missing or malformed.
    """
    return unwrap_list(response, "versions")
