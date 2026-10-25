"""`client.assets.*`, against an **injected fake transport**.

No case here needs a live server or opens a socket (`docs/implementation.md`
§9): every one hands the client a callable that records the
`urllib.request.Request` it was given and returns — or raises — whatever the
case is about. The real `urlopen` is never called.

Two things are asserted that no other file can see, because they are the reason
this module exists (contract `0.11.0`):

- **Bytes in.** `uploads.put_entry` puts the caller's `bytes` on the wire
  exactly — `content-type: application/octet-stream`, and a sha256 of the sent
  body equal to the digest the caller declared. A JSON quoting, base64 or text
  round-trip of any kind changes that digest, so the assertion is on the bytes
  themselves and on their digest, never on a rendering of them.
- **Bytes out.** `content` and `archive_download` return the body unmodified,
  including a sequence that is not valid UTF-8 (`\\xff\\xfe\\x00`). A decode
  would replace those bytes; a JSON parse would either fail or coerce them.

Both are checked together with the unchanged half: a non-2xx in byte mode still
raises the typed :class:`ApiError` carrying the envelope's `code`.
"""

from __future__ import annotations

import email.message
import hashlib
import io
import json
import unittest
from typing import Any, Callable, List, Tuple
from urllib.error import HTTPError
from urllib.request import Request

from w6w import ApiError, Client

#: One upload, as the server sends it.
UPLOAD_STATUS = {
    "upload": {
        "id": "upl_1",
        "purpose": "skill",
        "visibility": "private",
        "project": None,
        "assetId": None,
        "versionId": None,
        "name": "acme-skill",
        "status": "open",
        "reservedBytes": 3,
        "reservedFiles": 1,
        "errorCode": None,
        "expiresAt": "2026-10-25T12:00:00.000Z",
        "createdAt": "2026-10-24T12:00:00.000Z",
        "updatedAt": "2026-10-24T12:00:00.000Z",
    },
    "entries": [
        {
            "index": 0,
            "path": "SKILL.md",
            "sizeBytes": 3,
            "sha256": "abc",
            "state": "pending",
            "receivedAt": None,
        },
    ],
}

#: One entry, as the server sends it after a successful PUT.
ENTRY = {
    "index": 0,
    "path": "SKILL.md",
    "sizeBytes": 3,
    "sha256": "abc",
    "state": "received",
    "receivedAt": "2026-10-24T12:00:05.000Z",
}

#: One asset, as the server sends it.
ASSET = {
    "id": "ast_1",
    "name": "acme-skill",
    "kind": "skill",
    "visibility": "private",
    "project": None,
    "ownerSubject": "sub_1",
    "activeVersionId": "asv_1",
    "archivedAt": None,
    "createdAt": "2026-10-24T12:00:00.000Z",
    "updatedAt": "2026-10-24T12:00:00.000Z",
}

#: One version, as the server sends it.
VERSION = {
    "id": "asv_1",
    "assetId": "ast_1",
    "version": 1,
    "inventoryDigest": "dig_1",
    "readiness": "ready",
    "syncState": "synced",
    "totalBytes": 3,
    "fileCount": 1,
    "createdBy": "sub_1",
    "createdAt": "2026-10-24T12:00:00.000Z",
    "readyAt": "2026-10-24T12:00:01.000Z",
}

#: One file, as the server sends it.
FILE = {
    "id": "asf_1",
    "path": "SKILL.md",
    "mediaType": "text/markdown",
    "sizeBytes": 3,
    "sha256": "abc",
    "createdAt": "2026-10-24T12:00:00.000Z",
}


class FakeResponse:
    """The minimum a transport must return: a status, a reason and a body.

    The body is **bytes**, not a string, because the byte-mode cases have to
    hand back a payload that is not valid UTF-8 at all.
    """

    def __init__(self, status: int, body: bytes = b"", reason: str = "") -> None:
        self.status = status
        self.reason = reason
        self._body = body

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


def http_error(status: int, body: Any, reason: str = "") -> HTTPError:
    """Build the exception `urlopen` raises for a non-2xx status.

    An `HTTPError` **is** a response: it carries the status, the reason and a
    readable body, so the error cases exercise the same `urllib` trap a live
    server would.
    """
    return HTTPError(
        "https://api.example.com/assets/ast_1",
        status,
        reason,
        email.message.Message(),
        io.BytesIO(json.dumps(body).encode("utf-8")),
    )


def html_error(status: int, body: bytes) -> HTTPError:
    """A non-2xx carrying a non-JSON body — a proxy error page."""
    return HTTPError(
        "https://api.example.com/assets",
        status,
        "Bad Gateway",
        email.message.Message(),
        io.BytesIO(body),
    )


