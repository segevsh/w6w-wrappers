"""`client.app_management.*`, against an **injected fake transport**.

Each case asserts the request the wrapper made (method, full URL, serialised
body) against independent literals, and the value it returned against a canned
server body. No case needs a live server.
"""

from __future__ import annotations

import email.message
import io
import json
import unittest
from typing import Any, Callable, List, Tuple
from urllib.error import HTTPError
from urllib.request import Request

from w6w import ApiError, Client

BASE = "https://api.example.com"
FOLDER = {"folder": {"grant": "sgr_1", "path": "./x"}}


class FakeResponse:
    """The minimum a transport must return: a status, a reason and a body."""

    def __init__(self, status: int, body: str = "", reason: str = "") -> None:
        self.status = status
        self.reason = reason
        self._body = body.encode("utf-8")

    def read(self) -> bytes:
        """Read the body once, as `urllib` would."""
        return self._body


class Recorder:
    """A transport-shaped fake that records every request it is handed."""

    def __init__(self, respond: Callable[[Request], Any]) -> None:
        self.calls: List[Request] = []
        self._respond = respond

    def __call__(self, request: Request) -> Any:
        """Record the request, then produce (or raise) the case's outcome."""
        self.calls.append(request)
        return self._respond(request)


def client(respond: Callable[[Request], Any]) -> Tuple[Client, List[Request]]:
    """A client wired to a fake transport."""
    transport = Recorder(respond)
    return Client(base_url=BASE, token="tok_1", transport=transport), transport.calls


def responding(body: Any, status: int = 200) -> Callable[[Request], Any]:
    """Answer every request with one JSON body."""
    text = json.dumps(body)
    return lambda _request: FakeResponse(status, text)


def raising_http(status: int, code: str) -> Callable[[Request], Any]:
    """Raise what `urlopen` raises for a non-2xx status."""

    def _raise(_request: Request) -> Any:
        raise HTTPError(
            BASE + "/app-management/apps",
            status,
            "",
            email.message.Message(),
            io.BytesIO(json.dumps({"error": {"code": code, "message": "m"}}).encode("utf-8")),
        )

    return _raise


def sent(request: Request) -> Any:
    """The JSON body actually put on the wire, parsed back."""
    assert request.data is not None, "expected a request body"
    return json.loads(request.data.decode("utf-8"))


