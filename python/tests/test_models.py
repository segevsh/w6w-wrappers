"""`client.models.*`, `model_routes.*`, `model_usage.*` against an injected fake transport."""

from __future__ import annotations

import json
import unittest
from typing import Any, List, Optional, Tuple
from urllib.parse import parse_qs, urlsplit
from urllib.request import Request

from w6w import Client

ENVELOPE = {
    "invocationId": "inv_1",
    "status": "succeeded",
    "key": "k_1",
    "output": {"text": "hi"},
    "raw": {"x": 1},
}


class FakeResponse:
    def __init__(self, status: int, body: str) -> None:
        self.status = status
        self.reason = ""
        self._body = body.encode("utf-8")

    def read(self) -> bytes:
        return self._body


def make(body: Any, project: Optional[str] = None) -> Tuple[Client, List[Request]]:
    calls: List[Request] = []

    def transport(request: Request) -> Any:
        calls.append(request)
        return FakeResponse(200, json.dumps(body))

    client = Client(
        base_url="https://api.example.com", token="tok", project=project, transport=transport
    )
    return client, calls


def query(request: Request) -> dict:
    return parse_qs(urlsplit(request.full_url).query)


class ModelsTest(unittest.TestCase):
    def test_complete_returns_flat_envelope_with_query(self) -> None:
        client, calls = make(ENVELOPE)
        out = client.model_routes.complete(
            "fast", {"messages": [1]}, project="p1", dialect="openai", response="both"
        )
        self.assertEqual(out, ENVELOPE)
        req = calls[0]
        self.assertEqual(req.get_method(), "POST")
        self.assertEqual(urlsplit(req.full_url).path.endswith("/model-routes/fast/complete"), True)
        self.assertEqual(query(req), {"project": ["p1"], "dialect": ["openai"], "response": ["both"]})
        self.assertEqual(json.loads(req.data.decode("utf-8")), {"messages": [1]})

    def test_complete_sends_bridge_dialect(self) -> None:
        client, calls = make(ENVELOPE)
        client.model_routes.complete("fast", {"messages": [1]}, dialect="bridge")
        self.assertEqual(query(calls[0])["dialect"], ["bridge"])

    def test_complete_uses_client_default_project(self) -> None:
        client, calls = make(ENVELOPE, project="dflt")
        client.model_routes.complete("fast", {})
        self.assertEqual(query(calls[0]), {"project": ["dflt"]})

    def test_list_and_get_unwrap_single_key_envelope(self) -> None:
        client, calls = make({"routes": [{"name": "a"}]})
        self.assertEqual(client.model_routes.list(project="p"), [{"name": "a"}])
        self.assertEqual(query(calls[0]), {"project": ["p"]})
        client, _ = make({"route": {"name": "a"}})
        self.assertEqual(client.model_routes.get("a"), {"name": "a"})
        client, _ = make({"model": {"id": "m"}})
        self.assertEqual(client.models.get("m"), {"id": "m"})

    def test_models_list_returns_page(self) -> None:
        page = {"models": [{"id": "m"}], "nextCursor": None}
        client, calls = make(page)
        self.assertEqual(client.models.list(provider="openai", limit=5), page)
        self.assertEqual(query(calls[0]), {"provider": ["openai"], "limit": ["5"]})

    def test_usage_query_params(self) -> None:
        report = {"totals": {}, "totalsTruncated": False, "items": [], "nextCursor": None}
        client, calls = make(report)
        out = client.model_usage.query(
            project="p", group_by="route", from_="2026-01-01", to="2026-02-01",
            route="r", model="m", limit=10, cursor="c",
        )
        self.assertEqual(out, report)
        self.assertEqual(
            query(calls[0]),
            {
                "project": ["p"], "groupBy": ["route"], "from": ["2026-01-01"],
                "to": ["2026-02-01"], "route": ["r"], "model": ["m"],
                "limit": ["10"], "cursor": ["c"],
            },
        )


if __name__ == "__main__":
    unittest.main()
