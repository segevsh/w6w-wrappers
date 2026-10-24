"""`client.models.*`, `client.model_routes.*`, `client.model_usage.*` — the model registry.

Six operations, one HTTP call each. ``model_routes.complete`` returns the
**flat envelope exactly as the server sent it** (``invocationId``, ``status``,
``key`` included) — it is never unwrapped to ``output``.

``complete`` accepts two query selectors:

- ``dialect``: ``"openai" | "anthropic" | "ollama"``
- ``response``: ``"both" | "output" | "raw"``

Routes and usage are project-scoped: per-call ``project``, then the client's
default, otherwise no ``?project=`` on the wire.
"""

from __future__ import annotations

from typing import Any, Dict, List, Mapping, Optional, Protocol

from ._config import ResolvedConfig
from ._http import HttpResponse, path


class ModelsHost(Protocol):
    """The slice of `Client` these namespaces need."""

    config: ResolvedConfig

    def request(
        self,
        method: str,
        path: str,
        query: Optional[Mapping[str, Any]] = None,
        body: Optional[Any] = None,
    ) -> HttpResponse:
        """Perform one request; `None` query values are dropped."""
        ...  # pragma: no cover - a protocol body is never executed.


def _pick(response: HttpResponse, key: str) -> Any:
    """Take ``body[key]`` when the body is a single-key envelope, else the body."""
    body = response.body
    if isinstance(body, dict) and len(body) == 1 and key in body:
        return body[key]
    return body


class ModelsApi:
    """`client.models` — the model catalog."""

    def __init__(self, host: ModelsHost) -> None:
        self._host = host

    def list(
        self,
        provider: Optional[str] = None,
        status: Optional[str] = None,
        limit: Optional[int] = None,
        cursor: Optional[str] = None,
    ) -> Dict[str, Any]:
        """List the catalog; returns the whole page ``{models, nextCursor}``."""
        response = self._host.request(
            "GET",
            "/models",
            query={"provider": provider, "status": status, "limit": limit, "cursor": cursor},
        )
        return response.body  # type: ignore[no-any-return]

    def get(self, id: str) -> Dict[str, Any]:
        """Read one catalog entry by its catalog id (``mdl_…``), not a provider-native id."""
        response = self._host.request("GET", path("/models/{id}", id=id))
        return _pick(response, "model")  # type: ignore[no-any-return]


class ModelRoutesApi:
    """`client.model_routes` — named routes and the completion gateway."""

    def __init__(self, host: ModelsHost) -> None:
        self._host = host

    def _project(self, project: Optional[str]) -> Optional[str]:
        return project if project is not None else self._host.config.project

    def list(self, project: Optional[str] = None) -> List[Dict[str, Any]]:
        """List the project's routes."""
        response = self._host.request(
            "GET", "/model-routes", query={"project": self._project(project)}
        )
        return _pick(response, "routes")  # type: ignore[no-any-return]

    def get(self, name: str, project: Optional[str] = None) -> Dict[str, Any]:
        """Read one route by name."""
        response = self._host.request(
            "GET",
            path("/model-routes/{name}", name=name),
            query={"project": self._project(project)},
        )
        return _pick(response, "route")  # type: ignore[no-any-return]

    def complete(
        self,
        name: str,
        input: Mapping[str, Any],
        project: Optional[str] = None,
        dialect: Optional[str] = None,
        response: Optional[str] = None,
    ) -> Dict[str, Any]:
        """POST `input` to ``/model-routes/{name}/complete``.

        :param dialect: ``"openai"``, ``"anthropic"`` or ``"ollama"``.
        :param response: ``"both"``, ``"output"`` or ``"raw"``.
        :returns: The flat envelope as sent, ``invocationId``/``status``/``key``
            included. Not unwrapped.
        """
        result = self._host.request(
            "POST",
            path("/model-routes/{name}/complete", name=name),
            query={
                "project": self._project(project),
                "dialect": dialect,
                "response": response,
            },
            body=input,
        )
        return result.body  # type: ignore[no-any-return]


class ModelUsageApi:
    """`client.model_usage` — recorded usage."""

    def __init__(self, host: ModelsHost) -> None:
        self._host = host

    def query(
        self,
        project: Optional[str] = None,
        group_by: Optional[str] = None,
        from_: Optional[str] = None,
        to: Optional[str] = None,
        route: Optional[str] = None,
        model: Optional[str] = None,
        limit: Optional[int] = None,
        cursor: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Query usage; ``{totals, totalsTruncated, groups?, items, nextCursor}`` as sent.

        ``totalsTruncated`` is ``True`` when the server stopped folding the ledger
        at its aggregate row cap, so ``totals``/``groups`` cover only part of it.

        ``group_by`` goes on the wire as ``groupBy``; ``from_`` as ``from``.
        """
        response = self._host.request(
            "GET",
            "/model-usage",
            query={
                "project": project if project is not None else self._host.config.project,
                "groupBy": group_by,
                "from": from_,
                "to": to,
                "route": route,
                "model": model,
                "limit": limit,
                "cursor": cursor,
            },
        )
        return response.body  # type: ignore[no-any-return]
