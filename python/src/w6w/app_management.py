"""`client.app_management.*` — the stable app-definition management surface.

Seven operations (`endpoints.json` contract 0.14.0), for the apps the caller
manages::

    page = client.app_management.list(scope="account", limit=20)
    prev = client.app_management.preview("github:acme/app", "account")
    done = client.app_management.register("account", {"folder": {"grant": "g", "path": "./x"}})
    out = client.app_management.sync("my-app", expected_revision=3)

Every method returns the parsed body as sent, a plain ``dict`` with the wire's
camelCase keys: these routes have no envelope key, so nothing is unwrapped
(the ``node`` lane returns the same value). An option the caller did not give is
**absent** from the query or body, never sent as ``null``; ``0`` and ``False``
are values and are sent.

``source`` is a canonical remote ref string or ``{"folder": {"grant", "path"}}``,
passed through verbatim. This module never validates ``target`` or ``scope``:
the server is the authority (the ``targets`` list of an inventory page says what
the caller may name). A sync that could not load the source is still a 200 whose
``outcome`` is ``"failed"`` (see ``SyncOutcome``); an app the caller cannot see
is a ``404 unknown_app``.
"""

from __future__ import annotations

from typing import Any, Dict, List, Mapping, Optional, Protocol, Union

from ._http import HttpResponse, path

#: A source: a canonical remote ref string, or ``{"folder": {"grant", "path"}}``.
SourceInput = Union[str, Mapping[str, Any]]


class AppManagementHost(Protocol):
    """The slice of `Client` this namespace needs: the transport and nothing else."""

    def request(
        self,
        method: str,
        path: str,
        query: Optional[Mapping[str, Any]] = None,
        body: Optional[Any] = None,
        headers: Optional[Mapping[str, str]] = None,
    ) -> HttpResponse:
        """Perform one request."""
        ...


class AppManagementApi:
    """`client.app_management` — see the module doc."""

    def __init__(self, host: AppManagementHost) -> None:
        self._host = host

    def list(
        self,
        scope: Optional[str] = None,
        q: Optional[str] = None,
        sort: Optional[str] = None,
        compact: Optional[bool] = None,
        snapshot: Optional[str] = None,
        cursor: Optional[str] = None,
        offset: Optional[int] = None,
        limit: Optional[int] = None,
    ) -> Dict[str, Any]:
        """List the apps the caller manages, with live management state per row.

        :param scope: `all` (default), `account`, `tenant` or `personal`.
        :param q: Search text.
        :param sort: `name` (default), `-name`, `recent` or `-recent`.
        :param compact: Compact rows.
        :param snapshot: A previous page's snapshot token.
        :param cursor: The previous page's `nextCursor`. Not combined with `snapshot`
            (the server refuses both together).
        :param offset: Row offset.
        :param limit: Page size.
        :returns: The page: `apps`, `targets`, `sourceOptions`, `nextCursor?`, ….
        """
        res = self._host.request(
            "GET",
            "/app-management/apps",
            query={
                "scope": scope,
                "q": q,
                "sort": sort,
                "compact": compact,
                "snapshot": snapshot,
                "cursor": cursor,
                "offset": offset,
                "limit": limit,
            },
        )
        return res.body

    def get(self, id: str) -> Dict[str, Any]:
        """Fetch one managed app: catalog detail plus management, source and last sync.

        :param id: The app id. An app the caller cannot see is `404 unknown_app`.
        :returns: The detail body.
        """
        res = self._host.request("GET", path("/app-management/apps/{id}", id=id))
        return res.body

    def preview(self, source: SourceInput, target: str) -> Dict[str, Any]:
        """Preview a source for a target, without registering anything.

        :param source: A canonical remote ref, or `{"folder": {"grant", "path"}}`.
        :param target: `account`, `tenant` or `personal`; the server decides.
        :returns: `{kind: "app", ...}` or `{kind: "pack", ...}`.
        """
        res = self._host.request(
            "POST",
            "/app-management/preview",
            body={"source": source, "target": target},
        )
        return res.body

    def register(
        self,
        target: str,
        source: SourceInput,
        paths: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """Register an app (or a pack) from a source into a target.

        :param target: `account`, `tenant` or `personal`; the server decides.
        :param source: A canonical remote ref, or `{"folder": {"grant", "path"}}`.
        :param paths: Pack sources only; sent only when given.
        :returns: The import result, plus `target`.
        """
        body: Dict[str, Any] = {"target": target, "source": source}
        if paths is not None:
            body["paths"] = paths
        res = self._host.request("POST", "/app-management/apps", body=body)
        return res.body

    def update_source(
        self, id: str, source: SourceInput, expected_revision: int
    ) -> Dict[str, Any]:
        """Validate a candidate source and, if it loads, make it the active source.

        :param id: The app id.
        :param source: The candidate source.
        :param expected_revision: The `source.revision` read from the row; `0`
            when no source is committed.
        :returns: A `SyncResult`; `outcome` may be `"failed"` on a 200.
        """
        res = self._host.request(
            "PUT",
            path("/app-management/apps/{id}/source", id=id),
            body={"source": source, "expectedRevision": expected_revision},
        )
        return res.body

    def sync(self, id: str, expected_revision: Optional[int] = None) -> Dict[str, Any]:
        """Re-fetch the app's active source and update the registry.

        :param id: The app id.
        :param expected_revision: Refuse with `409 stale_source` unless this is
            the current revision. `0` is sent.
        :returns: A `SyncResult`; `outcome` may be `"failed"` on a 200.
        """
        body: Dict[str, Any] = {}
        if expected_revision is not None:
            body["expectedRevision"] = expected_revision
        res = self._host.request(
            "POST", path("/app-management/apps/{id}/sync", id=id), body=body
        )
        return res.body

    def remove(self, id: str) -> Dict[str, Any]:
        """Remove the app: all its versions and its source row.

        :param id: The app id.
        :returns: `{"removed": n}`.
        """
        res = self._host.request("DELETE", path("/app-management/apps/{id}", id=id))
        return res.body
