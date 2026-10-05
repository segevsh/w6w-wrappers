"""`w6w.server.exchange_token` (T1.1.2): the Basic-only credential rule
(P-5), the exact body shape, the server error mapping, and the
not-on-the-barrel boundary (R-5).

Exercised against the real :func:`_request` transport through a fake
`urllib` transport, exactly like `tests/test_auth_options.py` — no live
server, no new test infrastructure.
"""

from __future__ import annotations

import json
import unittest
from typing import Any, Callable, List
from urllib.request import Request

import w6w
from w6w.errors import ApiError, ConfigError
from w6w.server import exchange_token


class FakeResponse:
    """The minimum a transport must return: a status, a reason and a body."""

    def __init__(self, status: int, body: str = "", reason: str = "") -> None:
        self.status = status
        self.reason = reason
        self._body = body.encode("utf-8")

    def read(self) -> bytes:
        return self._body


class Recorder:
    """A transport-shaped fake that records every request it is handed."""

    def __init__(self, respond: Callable[[Request], Any]) -> None:
        self.calls: List[Request] = []
        self._respond = respond

    def __call__(self, request: Request) -> Any:
        self.calls.append(request)
        return self._respond(request)


def responding(body: Any, status: int = 200) -> Recorder:
    text = json.dumps(body)
    return Recorder(lambda _request: FakeResponse(status, text))


SUCCESS_BODY = {
    "token": "tok_short_lived",
    "user": {"subject": "user_1", "tenant": "tn_1", "role": "user", "account": "tn_1"},
    "expiresIn": 900,
}


# ---------------------------------------------------------------------------
# acc.1 — the wire shape: Basic header, exact body, no query string
# ---------------------------------------------------------------------------


class WireShapeTest(unittest.TestCase):
    def test_posts_auth_exchange_with_basic_header_and_exact_subject_only_body(self) -> None:
        transport = responding(SUCCESS_BODY)

        result = exchange_token(
            base_url="https://api.example.com",
            client_id="client_1",
            client_secret="secret_1",
            subject="user_1",
            transport=transport,
        )

        self.assertEqual(len(transport.calls), 1)
        call = transport.calls[0]
        self.assertEqual(call.get_method(), "POST")
        # No query string anywhere — a bare path, nothing appended.
        self.assertEqual(call.full_url, "https://api.example.com/auth/exchange")
        # base64("client_1:secret_1"), computed independently
        # (python3 base64.b64encode(b"client_1:secret_1")).
        self.assertEqual(call.get_header("Authorization"), "Basic Y2xpZW50XzE6c2VjcmV0XzE=")
        self.assertEqual(call.data, b'{"subject": "user_1"}')

        self.assertEqual(result["token"], "tok_short_lived")
        self.assertEqual(result["user"]["subject"], "user_1")
        self.assertEqual(result["user"]["tenant"], "tn_1")
        self.assertEqual(result["user"]["role"], "user")
        self.assertEqual(result["user"]["account"], "tn_1")
        self.assertEqual(result["expiresIn"], 900)

    def test_account_when_given_is_the_only_extra_body_key_never_null_when_omitted(self) -> None:
        transport = responding(SUCCESS_BODY)

        exchange_token(
            base_url="https://api.example.com",
            client_id="client_1",
            client_secret="secret_1",
            subject="user_1",
            account="acct_9",
            transport=transport,
        )

        self.assertEqual(
            transport.calls[0].data,
            b'{"subject": "user_1", "account": "acct_9"}',
        )


# ---------------------------------------------------------------------------
# acc.2, acc.4 — latin-1-only Basic encoding; never UTF-8
# ---------------------------------------------------------------------------


class Latin1EncodingTest(unittest.TestCase):
    def test_a_latin1_non_ascii_secret_is_basic_encoded_as_latin1_never_utf8(self) -> None:
        transport = responding(SUCCESS_BODY)

        exchange_token(
            base_url="https://api.example.com",
            client_id="client_1",
            client_secret="pass_é",  # "pass_é" — U+00E9, inside latin-1
            subject="user_1",
            transport=transport,
        )

        # base64(latin1("client_1:pass_é")), computed independently
        # (python3 base64.b64encode("client_1:pass_é".encode("latin-1"))).
        # The UTF-8 encoding of the same string base64s to a DIFFERENT value
        # ("Y2xpZW50XzE6cGFzc1/DqQ=="), so this line is what a UTF-8
        # regression turns red.
        self.assertEqual(
            transport.calls[0].get_header("Authorization"),
            "Basic Y2xpZW50XzE6cGFzc1/p",
        )

    def test_a_client_secret_outside_latin1_raises_configerror_never_reaching_the_network(
        self,
    ) -> None:
        transport = responding(SUCCESS_BODY)

        with self.assertRaises(ConfigError) as ctx:
            exchange_token(
                base_url="https://api.example.com",
                client_id="client_1",
                client_secret="s3cr3t_DO_NOT_LEAK_中",  # U+4E2D is outside latin-1
                subject="user_1",
                transport=transport,
            )
        self.assertEqual(len(transport.calls), 0)
        self.assertNotIn("DO_NOT_LEAK", str(ctx.exception))


# ---------------------------------------------------------------------------
# acc.2 — client_id/":" rejection, never echoing client_secret
# ---------------------------------------------------------------------------


