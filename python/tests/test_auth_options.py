"""The three client-wide options this task adds: a per-request (sync) token
supplier, opt-in one-shot 401 recovery with an `on_unauthorized` callback, and
client-wide default `headers`.

Exercised against the real :func:`_request` transport (and, for the headers
acceptance case, a real typed call) rather than a mock of either — the same
injected-transport seam `tests/test_http.py` uses, so no new test
infrastructure is needed (`docs/implementation.md` §9).
"""

from __future__ import annotations

import json
import unittest
from typing import Any, Callable, List, Optional
from urllib.request import Request

from w6w import ApiError, Client, ConfigError
from w6w._config import ENV_TOKEN, require_token, resolve_config
from w6w._http import _request


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


def sequence(*responses: Any) -> Recorder:
    """A transport that answers successive calls with successive outcomes."""
    remaining = list(responses)

    def _respond(_request: Request) -> Any:
        status, body = remaining.pop(0)
        return FakeResponse(status, json.dumps(body))

    return Recorder(_respond)


def unauthorized_body(message: str = "Token expired.") -> Any:
    """A `401` body carrying the exact code the server's `unauthorized()` sends."""
    return {"error": {"code": "unauthorized", "message": message}}


# ---------------------------------------------------------------------------
# acc.1 — the supplier is called fresh on every request, validated
# ---------------------------------------------------------------------------


class SupplierResolutionTest(unittest.TestCase):
    def test_a_callable_token_is_called_fresh_on_every_request_two_different_bearers(self) -> None:
        state = {"n": 0}

        def token(**_kwargs: object) -> str:
            state["n"] += 1
            return "tok_{0}".format(state["n"])

        config = resolve_config(base_url="https://api.example.com", token=token)
        transport = responding({"ok": True})

        _request(config, transport, "GET", "/vars")
        _request(config, transport, "GET", "/vars")

        self.assertEqual(len(transport.calls), 2)
        self.assertEqual(transport.calls[0].get_header("Authorization"), "Bearer tok_1")
        self.assertEqual(transport.calls[1].get_header("Authorization"), "Bearer tok_2")

    def test_a_nullish_provider_result_raises_the_same_configerror_with_zero_transport_calls(
        self,
    ) -> None:
        config = resolve_config(base_url="https://api.example.com", token=lambda **_k: None)
        transport = responding({"ok": True})

        with self.assertRaises(ConfigError) as caught:
            _request(config, transport, "GET", "/vars")

        self.assertIn(ENV_TOKEN, str(caught.exception))
        self.assertEqual(transport.calls, [])

    def test_a_blank_provider_result_is_treated_exactly_like_a_nullish_one(self) -> None:
        config = resolve_config(base_url="https://api.example.com", token=lambda **_k: "   ")
        transport = responding({"ok": True})

        with self.assertRaises(ConfigError):
            _request(config, transport, "GET", "/vars")

        self.assertEqual(transport.calls, [])

    def test_a_plain_string_token_behaves_exactly_as_before(self) -> None:
        config = resolve_config(base_url="https://api.example.com", token="tok_static")
        transport = responding({"ok": True})

        _request(config, transport, "GET", "/vars")
        _request(config, transport, "GET", "/vars")

        self.assertEqual(transport.calls[0].get_header("Authorization"), "Bearer tok_static")
        self.assertEqual(transport.calls[1].get_header("Authorization"), "Bearer tok_static")


# ---------------------------------------------------------------------------
# acc.2 — never echo a token value, including on the recovery-failure path
# ---------------------------------------------------------------------------


class NoTokenLeakTest(unittest.TestCase):
    def test_a_failed_recovery_attempt_never_echoes_the_original_token(self) -> None:
        def token(**kwargs: object) -> Optional[str]:
            return None if kwargs.get("force_refresh") else "tok_SECRET_do_not_leak"

        config = resolve_config(
            base_url="https://api.example.com",
            token=token,
            refresh_on_unauthorized=True,
        )
        transport = responding(unauthorized_body(), status=401)

        with self.assertRaises(ApiError) as caught:
            _request(config, transport, "GET", "/vars")

        self.assertEqual(caught.exception.status, 401)
        # The refresh was attempted and yielded nothing usable, so there is no
        # retry — exactly the original call.
        self.assertEqual(len(transport.calls), 1)
        self.assertNotIn("tok_SECRET_do_not_leak", str(caught.exception))