def client(
    respond: Callable[[Request], Any],
    token: Any = "tok_1",
    **kwargs: Any,
) -> Tuple[Client, List[Request]]:
    """A client wired to a fake transport."""
    transport = Recorder(respond)
    return (
        Client(
            base_url="https://api.example.com",
            token=token,
            transport=transport,
            **kwargs,
        ),
        transport.calls,
    )


def responding_bytes(body: bytes, status: int = 200) -> Callable[[Request], Any]:
    """Answer every request with one raw payload."""
    return lambda _request: FakeResponse(status, body)


def responding(body: Any, status: int = 200) -> Callable[[Request], Any]:
    """Answer every request with one JSON body."""
    return responding_bytes(json.dumps(body).encode("utf-8"), status)


def raising(error: BaseException) -> Callable[[Request], Any]:
    """Raise, the way `urlopen` does for a non-2xx status."""

    def _raise(_request: Request) -> Any:
        raise error

    return _raise


class SurfaceTest(unittest.TestCase):
    """The namespace exists and is complete, in `naming.python`'s spelling."""

    def test_all_twelve_operations_are_callable_on_a_constructed_client(self) -> None:
        instance = Client(base_url="https://api.example.com", token="t")

        for name in (
            "get",
            "versions",
            "files",
            "content",
            "archive_download",
            "archive",
            "purge",
        ):
            with self.subTest(operation="assets." + name):
                self.assertTrue(callable(getattr(instance.assets, name, None)))
        for name in ("create", "put_entry", "finalize", "get", "abort"):
            with self.subTest(operation="assets.uploads." + name):
                self.assertTrue(callable(getattr(instance.assets.uploads, name, None)))


class BytesInTest(unittest.TestCase):
    """`uploads.put_entry` is byte mode: the caller's bytes, untouched."""

    def test_put_entry_sends_the_exact_bytes_with_no_json_or_text_round_trip(
        self,
    ) -> None:
        # A payload that survives nothing except being sent as itself: a NUL, a
        # quote, a newline, a lone high byte and a byte that is not valid UTF-8.
        payload = b'\x00{"not":"json"}\n\xff\xfe'
        instance, calls = client(responding({"entry": ENTRY}))

        entry = instance.assets.uploads.put_entry("upl_1", 0, payload)

        self.assertEqual(entry, ENTRY)
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0].get_method(), "PUT")
        self.assertEqual(
            calls[0].full_url,
            "https://api.example.com/asset-uploads/upl_1/entries/0",
        )
        self.assertEqual(calls[0].get_header("Authorization"), "Bearer tok_1")
        # The digest the caller declared for the entry is a digest of exactly
        # these bytes: any quoting, base64 or newline translation breaks it.
        self.assertEqual(calls[0].data, payload)
        self.assertEqual(
            hashlib.sha256(calls[0].data or b"").hexdigest(),
            hashlib.sha256(payload).hexdigest(),
        )
        self.assertEqual(
            calls[0].get_header("Content-type"),
            "application/octet-stream",
        )

    def test_a_zero_byte_entry_is_still_a_body(self) -> None:
        instance, calls = client(responding({"entry": ENTRY}))

        instance.assets.uploads.put_entry("upl_1", 0, b"")

        self.assertEqual(calls[0].data, b"")
        self.assertIsNotNone(calls[0].data, "an empty body must not become no body")
        self.assertEqual(
            calls[0].get_header("Content-type"),
            "application/octet-stream",
        )

    def test_a_byte_entry_is_re_sent_identically_after_a_401_recovery(self) -> None:
        payload = b"\xff\xfe\x00binary"
        seen: List[Request] = []

        def respond(request: Request) -> Any:
            seen.append(request)
            if len(seen) == 1:
                raise http_error(
                    401,
                    {"error": {"code": "unauthorized", "message": "Token expired."}},
                    "Unauthorized",
                )
            return FakeResponse(200, json.dumps({"entry": ENTRY}).encode("utf-8"))

        tokens: List[bool] = []

        def token(force_refresh: bool = False) -> str:
            tokens.append(force_refresh)
            return "tok_2" if force_refresh else "tok_1"

        instance, _calls = client(
            respond, token=token, refresh_on_unauthorized=True
        )

        instance.assets.uploads.put_entry("upl_1", 0, payload)

        self.assertEqual(tokens, [False, True])
        self.assertEqual(len(seen), 2)
        self.assertEqual(seen[0].data, payload)
        self.assertEqual(seen[1].data, payload)
        self.assertEqual(seen[1].get_header("Authorization"), "Bearer tok_2")

    def test_a_json_body_still_goes_as_json(self) -> None:
        # The guard on the OTHER direction: byte mode must not have swallowed
        # ordinary JSON requests. `create` is the nearest JSON operation.
        instance, calls = client(responding(UPLOAD_STATUS))

        instance.assets.uploads.create(
            purpose="skill",
            idempotency_key="acme-1",
            entries=[{"path": "SKILL.md", "sizeBytes": 3, "sha256": "abc"}],
        )

        self.assertEqual(calls[0].get_header("Content-type"), "application/json")
        self.assertEqual(
            json.loads((calls[0].data or b"").decode("utf-8")),
            {
                "purpose": "skill",
                "idempotencyKey": "acme-1",
                "entries": [{"path": "SKILL.md", "sizeBytes": 3, "sha256": "abc"}],
            },
        )


