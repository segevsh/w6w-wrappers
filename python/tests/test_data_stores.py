"""`client.data_stores.*` against an injected fake transport (contract 0.15.0).

Expected request shapes are INDEPENDENT literals (never derived from
`endpoints.json` at request time); only the two encoding constants are checked
against the contract file.
"""

from __future__ import annotations

import io
import json
import unittest
from email.message import Message
from pathlib import Path
from typing import Any, Callable, List, Optional
from urllib.error import HTTPError
from urllib.parse import parse_qsl, urlsplit
from urllib.request import Request

from w6w import ApiError, Client, _http

_CONTRACT = Path(__file__).resolve().parent.parent.parent / "endpoints.json"


class FakeResponse:
    def __init__(self, status: int, body: bytes = b"") -> None:
        self.status = status
        self.reason = ""
        self._body = body

    def read(self) -> bytes:
        return self._body


class Recorder:
    def __init__(self, respond: Callable[[Request], Any]) -> None:
        self.calls: List[Request] = []
        self._respond = respond

    def __call__(self, request: Request) -> Any:
        self.calls.append(request)
        return self._respond(request)


def answering(body: Any, status: int = 200) -> Recorder:
    data = json.dumps(body).encode("utf-8") if body is not None else b""
    return Recorder(lambda _r: FakeResponse(status, data))


def client(transport: Any, project: Optional[str] = None) -> Client:
    return Client(
        base_url="https://api.example.com",
        token="tok_1",
        transport=transport,
        project=project,
    )


def split(request: Request) -> Any:
    parts = urlsplit(request.full_url)
    return parts.path, parse_qsl(parts.query, keep_blank_values=True)


def body_of(request: Request) -> Any:
    return json.loads(request.data) if request.data is not None else None


class EncodingConstantsTest(unittest.TestCase):
    def test_constants_equal_the_contract_values(self) -> None:
        ops = {o["name"]: o for o in json.loads(_CONTRACT.read_text())["operations"]}
        self.assertEqual(_http.CSV_BODY_ENCODING, ops["dataStores.importCsv"]["bodyEncoding"])
        self.assertEqual(
            _http.TEXT_RESPONSE_ENCODING, ops["dataStores.exportCsv"]["responseEncoding"]
        )


class StoreTest(unittest.TestCase):
    def test_list_sends_only_set_options(self) -> None:
        t = answering({"items": []})
        client(t).data_stores.list(kind="table", limit=5)
        path, query = split(t.calls[0])
        self.assertEqual(t.calls[0].get_method(), "GET")
        self.assertEqual(path, "/data-stores")
        self.assertEqual(query, [("kind", "table"), ("limit", "5")])

    def test_project_per_call_beats_client_default(self) -> None:
        t = answering({"items": []})
        c = client(t, project="prj_default")
        c.data_stores.list()
        c.data_stores.list(project="prj_call")
        self.assertEqual(split(t.calls[0])[1], [("project", "prj_default")])
        self.assertEqual(split(t.calls[1])[1], [("project", "prj_call")])

    def test_get_and_archive(self) -> None:
        t = answering({"id": "ds_1"})
        self.assertEqual(client(t).data_stores.get("ds_1"), {"id": "ds_1"})
        self.assertEqual(split(t.calls[0])[0], "/data-stores/ds_1")
        t2 = Recorder(lambda _r: FakeResponse(204))
        self.assertIsNone(client(t2).data_stores.archive("ds_1"))
        self.assertEqual(t2.calls[0].get_method(), "DELETE")

    def test_create_body_omits_unset(self) -> None:
        t = answering({"id": "ds_1"}, 201)
        client(t).data_stores.create("table", "visits", schema={"columns": []})
        self.assertEqual(t.calls[0].get_method(), "POST")
        self.assertEqual(
            body_of(t.calls[0]),
            {"kind": "table", "name": "visits", "schema": {"columns": []}},
        )

    def test_update_is_a_patch_with_only_given_fields(self) -> None:
        t = answering({"id": "ds_1"})
        client(t).data_stores.update("ds_1", name="n2")
        self.assertEqual(t.calls[0].get_method(), "PATCH")
        self.assertEqual(body_of(t.calls[0]), {"name": "n2"})


class CsvTest(unittest.TestCase):
    def test_import_str_is_utf8_text_csv(self) -> None:
        t = answering({"imported": 1})
        out = client(t).data_stores.import_csv("ds_1", "id,name\n1,ä\n")
        req = t.calls[0]
        self.assertEqual(out, {"imported": 1})
        self.assertEqual(split(req)[0], "/data-stores/ds_1/import")
        self.assertEqual(req.get_header("Content-type"), "text/csv")
        self.assertEqual(req.data, "id,name\n1,ä\n".encode("utf-8"))

    def test_import_bytes_verbatim(self) -> None:
        t = answering({"imported": 1})
        client(t).data_stores.import_csv("ds_1", b"a\n\xff\n")
        self.assertEqual(t.calls[0].data, b"a\n\xff\n")
        self.assertEqual(t.calls[0].get_header("Content-type"), "text/csv")

    def test_export_returns_text_verbatim(self) -> None:
        t = Recorder(lambda _r: FakeResponse(200, "id,name\n1,ä\n".encode("utf-8")))
        out = client(t).data_stores.export_csv("ds_1")
        self.assertEqual(out, "id,name\n1,ä\n")
        self.assertEqual(split(t.calls[0])[0], "/data-stores/ds_1/export")

    def test_export_json_looking_body_stays_a_string(self) -> None:
        t = Recorder(lambda _r: FakeResponse(200, b'{"a":1}'))
        self.assertEqual(client(t).data_stores.export_csv("ds_1"), '{"a":1}')

    def test_export_non_2xx_is_the_unchanged_api_error(self) -> None:
        body = b'{"error":{"code":"data_store_not_found","message":"m"}}'
        t = Recorder(lambda _r: FakeResponse(404, body))
        with self.assertRaises(ApiError) as ctx:
            client(t).data_stores.export_csv("ds_1")
        self.assertEqual((ctx.exception.status, ctx.exception.code), (404, "data_store_not_found"))