class AppManagementOpsTest(unittest.TestCase):
    """One case per operation, plus the pins that cut across them."""

    def test_list_sends_only_the_given_options(self) -> None:
        page = {"apps": [], "targets": [], "nextCursor": "c2"}
        api, calls = client(responding(page))
        self.assertEqual(api.app_management.list(), page)
        self.assertEqual(calls[0].get_method(), "GET")
        self.assertEqual(calls[0].full_url, BASE + "/app-management/apps")
        self.assertIsNone(calls[0].data)

    def test_list_forwards_every_option_under_its_wire_name(self) -> None:
        api, calls = client(responding({"apps": []}))
        api.app_management.list(
            scope="account",
            q="mail",
            sort="-recent",
            compact=False,
            cursor="c1",
            offset=0,
            limit=5,
        )
        self.assertEqual(
            calls[0].full_url,
            BASE
            + "/app-management/apps?scope=account&q=mail&sort=-recent"
            + "&compact=false&cursor=c1&offset=0&limit=5",
        )

    def test_list_forwards_snapshot(self) -> None:
        api, calls = client(responding({"apps": []}))
        api.app_management.list(snapshot="snap_1")
        self.assertEqual(calls[0].full_url, BASE + "/app-management/apps?snapshot=snap_1")

    def test_get(self) -> None:
        detail = {"app": {"id": "a/b"}, "management": {"class": "managed"}}
        api, calls = client(responding(detail))
        self.assertEqual(api.app_management.get("a/b"), detail)
        self.assertEqual(calls[0].get_method(), "GET")
        self.assertEqual(calls[0].full_url, BASE + "/app-management/apps/a%2Fb")

    def test_preview_nests_the_folder_source_verbatim(self) -> None:
        out = {"kind": "app", "sourceRef": "folder:x", "app": {}}
        api, calls = client(responding(out))
        self.assertEqual(api.app_management.preview(FOLDER, "tenant"), out)
        self.assertEqual(calls[0].get_method(), "POST")
        self.assertEqual(calls[0].full_url, BASE + "/app-management/preview")
        self.assertEqual(sent(calls[0]), {"source": FOLDER, "target": "tenant"})

    def test_preview_string_source(self) -> None:
        api, calls = client(responding({"kind": "app"}))
        api.app_management.preview("github:acme/app", "personal")
        self.assertEqual(sent(calls[0]), {"source": "github:acme/app", "target": "personal"})

    def test_register_without_paths_omits_the_key(self) -> None:
        out = {"target": "account", "app": {"id": "x"}}
        api, calls = client(responding(out, 201))
        self.assertEqual(api.app_management.register("account", "github:acme/app"), out)
        self.assertEqual(calls[0].get_method(), "POST")
        self.assertEqual(calls[0].full_url, BASE + "/app-management/apps")
        body = sent(calls[0])
        self.assertEqual(body, {"target": "account", "source": "github:acme/app"})
        self.assertNotIn("paths", body)

    def test_register_sends_paths_and_a_folder_source(self) -> None:
        api, calls = client(responding({"target": "tenant"}, 201))
        api.app_management.register("tenant", FOLDER, paths=["a", "b"])
        self.assertEqual(
            sent(calls[0]), {"target": "tenant", "source": FOLDER, "paths": ["a", "b"]}
        )

    def test_update_source_sends_expected_revision_camel_case(self) -> None:
        result = {"outcome": "registry_updated"}
        api, calls = client(responding(result))
        self.assertEqual(api.app_management.update_source("a/b", FOLDER, 0), result)
        self.assertEqual(calls[0].get_method(), "PUT")
        self.assertEqual(calls[0].full_url, BASE + "/app-management/apps/a%2Fb/source")
        self.assertEqual(sent(calls[0]), {"source": FOLDER, "expectedRevision": 0})

    def test_sync_without_revision_sends_an_empty_object(self) -> None:
        result = {"outcome": "definition_unchanged"}
        api, calls = client(responding(result))
        self.assertEqual(api.app_management.sync("a/b"), result)
        self.assertEqual(calls[0].get_method(), "POST")
        self.assertEqual(calls[0].full_url, BASE + "/app-management/apps/a%2Fb/sync")
        self.assertEqual(sent(calls[0]), {})

    def test_sync_sends_a_zero_revision(self) -> None:
        api, calls = client(responding({"outcome": "registry_updated"}))
        api.app_management.sync("x", expected_revision=0)
        self.assertEqual(sent(calls[0]), {"expectedRevision": 0})

    def test_sync_failed_outcome_is_a_returned_value(self) -> None:
        failed = {"outcome": "failed", "error": {"code": "fetch_failed", "message": "m"}}
        api, _calls = client(responding(failed))
        self.assertEqual(api.app_management.sync("x"), failed)

    def test_remove(self) -> None:
        api, calls = client(responding({"removed": 3}))
        self.assertEqual(api.app_management.remove("a/b"), {"removed": 3})
        self.assertEqual(calls[0].get_method(), "DELETE")
        self.assertEqual(calls[0].full_url, BASE + "/app-management/apps/a%2Fb")
        self.assertIsNone(calls[0].data)

    def test_403_local_import_forbidden_surfaces_its_code(self) -> None:
        api, _calls = client(raising_http(403, "local_import_forbidden"))
        with self.assertRaises(ApiError) as ctx:
            api.app_management.preview(FOLDER, "account")
        self.assertEqual(ctx.exception.status, 403)
        self.assertEqual(ctx.exception.code, "local_import_forbidden")

    def test_410_snapshot_expired_surfaces_its_code(self) -> None:
        api, _calls = client(raising_http(410, "snapshot_expired"))
        with self.assertRaises(ApiError) as ctx:
            api.app_management.list(snapshot="old")
        self.assertEqual(ctx.exception.status, 410)
        self.assertEqual(ctx.exception.code, "snapshot_expired")

    def test_404_unknown_app_surfaces_its_code(self) -> None:
        api, _calls = client(raising_http(404, "unknown_app"))
        with self.assertRaises(ApiError) as ctx:
            api.app_management.get("nope")
        self.assertEqual(ctx.exception.code, "unknown_app")


if __name__ == "__main__":
    unittest.main()
