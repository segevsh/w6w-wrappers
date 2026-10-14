"""`client.reliability.*` — health of the APIs a project calls.

Two read operations: `members` discovers which app ids a project has (no status
probes are made), and `list` returns the reliability board for at most 10 of
them. There is NO batching helper: the server's limit of 10 ids reaches the
caller as `400 invalid_app_filter`, and splitting a larger set, scheduling and
polling are the host's job.
"""

from __future__ import annotations

from typing import Any, Dict, Mapping, Optional, Protocol, Sequence

from ._http import HttpResponse
from .types import require_object


class ReliabilityHost(Protocol):
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


class ReliabilityApi:
    """The `reliability` namespace on a `Client`."""

    def __init__(self, host: ReliabilityHost) -> None:
        """Bind the namespace to the client it issues requests through.

        :param host: The client this namespace issues requests through.
        """
        self._host = host

    def list(
        self,
        project: str,
        app_ids: Sequence[str],
        days: Optional[int] = None,
        limit: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Fetch the reliability board for up to 10 apps of a project.

        :param project: The project id (required: `400 missing_project`).
        :param app_ids: Exactly the ids to send, comma-joined on the wire. The
            server accepts 1 to 10; anything else is `400 invalid_app_filter`,
            surfaced as :class:`~w6w.ApiError` unchanged.
        :param days: Positive number of days; sent only when given.
        :param limit: Positive cap, applied after the most-urgent-first
            ordering; sent only when given.
        :returns: The board, as sent (no envelope key).
        :raises ApiError: On any non-2xx.
        """
        response = self._host.request(
            "GET",
            "/reliability/services",
            query={"project": project, "apps": ",".join(app_ids), "days": days, "limit": limit},
        )
        return require_object(response, "a reliability board")

    def members(self, project: str, days: Optional[int] = None) -> Dict[str, Any]:
        """Discover the app ids a project calls (identifier-only, no probes).

        :param project: The project id (required: `400 missing_project`).
        :param days: Positive number of days; sent only when given.
        :returns: The body as sent; `appIds` is the list to feed, at most 10 at
            a time, to :meth:`list`.
        :raises ApiError: On any non-2xx.
        """
        response = self._host.request(
            "GET",
            "/reliability/services/members",
            query={"project": project, "days": days},
        )
        return require_object(response, "a reliability member list")
