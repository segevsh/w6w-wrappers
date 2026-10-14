"""`client.projects.list()` — the account's active projects, read-only.

Project create, rename, archive and delete are not in the contract. SIDE
EFFECT, owned by the server: the GET ensures the account's default project
exists and creates it when there is none, so a first call on a fresh account
returns one `isDefault: true` row, not `[]`.
"""

from __future__ import annotations

from typing import Any, Dict, List, Mapping, Optional, Protocol

from ._http import HttpResponse
from .types import unwrap_list


class ProjectsHost(Protocol):
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


class ProjectsApi:
    """The `projects` namespace on a `Client`."""

    def __init__(self, host: ProjectsHost) -> None:
        """Bind the namespace to the client it issues requests through.

        :param host: The client this namespace issues requests through.
        """
        self._host = host

    def list(self) -> List[Dict[str, Any]]:
        """List the account's active (non-archived) projects.

        :returns: The projects, unwrapped from the `projects` envelope; each
            row carries `isDefault`.
        :raises ApiError: On any non-2xx.
        :raises ApiError: `bad_response` when a `2xx` body carries no `projects` list.
        """
        return unwrap_list(self._host.request("GET", "/projects"), "projects")