# ---------------------------------------------------------------------------
# acc.3 — opt-in one-shot 401 recovery
# ---------------------------------------------------------------------------


class RecoveryTest(unittest.TestCase):
    def test_refresh_on_unauthorized_defaults_to_false_one_call_401_thrown_unchanged(self) -> None:
        calls = {"n": 0}

        def token(**_kwargs: object) -> str:
            calls["n"] += 1
            return "tok_1"

        config = resolve_config(base_url="https://api.example.com", token=token)
        transport = responding(unauthorized_body(), status=401)

        with self.assertRaises(ApiError) as caught:
            _request(config, transport, "GET", "/vars")

        self.assertEqual(caught.exception.status, 401)
        self.assertEqual(len(transport.calls), 1)
        self.assertEqual(calls["n"], 1)

    def test_recovery_on_exactly_one_refresh_and_one_retry_same_method_path_query(self) -> None:
        seen = []
        state = {"n": 0}

        def token(**kwargs: object) -> str:
            seen.append(kwargs.get("force_refresh"))
            state["n"] += 1
            return "tok_old" if state["n"] == 1 else "tok_new"

        config = resolve_config(
            base_url="https://api.example.com",
            token=token,
            refresh_on_unauthorized=True,
        )
        transport = sequence((401, unauthorized_body()), (200, {"ok": True}))

        response = _request(config, transport, "GET", "/vars", query={"project": "prj_1"})

        self.assertEqual(response.body, {"ok": True})
        self.assertEqual(len(transport.calls), 2)
        self.assertEqual(transport.calls[0].full_url, "https://api.example.com/vars?project=prj_1")
        self.assertEqual(transport.calls[1].full_url, "https://api.example.com/vars?project=prj_1")
        self.assertEqual(transport.calls[0].get_header("Authorization"), "Bearer tok_old")
        self.assertEqual(transport.calls[1].get_header("Authorization"), "Bearer tok_new")
        # Ordinary resolution passes no force_refresh kwarg value (None, since
        # the provider was never asked for it); the retry passes True exactly
        # once.
        self.assertEqual(seen, [None, True])

    def test_the_retry_re_sends_the_identical_method_path_body_post_case(self) -> None:
        state = {"n": 0}

        def token(**_kwargs: object) -> str:
            state["n"] += 1
            return "tok_old" if state["n"] == 1 else "tok_new"

        config = resolve_config(
            base_url="https://api.example.com",
            token=token,
            refresh_on_unauthorized=True,
        )
        transport = sequence((401, unauthorized_body()), (202, {"ok": True}))

        response = _request(
            config,
            transport,
            "POST",
            "/workflows/wf_1/run",
            body={"variables": {"a": 1}},
        )

        self.assertEqual(response.status, 202)
        self.assertEqual(len(transport.calls), 2)
        for call in transport.calls:
            self.assertEqual(call.get_method(), "POST")
            self.assertEqual(call.full_url, "https://api.example.com/workflows/wf_1/run")
            self.assertEqual(call.data, b'{"variables": {"a": 1}}')
        self.assertEqual(transport.calls[1].get_header("Authorization"), "Bearer tok_new")

    def test_a_401_with_any_code_other_than_unauthorized_never_triggers_recovery(self) -> None:
        calls = {"n": 0}

        def token(**_kwargs: object) -> str:
            calls["n"] += 1
            return "tok_{0}".format(calls["n"])

        config = resolve_config(
            base_url="https://api.example.com",
            token=token,
            refresh_on_unauthorized=True,
        )
        transport = responding({"error": {"code": "forbidden", "message": "nope"}}, status=401)

        with self.assertRaises(ApiError) as caught:
            _request(config, transport, "GET", "/vars")

        self.assertEqual(caught.exception.code, "forbidden")
        self.assertEqual(len(transport.calls), 1)
        self.assertEqual(calls["n"], 1)

    def test_two_consecutive_401s_exactly_2_calls_on_unauthorized_fires_once_then_raises(
        self,
    ) -> None:
        state = {"n": 0}
        on_unauthorized_calls = {"n": 0}
        seen_errors: List[ApiError] = []

        def token(**_kwargs: object) -> str:
            state["n"] += 1
            return "tok_{0}".format(state["n"])

        def on_unauthorized(err: ApiError) -> None:
            on_unauthorized_calls["n"] += 1
            seen_errors.append(err)

        config = resolve_config(
            base_url="https://api.example.com",
            token=token,
            refresh_on_unauthorized=True,
            on_unauthorized=on_unauthorized,
        )
        transport = responding(unauthorized_body(), status=401)

        with self.assertRaises(ApiError) as caught:
            _request(config, transport, "GET", "/vars")

        self.assertEqual(len(transport.calls), 2)
        self.assertEqual(on_unauthorized_calls["n"], 1)
        self.assertIs(seen_errors[0], caught.exception)
        self.assertEqual(caught.exception.status, 401)
        self.assertEqual(caught.exception.code, "unauthorized")
        self.assertNotIn("tok_2", str(caught.exception))

    def test_a_static_string_token_cannot_be_retried_through_even_with_recovery_on(self) -> None:
        config = resolve_config(
            base_url="https://api.example.com",
            token="tok_static",
            refresh_on_unauthorized=True,
        )
        transport = responding(unauthorized_body(), status=401)

        with self.assertRaises(ApiError):
            _request(config, transport, "GET", "/vars")

        self.assertEqual(len(transport.calls), 1)

    def test_a_successful_retry_never_calls_on_unauthorized(self) -> None:
        state = {"n": 0}
        on_unauthorized_calls = {"n": 0}

        def token(**_kwargs: object) -> str:
            state["n"] += 1
            return "tok_old" if state["n"] == 1 else "tok_new"

        config = resolve_config(
            base_url="https://api.example.com",
            token=token,
            refresh_on_unauthorized=True,
            on_unauthorized=lambda _err: on_unauthorized_calls.__setitem__(
                "n", on_unauthorized_calls["n"] + 1
            ),
        )
        transport = sequence((401, unauthorized_body()), (200, {"ok": True}))

        _request(config, transport, "GET", "/vars")

        self.assertEqual(on_unauthorized_calls["n"], 0)