class BytesOutTest(unittest.TestCase):
    """`content` and `archive_download` return the exact bytes."""

    def test_content_returns_a_non_utf8_payload_unmodified(self) -> None:
        payload = b"\xff\xfe\x00"
        instance, calls = client(responding_bytes(payload))

        raw = instance.assets.content("ast_1", "asv_1", "asf_1")

        self.assertEqual(raw, payload)
        self.assertIsInstance(raw, bytes)
        self.assertEqual(calls[0].get_method(), "GET")
        self.assertEqual(
            calls[0].full_url,
            "https://api.example.com/assets/ast_1/versions/asv_1/files/asf_1/content",
        )

    def test_content_never_json_parses_a_body_that_happens_to_be_json(self) -> None:
        # A text file uploaded by a user is not the wrapper's business to
        # interpret: bytes out means bytes out, whatever they spell.
        payload = b'{"not":"the envelope"}'
        instance, _calls = client(responding_bytes(payload))

        self.assertEqual(
            instance.assets.content("ast_1", "asv_1", "asf_1"),
            payload,
        )

    def test_archive_download_returns_the_zip_bytes_unmodified(self) -> None:
        payload = b"PK\x03\x04\xff\x00zipped"
        instance, calls = client(responding_bytes(payload))

        raw = instance.assets.archive_download("ast_1", "asv_1")

        self.assertEqual(raw, payload)
        self.assertEqual(
            calls[0].full_url,
            "https://api.example.com/assets/ast_1/versions/asv_1/archive",
        )

    def test_a_non_2xx_in_byte_mode_still_raises_the_envelope_code(self) -> None:
        instance, _calls = client(
            raising(
                http_error(
                    404,
                    {"error": {"code": "not_found", "message": "No such file."}},
                    "Not Found",
                )
            )
        )

        with self.assertRaises(ApiError) as raised:
            instance.assets.content("ast_1", "asv_1", "asf_1")

        self.assertEqual(raised.exception.status, 404)
        self.assertEqual(raised.exception.code, "not_found")
        self.assertEqual(raised.exception.message, "No such file.")

    def test_a_non_json_error_body_in_byte_mode_is_bad_response(self) -> None:
        html = b"<html>Bad gateway</html>"
        instance, _calls = client(raising(html_error(502, html)))

        with self.assertRaises(ApiError) as raised:
            instance.assets.archive_download("ast_1", "asv_1")

        self.assertEqual(raised.exception.status, 502)
        self.assertEqual(raised.exception.code, "bad_response")
        # The bytes are reported as a snippet of TEXT, never surfaced as a
        # payload the caller could mistake for the file they asked for.
        self.assertIn("Bad gateway", raised.exception.message)


