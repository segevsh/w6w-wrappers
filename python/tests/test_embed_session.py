"""`w6w.server.EmbedSessionClient` (T2.1.1): construction validation, the
`create()` refusals, the exact wire shape, the curated result, error/secret
hygiene and the not-on-the-barrel boundary.

Mirrors `tests/test_server.py` and `node/tests/embed_session_test.ts`, minus
the browser guard (R-8 is node-only).
"""

from __future__ import annotations

import base64
import json
import os
import unittest
from typing import Any, Callable, List, Optional
from unittest import mock
from urllib.request import Request

import w6w
import w6w.server
from w6w.errors import ApiError, ConfigError
from w6w.server import EmbedSessionClient

SECRET = "s3cr3t-DO-NOT-LEAK"
ACCT = "acct_X1y2Z3a4B5c6D7e8"
BASE = "https://api.example.com"

SUCCESS_BODY = {
    "token": "tok_short_lived",
    "user": {"subject": "u1", "tenant": "tn_1", "role": "user", "account": ACCT},
    "expiresIn": 900,
}

SEVEN_KEYS = ["account", "accountRef", "expiresAt", "expiresIn", "subject", "tenant", "token"]


class FakeResponse:
    def __init__(self, status: int, body: str = "", reason: str = "") -> None:
        self.status = status
        self.reason = reason
        self._body = body.encode("utf-8")

    def read(self) -> bytes:
        return self._body


class Recorder:
    def __init__(self, respond: Callable[[Request], Any]) -> None:
        self.calls: List[Request] = []
        self._respond = respond

    def __call__(self, request: Request) -> Any:
        self.calls.append(request)
        return self._respond(request)


def responding(body: Any, status: int = 200) -> Recorder:
    text = json.dumps(body)
    return Recorder(lambda _request: FakeResponse(status, text))


def basic(client_id: str, client_secret: str) -> str:
    raw = "{0}:{1}".format(client_id, client_secret).encode("latin-1")
    return "Basic " + base64.b64encode(raw).decode("ascii")


def make(transport: Recorder, **over: Any) -> EmbedSessionClient:
    args = dict(base_url=BASE, client_id="client_1", client_secret=SECRET)
    args.update(over)
    return EmbedSessionClient(transport=transport, **args)


class SecretHygiene(unittest.TestCase):
    def assertNoSecret(self, err: BaseException) -> None:
        self.assertNotIn(SECRET, str(err))
        self.assertNotIn(SECRET, repr(err))
        self.assertNotIn(SECRET, getattr(err, "message", ""))
        self.assertNotIn(SECRET, repr(getattr(err, "raw", None)))


class ConstructionTest(SecretHygiene):
    def test_bad_inputs_raise_config_error_with_zero_requests(self) -> None:
        cases = {
            "blank base_url": dict(base_url="   "),
            "relative base_url": dict(base_url="/api"),
            "non-string base_url": dict(base_url=123),
            "blank client_id": dict(client_id=" "),
            "missing client_id": dict(client_id=None),
            "blank client_secret": dict(client_secret=""),
            "missing client_secret": dict(client_secret=None),
            "client_id with colon": dict(client_id="a:b"),
            "non-latin-1 client_id": dict(client_id="cli€nt"),
            "non-latin-1 client_secret": dict(client_secret=SECRET + "€"),
        }
        for name, over in cases.items():
            with self.subTest(name):
                transport = responding(SUCCESS_BODY)
                with self.assertRaises(ConfigError) as ctx:
                    make(transport, **over)
                self.assertNoSecret(ctx.exception)
                self.assertEqual(len(transport.calls), 0)

    def test_omitted_base_url_is_the_default_and_ignores_the_environment(self) -> None:
        transport = responding(SUCCESS_BODY)
        with mock.patch.dict(os.environ, {"W6W_BASE_URL": "https://env.example.com"}):
            client = EmbedSessionClient(
                client_id="client_1", client_secret=SECRET, transport=transport
            )
            client.create(subject="user_1", account_ref="acct_1")
        self.assertEqual(transport.calls[0].full_url, "https://api.w6w.io/auth/exchange")

    def test_positional_order_is_base_url_client_id_client_secret(self) -> None:
        transport = responding(SUCCESS_BODY)
        client = EmbedSessionClient(BASE, "client_1", SECRET, transport=transport)
        client.create(subject="user_1", account_ref="acct_1")
        call = transport.calls[0]
        self.assertEqual(call.full_url, BASE + "/auth/exchange")
        self.assertEqual(call.get_header("Authorization"), basic("client_1", SECRET))

    def test_explicit_base_url_still_wins(self) -> None:
        transport = responding(SUCCESS_BODY)
        make(transport).create(subject="user_1", account_ref="acct_1")
        self.assertEqual(transport.calls[0].full_url, BASE + "/auth/exchange")

    def test_repr_does_not_contain_the_secret(self) -> None:
        self.assertNotIn(SECRET, repr(make(responding(SUCCESS_BODY))))