class ClientIdColonTest(unittest.TestCase):
    def test_a_client_id_containing_colon_raises_configerror_before_any_network_call(
        self,
    ) -> None:
        transport = responding(SUCCESS_BODY)

        with self.assertRaises(ConfigError) as ctx:
            exchange_token(
                base_url="https://api.example.com",
                client_id="tenant:with:colons",
                client_secret="s3cr3t_DO_NOT_LEAK",
                subject="user_1",
                transport=transport,
            )
        self.assertEqual(len(transport.calls), 0)
        self.assertNotIn("DO_NOT_LEAK", str(ctx.exception))


# ---------------------------------------------------------------------------
# acc.2 — blank client_id/client_secret/subject
# ---------------------------------------------------------------------------


class BlankFieldsTest(unittest.TestCase):
    def test_blank_client_id_client_secret_subject_each_raise_configerror(self) -> None:
        transport = responding(SUCCESS_BODY)
        base = {
            "base_url": "https://api.example.com",
            "client_id": "client_1",
            "client_secret": "secret_1",
            "subject": "user_1",
            "transport": transport,
        }

        with self.assertRaises(ConfigError):
            exchange_token(**{**base, "client_id": "   "})
        with self.assertRaises(ConfigError):
            exchange_token(**{**base, "client_secret": ""})
        with self.assertRaises(ConfigError):
            exchange_token(**{**base, "subject": "  "})
        self.assertEqual(len(transport.calls), 0)


# ---------------------------------------------------------------------------
# acc.3 — every server error surfaces as ApiError with the server's code;
# exactly ONE transport call (no recovery on a require_auth=False request)
# ---------------------------------------------------------------------------


class ServerErrorMappingTest(unittest.TestCase):
    def test_server_errors_surface_as_apierror_with_that_code_one_call_each(self) -> None:
        cases = [
            (401, "invalid_client"),
            (400, "invalid_body"),
            (400, "invalid_subject"),
            (400, "invalid_account"),
        ]
        for status, code in cases:
            with self.subTest(status=status, code=code):
                transport = responding({"error": {"code": code, "message": "nope"}}, status=status)

                with self.assertRaises(ApiError) as ctx:
                    exchange_token(
                        base_url="https://api.example.com",
                        client_id="client_1",
                        client_secret="secret_1",
                        subject="user_1",
                        transport=transport,
                    )
                self.assertEqual(ctx.exception.status, status)
                self.assertEqual(ctx.exception.code, code)
                # No retry, even for the 401: this call always passes
                # require_auth=False.
                self.assertEqual(len(transport.calls), 1)


# ---------------------------------------------------------------------------
# acc.3/acc.4 — require_auth=False in practice, and the seam never re-pins a
# bearer over the caller's own Authorization header
# ---------------------------------------------------------------------------


class RequireAuthFalseTest(unittest.TestCase):
    def test_exchange_token_never_requires_or_sends_a_bearer(self) -> None:
        # exchange_token builds its OWN config via resolve_config(base_url=...)
        # with no token argument and no W6W_TOKEN read at all for this path —
        # if require_auth were accidentally left at its default (True), this
        # would raise ConfigError ("No w6w API token is configured…") before
        # ever reaching the transport.
        transport = responding(SUCCESS_BODY)

        result = exchange_token(
            base_url="https://api.example.com",
            client_id="client_1",
            client_secret="secret_1",
            subject="user_1",
            transport=transport,
        )

        self.assertEqual(result["token"], "tok_short_lived")
        self.assertEqual(len(transport.calls), 1)
        # Never a bearer — only ever the Basic credential this module built.
        auth = transport.calls[0].get_header("Authorization")
        self.assertIsNotNone(auth)
        self.assertTrue(auth.startswith("Basic "))

    def test_require_auth_false_never_re_pins_a_bearer_over_a_caller_supplied_authorization(
        self,
    ) -> None:
        # A direct seam-level check of the `_http` change this task makes:
        # even with a real, callable token configured and refresh enabled,
        # `require_auth=False` must leave a caller-supplied `Authorization`
        # untouched.
        from w6w._config import resolve_config
        from w6w._http import _request

        config = resolve_config(
            base_url="https://api.example.com",
            token=lambda **_kwargs: "tok_SHOULD_NEVER_APPEAR",
            refresh_on_unauthorized=True,
        )
        transport = responding(SUCCESS_BODY)

        _request(
            config,
            transport,
            "POST",
            "/auth/exchange",
            body={"subject": "user_1"},
            headers={"Authorization": "Basic abc123=="},
            require_auth=False,
        )

        self.assertEqual(transport.calls[0].get_header("Authorization"), "Basic abc123==")


# ---------------------------------------------------------------------------
# acc.5 — not on the package root, not in __all__
# ---------------------------------------------------------------------------


class NotOnBarrelTest(unittest.TestCase):
    def test_exchange_token_is_not_an_attribute_of_the_w6w_package_root(self) -> None:
        self.assertFalse(hasattr(w6w, "exchange_token"))

    def test_exchange_token_is_not_in_w6w_all(self) -> None:
        self.assertNotIn("exchange_token", w6w.__all__)

    def test_exchange_token_is_reachable_from_its_own_module_and_is_callable(self) -> None:
        self.assertTrue(callable(exchange_token))


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
