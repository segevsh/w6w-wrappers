"""`client.data_stores.*` — data stores and their entries (contract 0.15.0).

Fourteen operations, **one HTTP call each**: seven on the store
(``list``, ``get``, ``create``, ``update``, ``archive``, ``import_csv``,
``export_csv``) and seven on ``client.data_stores.entries`` (``list``, ``get``,
``set``, ``insert``, ``increment``, ``delete``, ``query``).

Data stores are **project-scoped**: every route accepts an optional
``?project=``, resolved per call, then from the client's default, otherwise
left to the server (the account's default project). Unset options are absent
from the wire — never ``null``.

The CSV pair is the only place this lane leaves JSON, through two **explicit**
transport options (``docs/implementation.md`` §3, text mode): ``import_csv``
sends ``body_encoding="csv"`` (the CSV verbatim as ``text/csv``) and
``export_csv`` asks for ``response_encoding="text"`` (the CSV back as a ``str``,
never JSON-parsed). The mode is never inferred from the body's type.
"""

from __future__ import annotations

from typing import Any, Dict, List, Mapping, Optional, Protocol, Union

from ._config import ResolvedConfig
from ._http import CSV_BODY_ENCODING, TEXT_RESPONSE_ENCODING, HttpResponse, path


class DataStoresHost(Protocol):
    """The slice of `Client` this namespace needs (structural, no import cycle)."""

    #: The resolved configuration; only `project` is read.
    config: ResolvedConfig

    def request(
        self,
        method: str,
        path: str,
        query: Optional[Mapping[str, Any]] = None,
        body: Optional[Any] = None,
        headers: Optional[Mapping[str, str]] = None,
        response_encoding: Optional[str] = None,
        body_encoding: Optional[str] = None,
    ) -> HttpResponse:
        """Perform one request.

        :param method: HTTP method.
        :param path: Base-relative path.
        :param query: Query parameters; `None` values are dropped.
        :param body: Request body.
        :param headers: Extra request headers.
        :param response_encoding: `"text"` returns the 2xx body as a `str`.
        :param body_encoding: `"csv"` sends the body as `text/csv`.
        :returns: The status and parsed body.
        """
        ...  # pragma: no cover - a protocol body is never executed.


def _present(**fields: Any) -> Dict[str, Any]:
    """Drop `None` fields so an unset option is absent from the body, never `null`."""
    return {name: value for name, value in fields.items() if value is not None}


def _project(host: DataStoresHost, project: Optional[str]) -> Optional[str]:
    """Per-call project, else the client's default, else none (no `?project=`)."""
    return project if project is not None else host.config.project


