"""`client.dashboard.stats()` — the account's activity rollup.

Account-scoped: the account comes from the credential. There is NO `project`
parameter and the client's default project is never sent. The response has no
envelope key; the rollup (`range`, `headline`, `series`, `recent`) IS the body.
"""

from __future__ import annotations

from typing import Any, Dict, Mapping, Optional, Protocol

from ._http import HttpResponse
from .types import require_object


class DashboardHost(Protocol):
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


class DashboardApi:
    """The `dashboard` namespace on a `Client`."""

    def __init__(self, host: DashboardHost) -> None:
        """Bind the namespace to the client it issues requests through.

        :param host: The client this namespace issues requests through.
        """
        self._host = host

    def stats(
        self,
        from_: Optional[str] = None,
        to: Optional[str] = None,
        bucket: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Fetch the account's dashboard rollup.

        Each argument is sent only when given; the server applies its own
        defaults otherwise.

        :param from_: ISO-8601 instant; the wire name is `from` (a Python
            keyword, hence the underscore).
        :param to: ISO-8601 instant.
        :param bucket: `"day"` or `"week"`. Documentation, not a client-side
            constraint: the server decides what it accepts.
        :returns: The body as sent: `range`, `headline`, `series`, `recent`.
        :raises ApiError: On any non-2xx.
        """
        response = self._host.request(
            "GET",
            "/dashboard/stats",
            query={"from": from_, "to": to, "bucket": bucket},
        )
        return require_object(response, "a dashboard rollup")