class JsonOperationsTest(unittest.TestCase):
    """The ten JSON operations: right path, right body, unwrapped payload."""

    def test_create_posts_the_declaration_and_omits_absent_optional_fields(
        self,
    ) -> None:
        instance, calls = client(responding(UPLOAD_STATUS))

        status = instance.assets.uploads.create(
            purpose="context",
            idempotency_key="ctx-1",
            entries=[{"path": "docs/a.md", "sizeBytes": 3, "sha256": "abc"}],
        )

        self.assertEqual(status, UPLOAD_STATUS)
        self.assertEqual(calls[0].get_method(), "POST")
        self.assertEqual(calls[0].full_url, "https://api.example.com/asset-uploads")
        # `None` means OMITTED here, not `null` — there is no prior value to
        # preserve on a create.
        self.assertEqual(
            json.loads((calls[0].data or b"").decode("utf-8")),
            {
                "purpose": "context",
                "idempotencyKey": "ctx-1",
                "entries": [{"path": "docs/a.md", "sizeBytes": 3, "sha256": "abc"}],
            },
        )

    def test_create_sends_every_optional_field_when_given(self) -> None:
        instance, calls = client(responding(UPLOAD_STATUS))

        instance.assets.uploads.create(
            purpose="skill",
            idempotency_key="acme-2",
            entries=[],
            name="acme-skill",
            visibility="project",
            asset_id="ast_1",
            target={"skillId": "skl_1"},
        )

        self.assertEqual(
            json.loads((calls[0].data or b"").decode("utf-8")),
            {
                "purpose": "skill",
                "idempotencyKey": "acme-2",
                "entries": [],
                "name": "acme-skill",
                "visibility": "project",
                "assetId": "ast_1",
                "target": {"skillId": "skl_1"},
            },
        )

    def test_finalize_get_and_abort_address_the_upload_routes(self) -> None:
        finalize_body = {
            "uploadId": "upl_1",
            "assetId": "ast_1",
            "versionId": "asv_1",
            "version": 1,
            "readiness": "ready",
            "derived": None,
            "created": True,
        }
        instance, calls = client(
            lambda request: FakeResponse(
                200,
                json.dumps(
                    finalize_body if request.get_method() == "POST" else UPLOAD_STATUS
                ).encode("utf-8"),
            )
        )

        self.assertEqual(instance.assets.uploads.finalize("upl_1"), finalize_body)
        self.assertEqual(instance.assets.uploads.get("upl_1"), UPLOAD_STATUS)
        self.assertEqual(instance.assets.uploads.abort("upl_1"), UPLOAD_STATUS)

        self.assertEqual(
            [(call.get_method(), call.full_url) for call in calls],
            [
                ("POST", "https://api.example.com/asset-uploads/upl_1/finalize"),
                ("GET", "https://api.example.com/asset-uploads/upl_1"),
                ("DELETE", "https://api.example.com/asset-uploads/upl_1"),
            ],
        )

    def test_get_unwraps_the_asset_envelope(self) -> None:
        instance, calls = client(responding({"asset": ASSET}))

        self.assertEqual(instance.assets.get("ast_1"), ASSET)
        self.assertEqual(calls[0].full_url, "https://api.example.com/assets/ast_1")

    def test_versions_unwraps_the_versions_envelope(self) -> None:
        instance, calls = client(responding({"versions": [VERSION]}))

        self.assertEqual(instance.assets.versions("ast_1"), [VERSION])
        self.assertEqual(
            calls[0].full_url,
            "https://api.example.com/assets/ast_1/versions",
        )

    def test_files_returns_the_version_and_files_as_sent(self) -> None:
        body = {"version": VERSION, "files": [FILE]}
        instance, calls = client(responding(body))

        self.assertEqual(instance.assets.files("ast_1", "asv_1"), body)
        self.assertEqual(
            calls[0].full_url,
            "https://api.example.com/assets/ast_1/versions/asv_1/files",
        )

    def test_archive_unwraps_the_asset_envelope_and_purge_returns_its_body(
        self,
    ) -> None:
        purge_body = {"assetId": "ast_1", "versionsDeleted": 2, "objectsDeleted": 5}
        instance, calls = client(
            lambda request: FakeResponse(
                200,
                json.dumps(
                    purge_body if request.get_method() == "DELETE" else {"asset": ASSET}
                ).encode("utf-8"),
            )
        )

        self.assertEqual(instance.assets.archive("ast_1"), ASSET)
        self.assertEqual(instance.assets.purge("ast_1"), purge_body)
        self.assertEqual(
            [(call.get_method(), call.full_url) for call in calls],
            [
                ("POST", "https://api.example.com/assets/ast_1/archive"),
                ("DELETE", "https://api.example.com/assets/ast_1"),
            ],
        )

    def test_ids_are_percent_encoded_into_one_path_segment(self) -> None:
        instance, calls = client(responding({"asset": ASSET}))

        instance.assets.get("a/b")

        self.assertEqual(
            calls[0].full_url,
            "https://api.example.com/assets/a%2Fb",
        )

    def test_a_missing_envelope_key_is_bad_response(self) -> None:
        instance, _calls = client(responding({"not_an_asset": ASSET}))

        with self.assertRaises(ApiError) as raised:
            instance.assets.get("ast_1")

        self.assertEqual(raised.exception.code, "bad_response")


if __name__ == "__main__":  # pragma: no cover - convenience for a single-file run.
    unittest.main()