# ---------------------------------------------------------------------------
# acc.4 — client-wide default headers
# ---------------------------------------------------------------------------


class ClientHeadersTest(unittest.TestCase):
    def test_client_wide_default_headers_reach_a_typed_call_workflows_list(self) -> None:
        transport = responding({"workflows": []})
        client = Client(
            base_url="https://api.example.com",
            token="tok_1",
            headers={"x-tenant": "t_42"},
            transport=transport,
        )

        client.workflows.list()

        self.assertEqual(transport.calls[0].get_header("X-tenant"), "t_42")

    def test_a_per_request_header_overrides_a_same_named_client_default(self) -> None:
        config = resolve_config(
            base_url="https://api.example.com",
            token="tok_1",
            headers={"x-tenant": "default"},
        )
        transport = responding({"ok": True})

        _request(config, transport, "GET", "/vars", headers={"x-tenant": "override"})

        self.assertEqual(transport.calls[0].get_header("X-tenant"), "override")

    def test_a_client_default_authorization_never_reaches_the_wire_in_place_of_the_bearer(
        self,
    ) -> None:
        config = resolve_config(
            base_url="https://api.example.com",
            token="tok_real",
            headers={"Authorization": "Bearer evil-default"},
        )
        transport = responding({"ok": True})

        _request(config, transport, "GET", "/vars")

        self.assertEqual(transport.calls[0].get_header("Authorization"), "Bearer tok_real")


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