class EntriesTest(unittest.TestCase):
    def test_key_is_percent_encoded(self) -> None:
        t = answering({"key": "a/b:c"})
        client(t).data_stores.entries.get("ds_1", "a/b:c")
        self.assertEqual(
            t.calls[0].full_url, "https://api.example.com/data-stores/ds_1/entries/a%2Fb%3Ac"
        )

    def test_list(self) -> None:
        t = answering({"items": []})
        client(t).data_stores.entries.list("ds_1", prefix="p", cursor="c", limit=2)
        path, query = split(t.calls[0])
        self.assertEqual(path, "/data-stores/ds_1/entries")
        self.assertEqual(query, [("prefix", "p"), ("cursor", "c"), ("limit", "2")])

    def test_set_puts_version_and_ttl_in_body_beside_value(self) -> None:
        t = answering({"key": "k"})
        client(t).data_stores.entries.set("ds_1", "k", {"n": 1}, if_version=3, ttl_seconds=60)
        req = t.calls[0]
        self.assertEqual(req.get_method(), "PUT")
        self.assertEqual(split(req)[1], [])
        self.assertEqual(body_of(req), {"value": {"n": 1}, "ifVersion": 3, "ttlSeconds": 60})

    def test_set_none_value_sends_explicit_null(self) -> None:
        t = answering({"key": "k"})
        client(t).data_stores.entries.set("ds_1", "k", None)
        self.assertEqual(body_of(t.calls[0]), {"value": None})

    def test_set_unset_options_absent(self) -> None:
        t = answering({"key": "k"})
        client(t).data_stores.entries.set("ds_1", "k", None)
        self.assertEqual(body_of(t.calls[0]), {})

    def test_insert(self) -> None:
        t = answering({"key": "k"}, 201)
        client(t).data_stores.entries.insert("ds_1", {"a": 1}, ttl_seconds=5)
        self.assertEqual(t.calls[0].get_method(), "POST")
        self.assertEqual(body_of(t.calls[0]), {"value": {"a": 1}, "ttlSeconds": 5})

    def test_increment_without_by_sends_no_body(self) -> None:
        t = answering({"key": "k"})
        client(t).data_stores.entries.increment("ds_1", "k")
        self.assertIsNone(t.calls[0].data)
        self.assertEqual(split(t.calls[0])[0], "/data-stores/ds_1/entries/k/increment")
        client(t).data_stores.entries.increment("ds_1", "k", by=2)
        self.assertEqual(body_of(t.calls[1]), {"by": 2})

    def test_delete(self) -> None:
        t = Recorder(lambda _r: FakeResponse(204))
        self.assertIsNone(client(t).data_stores.entries.delete("ds_1", "k"))
        self.assertEqual(t.calls[0].get_method(), "DELETE")

    def test_query_where_is_bracketed_one_pair_per_column(self) -> None:
        t = answering({"items": []})
        client(t).data_stores.entries.query(
            "ds_1", where={"color": "red", "n": 2}, order="n", limit=3
        )
        self.assertEqual(
            split(t.calls[0])[1],
            [("where[color]", "red"), ("where[n]", "2"), ("order", "n"), ("limit", "3")],
        )


class ErrorEnvelopeTest(unittest.TestCase):
    def _raise(self, envelope: Any) -> ApiError:
        data = json.dumps(envelope).encode("utf-8")

        def respond(_r: Request) -> Any:
            raise HTTPError("https://api.example.com/x", 400, "", Message(), io.BytesIO(data))

        with self.assertRaises(ApiError) as ctx:
            client(Recorder(respond)).data_stores.entries.set("ds_1", "k", 1)
        return ctx.exception

    def test_invalid_value_with_field_and_column(self) -> None:
        env = {"error": {"code": "invalid_value", "message": "m", "field": "value", "column": "note"}}
        err = self._raise(env)
        self.assertEqual((err.status, err.code), (400, "invalid_value"))
        self.assertEqual(err.raw["error"]["field"], "value")
        self.assertEqual(err.raw["error"]["column"], "note")

    def test_invalid_key(self) -> None:
        err = self._raise({"error": {"code": "invalid_key", "message": "m", "field": "key"}})
        self.assertEqual((err.status, err.code), (400, "invalid_key"))
        self.assertEqual(err.raw["error"]["field"], "key")

    def test_invalid_cursor(self) -> None:
        err = self._raise({"error": {"code": "invalid_cursor", "message": "m"}})
        self.assertEqual((err.status, err.code), (400, "invalid_cursor"))

    def test_unknown_project(self) -> None:
        err = self._raise({"error": {"code": "unknown_project", "message": "m"}})
        self.assertEqual((err.status, err.code), (400, "unknown_project"))


if __name__ == "__main__":
    unittest.main()
