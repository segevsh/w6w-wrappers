"""`client.apps.by_ids()` — a bounded lookup of apps by id, and nothing more.

One operation. It lets a host rendering a list of connections (or a reliability
board) resolve the icons and labels of the apps it names **without fetching the
whole catalog**. Browsing, searching and paging the catalog stay out of the
contract.

For a *connection's* app prefer the `app` object already inlined on every
:class:`~w6w.ConnectionSummary`: it costs no extra request. Reach for `by_ids`
for ids that do not come from a connection.

The server caps `GET /apps?ids=` at 100 ids and answers `400 too_many_ids`
beyond that. This method chunks to the cap client-side, so the cap never
reaches a caller. The python lane is synchronous: chunks are issued one after
the other, in order.
"""

from __future__ import annotations

from typing import Any, Dict, List, Mapping, Optional, Protocol, Sequence

from ._http import HttpResponse
from .types import unwrap_list

#: The server's own `ids` cap per `GET /apps` request; `by_ids` chunks to it.
MAX_IDS_PER_REQUEST = 100


class AppsHost(Protocol):
    """The slice of `Client` this namespace needs: the transport, nothing else."""

    def request(
        self,
        method: str,
        path: str,
        query: Optional[Mapping[str, Any]] = None,
        body: Optional[Any] = None,
    ) -> HttpResponse:
        """Perform one request."""
        ...  # pragma: no cover - a protocol body is never executed.


class AppsApi:
    """The `apps` namespace on a `Client`.

    Example::

        for app in client.apps.by_ids(["sendgrid", "slack"]):
            print(app["id"], app["displayName"])
    """

    def __init__(self, host: AppsHost) -> None:
        """Bind the namespace to the client it issues requests through.

        :param host: The client this namespace issues requests through.
        """
        self._host = host

    def by_ids(self, ids: Sequence[str]) -> List[Dict[str, Any]]:
        """Resolve a set of app ids to their catalog summaries.

        Duplicates are collapsed first (first occurrence wins the order). An
        empty set returns `[]` with **no request at all** — never an unfiltered
        page of the catalog. Chunks of at most 100 ids each become one
        `GET /apps?ids=a,b,…`, and the pages are concatenated in chunk order.
        Ids the catalog does not know are simply absent from the result.

        :param ids: The app ids to look up.
        :returns: The matching apps, unwrapped from the `apps` page envelope.
        :raises ConfigError: When no token is configured.
        :raises ApiError: On any non-2xx.
        :raises ApiError: `bad_response` when a `2xx` body carries no `apps` list.
        """
        unique = list(dict.fromkeys(ids))
        apps: List[Dict[str, Any]] = []
        for start in range(0, len(unique), MAX_IDS_PER_REQUEST):
            chunk = unique[start : start + MAX_IDS_PER_REQUEST]
            response = self._host.request("GET", "/apps", query={"ids": ",".join(chunk)})
            apps.extend(unwrap_list(response, "apps"))
        return apps