class CreateRefusalTest(SecretHygiene):
    def test_bad_account_ref_or_subject_raises_config_error_with_zero_requests(self) -> None:
        cases = [
            ("account_ref=None", "u1", None),
            ("account_ref=''", "u1", ""),
            ("account_ref='   '", "u1", "   "),
            ("account_ref=7", "u1", 7),
            ("account_ref={}", "u1", {}),
            ("account_ref=BOM", "u1", "\ufeff"),
            ("account_ref=sp+BOM+sp", "u1", " \ufeff "),
            ("account_ref=U+2028/U+3000/NBSP", "u1", "\u2028\u3000\u00a0"),
            ("subject=BOM", "\ufeff", "co-9"),
            ("subject=''", "", "co-9"),
            ("subject='  '", "  ", "co-9"),
            ("subject=None", None, "co-9"),
            ("subject=5", 5, "co-9"),
        ]
        for name, subject, ref in cases:
            with self.subTest(name):
                transport = responding(SUCCESS_BODY)
                client = make(transport)
                with self.assertRaises(ConfigError) as ctx:
                    client.create(subject, ref)  # type: ignore[arg-type]
                self.assertNoSecret(ctx.exception)
                self.assertEqual(len(transport.calls), 0)


class WireAndShapeTest(unittest.TestCase):
    def test_one_post_with_basic_header_exact_body_and_curated_seven_keys(self) -> None:
        transport = responding(SUCCESS_BODY)
        client = make(transport, now=lambda: 1_700_000_000.0)

        session = client.create("u1", "  co-9  ")

        self.assertEqual(len(transport.calls), 1)
        call = transport.calls[0]
        self.assertEqual(call.get_method(), "POST")
        self.assertEqual(call.full_url, BASE + "/auth/exchange")
        self.assertEqual(call.get_header("Authorization"), basic("client_1", SECRET))
        self.assertEqual(json.loads(call.data), {"subject": "u1", "account": "co-9"})

        self.assertEqual(sorted(session.keys()), SEVEN_KEYS)
        self.assertEqual(
            session,
            {
                "token": "tok_short_lived",
                "expiresIn": 900,
                "expiresAt": "2023-11-14T22:28:20.000Z",
                "subject": "u1",
                "tenant": "tn_1",
                "account": ACCT,
                "accountRef": "co-9",
            },
        )
        self.assertNotIn(SECRET, json.dumps(session))

    def test_subject_is_sent_verbatim_never_trimmed(self) -> None:
        transport = responding(SUCCESS_BODY)
        make(transport).create(" u1 ", "co-9")
        self.assertEqual(
            json.loads(transport.calls[0].data), {"subject": " u1 ", "account": "co-9"}
        )

    def test_account_ref_trim_uses_the_ecmascript_set_not_str_strip(self) -> None:
        # BOM is stripped (JS trim strips it; str.strip() would not)
        transport = responding(SUCCESS_BODY)
        session = make(transport).create("u1", " \ufeffco-9\ufeff ")
        self.assertEqual(json.loads(transport.calls[0].data)["account"], "co-9")
        self.assertEqual(session["accountRef"], "co-9")
        # U+0085 / U+001C-U+001F are NOT JS whitespace: sent verbatim, not stripped
        for ch in ["\u0085", "\x1c", "\x1d", "\x1e", "\x1f"]:
            with self.subTest(hex(ord(ch))):
                transport = responding(SUCCESS_BODY)
                ref = ch + "co-9" + ch
                make(transport).create("u1", ref)
                self.assertEqual(json.loads(transport.calls[0].data)["account"], ref)

    def test_js_ws_is_exactly_the_ecmascript_trim_set(self) -> None:
        expected = {0x9, 0xA, 0xB, 0xC, 0xD, 0x20, 0xA0, 0x1680, 0x2028, 0x2029, 0x202F,
                    0x205F, 0x3000, 0xFEFF, *range(0x2000, 0x200B)}
        self.assertEqual({ord(c) for c in w6w.server.JS_WS}, expected)
        self.assertEqual(len(w6w.server.JS_WS), len(expected))

    def test_clock_is_sampled_before_the_request(self) -> None:
        clock = [1_700_000_000.0]

        def respond(_request: Request) -> Any:
            clock[0] += 60.0  # the exchange "takes" a minute; expiresAt must not include it
            return FakeResponse(200, json.dumps(SUCCESS_BODY))

        client = make(Recorder(respond), now=lambda: clock[0])
        self.assertEqual(client.create("u1", "co-9")["expiresAt"], "2023-11-14T22:28:20.000Z")

    def test_expires_at_has_millisecond_precision_and_z_suffix(self) -> None:
        client = make(responding(SUCCESS_BODY), now=lambda: 1_700_000_000.123)
        self.assertEqual(client.create("u1", "co-9")["expiresAt"], "2023-11-14T22:28:20.123Z")

    def test_default_clock_is_wall_time(self) -> None:
        import time

        before = time.time()
        session = make(responding(SUCCESS_BODY)).create("u1", "co-9")
        from datetime import datetime, timezone

        at = datetime.strptime(session["expiresAt"], "%Y-%m-%dT%H:%M:%S.%fZ").replace(
            tzinfo=timezone.utc
        )
        self.assertGreaterEqual(at.timestamp(), before + 900 - 0.001)
        self.assertLessEqual(at.timestamp(), time.time() + 900 + 0.001)

    def test_malformed_exchange_response_is_an_api_error_bad_response(self) -> None:
        bad = {
            "no user": {"token": "t", "expiresIn": 900},
            "string expiresIn": dict(SUCCESS_BODY, expiresIn="900"),
            "absurd expiresIn": dict(SUCCESS_BODY, expiresIn=1e300),
            "no token": {k: v for k, v in SUCCESS_BODY.items() if k != "token"},
        }
        for name, body in bad.items():
            with self.subTest(name):
                with self.assertRaises(ApiError) as ctx:
                    make(responding(body)).create("u1", "co-9")
                self.assertEqual(ctx.exception.code, "bad_response")
                self.assertNotIn(SECRET, str(ctx.exception))