class DataStoreEntriesApi:
    """The `data_stores.entries` namespace; reached as `client.data_stores.entries`."""

    def __init__(self, host: DataStoresHost) -> None:
        """Bind the namespace to the client it issues requests through.

        :param host: The client. Its transport and default project are read.
        """
        self._host = host

    def list(
        self,
        id: str,
        prefix: Optional[str] = None,
        cursor: Optional[str] = None,
        limit: Optional[int] = None,
        project: Optional[str] = None,
    ) -> Dict[str, Any]:
        """List a store's entries, one page.

        :param id: The store id.
        :param prefix: Only keys starting with this.
        :param cursor: Opaque cursor from the previous page's `nextCursor`.
        :param limit: Page size.
        :param project: Project to scope this call to; defaults to the client's.
        :returns: `{"items": [...], "nextCursor"?: str}`.
        :raises ApiError: `400 invalid_cursor`, `404 data_store_not_found`, ...
        """
        return self._host.request(
            "GET",
            path("/data-stores/{id}/entries", id=id),
            query={
                "prefix": prefix,
                "cursor": cursor,
                "limit": limit,
                "project": _project(self._host, project),
            },
        ).body

    def get(self, id: str, key: str, project: Optional[str] = None) -> Dict[str, Any]:
        """Read one entry by key (percent-encoded into the path).

        :param id: The store id.
        :param key: The entry key.
        :param project: Project to scope this call to; defaults to the client's.
        :returns: The entry.
        """
        return self._host.request(
            "GET",
            path("/data-stores/{id}/entries/{key}", id=id, key=key),
            query={"project": _project(self._host, project)},
        ).body

    def set(
        self,
        id: str,
        key: str,
        value: Any,
        if_version: Optional[int] = None,
        ttl_seconds: Optional[int] = None,
        project: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Write one entry (`PUT`); `if_version` makes it a compare-and-set.

        :param id: The store id.
        :param key: The entry key.
        :param value: Any JSON value (a row object for a table store).
        :param if_version: Only write if the entry is at this version. Sent in
            the body as `ifVersion`.
        :param ttl_seconds: Expire the entry after this long. Sent as `ttlSeconds`.
        :param project: Project to scope this call to; defaults to the client's.
        :returns: The entry as written.
        """
        return self._host.request(
            "PUT",
            path("/data-stores/{id}/entries/{key}", id=id, key=key),
            query={"project": _project(self._host, project)},
            body=_present(value=value, ifVersion=if_version, ttlSeconds=ttl_seconds),
        ).body

    def insert(
        self,
        id: str,
        value: Mapping[str, Any],
        ttl_seconds: Optional[int] = None,
        project: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Insert a row into a table store; the server generates the key.

        :param id: The store id.
        :param value: The row.
        :param ttl_seconds: Expire the row after this long.
        :param project: Project to scope this call to; defaults to the client's.
        :returns: The new entry.
        """
        return self._host.request(
            "POST",
            path("/data-stores/{id}/entries", id=id),
            query={"project": _project(self._host, project)},
            body=_present(value=value, ttlSeconds=ttl_seconds),
        ).body

    def increment(
        self,
        id: str,
        key: str,
        by: Optional[Union[int, float]] = None,
        project: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Atomically add to a numeric entry. Omitted `by` sends no body (adds 1).

        :param id: The store id.
        :param key: The entry key.
        :param by: The amount to add.
        :param project: Project to scope this call to; defaults to the client's.
        :returns: The entry after the increment.
        """
        return self._host.request(
            "POST",
            path("/data-stores/{id}/entries/{key}/increment", id=id, key=key),
            query={"project": _project(self._host, project)},
            body=None if by is None else {"by": by},
        ).body

    def delete(self, id: str, key: str, project: Optional[str] = None) -> None:
        """Delete one entry.

        :param id: The store id.
        :param key: The entry key.
        :param project: Project to scope this call to; defaults to the client's.
        """
        self._host.request(
            "DELETE",
            path("/data-stores/{id}/entries/{key}", id=id, key=key),
            query={"project": _project(self._host, project)},
        )

    def query(
        self,
        id: str,
        where: Optional[Mapping[str, Any]] = None,
        order: Optional[str] = None,
        limit: Optional[int] = None,
        project: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Query a table store: filters, ordering, limit.

        :param id: The store id.
        :param where: Column to value; sent as one `where[<col>]=<value>` pair
            per column.
        :param order: Column to order by.
        :param limit: Maximum rows.
        :param project: Project to scope this call to; defaults to the client's.
        :returns: `{"items": [...]}` (no `nextCursor`).
        :raises ApiError: `400 invalid_query` for a malformed filter.
        """
        query: Dict[str, Any] = {}
        for column, value in (where or {}).items():
            query["where[" + column + "]"] = value
        query["order"] = order
        query["limit"] = limit
        query["project"] = _project(self._host, project)
        return self._host.request(
            "GET",
            path("/data-stores/{id}/entries", id=id),
            query=query,
        ).body


class DataStoresApi:
    """The `data_stores` namespace on a `Client`.

    Reached as `client.data_stores`; never constructed directly by a caller.

    Example::

        store = client.data_stores.create("table", "visits", schema={...})
        client.data_stores.entries.insert(store["id"], {"page": "/"})
        csv_text = client.data_stores.export_csv(store["id"])
    """

    def __init__(self, host: DataStoresHost) -> None:
        """Bind the namespace (and its `entries` child) to the client.

        :param host: The client.
        """
        self._host = host
        #: Entry operations: ``entries.list/get/set/insert/increment/delete/query``.
        self.entries: DataStoreEntriesApi = DataStoreEntriesApi(host)

    def list(
        self,
        kind: Optional[str] = None,
        cursor: Optional[str] = None,
        limit: Optional[int] = None,
        project: Optional[str] = None,
    ) -> Dict[str, Any]:
        """List the project's data stores, one page.

        :param kind: `"kv"`, `"doc"` or `"table"`.
        :param cursor: Opaque cursor from the previous page's `nextCursor`.
        :param limit: Page size.
        :param project: Project to scope this call to; defaults to the client's.
        :returns: `{"items": [...], "nextCursor"?: str}`.
        """
        return self._host.request(
            "GET",
            "/data-stores",
            query={
                "kind": kind,
                "cursor": cursor,
                "limit": limit,
                "project": _project(self._host, project),
            },
        ).body

    def get(self, id: str, project: Optional[str] = None) -> Dict[str, Any]:
        """Fetch one store.

        :param id: The store id.
        :param project: Project to scope this call to; defaults to the client's.
        :returns: The store.
        :raises ApiError: `404 data_store_not_found`.
        """
        return self._host.request(
            "GET",
            path("/data-stores/{id}", id=id),
            query={"project": _project(self._host, project)},
        ).body

    def create(
        self,
        kind: str,
        name: str,
        description: Optional[str] = None,
        schema: Optional[Mapping[str, Any]] = None,
        project: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Create a store.

        :param kind: `"kv"`, `"doc"` or `"table"`.
        :param name: The store name.
        :param description: Optional description.
        :param schema: A table store's column schema.
        :param project: Project to scope this call to; defaults to the client's.
        :returns: The new store.
        """
        return self._host.request(
            "POST",
            "/data-stores",
            query={"project": _project(self._host, project)},
            body=_present(kind=kind, name=name, description=description, schema=schema),
        ).body

    def update(
        self,
        id: str,
        name: Optional[str] = None,
        description: Optional[str] = None,
        schema: Optional[Mapping[str, Any]] = None,
        project: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Patch a store; only the given fields are sent.

        :param id: The store id.
        :param name: New name.
        :param description: New description.
        :param schema: New schema.
        :param project: Project to scope this call to; defaults to the client's.
        :returns: The updated store.
        """
        return self._host.request(
            "PATCH",
            path("/data-stores/{id}", id=id),
            query={"project": _project(self._host, project)},
            body=_present(name=name, description=description, schema=schema),
        ).body

    def archive(self, id: str, project: Optional[str] = None) -> None:
        """Archive (soft-delete) a store; it then answers `404 data_store_not_found`.

        :param id: The store id.
        :param project: Project to scope this call to; defaults to the client's.
        """
        self._host.request(
            "DELETE",
            path("/data-stores/{id}", id=id),
            query={"project": _project(self._host, project)},
        )

    def import_csv(
        self,
        id: str,
        csv: Union[str, bytes],
        project: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Import CSV rows into a table store (text mode, `text/csv`).

        :param id: The store id.
        :param csv: The CSV, header row first. A `str` is sent as UTF-8; `bytes`
            verbatim. Never JSON-encoded.
        :param project: Project to scope this call to; defaults to the client's.
        :returns: `{"imported": n}`.
        :raises ApiError: `400 invalid_csv`, or `400 invalid_value` carrying
            `field`/`row`/`column` in `raw["error"]`.
        """
        return self._host.request(
            "POST",
            path("/data-stores/{id}/import", id=id),
            query={"project": _project(self._host, project)},
            body=csv,
            body_encoding=CSV_BODY_ENCODING,
        ).body

    def export_csv(self, id: str, project: Optional[str] = None) -> str:
        """Export a table store as CSV, verbatim (text mode, never JSON-parsed).

        :param id: The store id.
        :param project: Project to scope this call to; defaults to the client's.
        :returns: The CSV text.
        """
        body = self._host.request(
            "GET",
            path("/data-stores/{id}/export", id=id),
            query={"project": _project(self._host, project)},
            response_encoding=TEXT_RESPONSE_ENCODING,
        ).body
        return body if isinstance(body, str) else ""


__all__: List[str] = ["DataStoreEntriesApi", "DataStoresApi", "DataStoresHost"]