class ErrorsTest(SecretHygiene):
    def test_server_errors_surface_as_api_error_with_status_and_code(self) -> None:
        for status, code in [
            (401, "invalid_client"),
            (401, "tenant_disabled"),
            (400, "invalid_account"),
            (429, "rate_limited"),
        ]:
            with self.subTest(code):
                transport = responding({"error": {"code": code, "message": "server says " + code}}, status)
                with self.assertRaises(ApiError) as ctx:
                    make(transport).create("u1", "co-9")
                self.assertEqual(ctx.exception.status, status)
                self.assertEqual(ctx.exception.code, code)
                self.assertNoSecret(ctx.exception)
                self.assertEqual(len(transport.calls), 1)

    def test_two_instances_interleaved_each_send_their_own_header(self) -> None:
        transport = responding(SUCCESS_BODY)
        a = make(transport, client_id="client_a", client_secret="secret_a")
        b = make(transport, client_id="client_b", client_secret="secret_b")

        a.create("u1", "co-1")
        b.create("u1", "co-2")
        a.create("u2", "co-1")

        self.assertEqual(
            [c.get_header("Authorization") for c in transport.calls],
            [
                basic("client_a", "secret_a"),
                basic("client_b", "secret_b"),
                basic("client_a", "secret_a"),
            ],
        )


class DefaultTransportTest(unittest.TestCase):
    """With no `transport=`, the exchange goes through `no_redirect_transport`."""

    def test_exchange_token_defaults_to_no_redirect_transport(self) -> None:
        fake = responding(SUCCESS_BODY)
        with mock.patch.object(w6w.server, "no_redirect_transport", fake):
            w6w.server.exchange_token(BASE, "client_1", SECRET, "u1")
        self.assertEqual(len(fake.calls), 1)

    def test_embed_session_client_defaults_to_no_redirect_transport(self) -> None:
        fake = responding(SUCCESS_BODY)
        client = EmbedSessionClient(base_url=BASE, client_id="client_1", client_secret=SECRET)
        with mock.patch.object(w6w.server, "no_redirect_transport", fake):
            client.create("u1", "co-9")
        self.assertEqual(len(fake.calls), 1)

    def test_an_injected_transport_is_used_instead(self) -> None:
        fake, injected = responding(SUCCESS_BODY), responding(SUCCESS_BODY)
        with mock.patch.object(w6w.server, "no_redirect_transport", fake):
            make(injected).create("u1", "co-9")
        self.assertEqual((len(fake.calls), len(injected.calls)), (0, 1))


class BarrelTest(unittest.TestCase):
    def test_not_an_attribute_of_the_package_root(self) -> None:
        self.assertFalse(hasattr(w6w, "EmbedSessionClient"))

    def test_not_in_all(self) -> None:
        self.assertNotIn("EmbedSessionClient", w6w.__all__)

    def test_is_a_class_in_w6w_server(self) -> None:
        self.assertTrue(isinstance(w6w.server.EmbedSessionClient, type))


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
