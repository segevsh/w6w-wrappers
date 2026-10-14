"""The version lifecycle and version runs on `workflows` and `functions`.

Against an injected fake transport; no case opens a socket. Every method is
pinned by a literal wire expectation (method, URL, body) taken from
`endpoints.json`, then by its unwrap rule, then by the error it raises. The two
namespaces are walked together so they cannot drift: the one deliberate
difference is the version-run verb — `/run` for a workflow, `/invoke` for a
Function.
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


class FakeResponse:
    """The minimum a transport must return: a status, a reason and a body."""

    def __init__(self, status: int, body: str = "", reason: str = "") -> None:
        self.status = status
        self.reason = reason
        self._body = body.encode("utf-8")

    def read(self) -> bytes:
        """Read the body once, as `urllib` would."""
        return self._body


def http_error(status: int, body: Any) -> HTTPError:
    """Build the exception `urlopen` raises for a non-2xx status."""
    return HTTPError(
        BASE, status, "", email.message.Message(), io.BytesIO(json.dumps(body).encode("utf-8"))
    )


def client(*outcomes: Any) -> Tuple[Client, List[Request]]:
    """A client whose transport answers each request with the next outcome.

    An outcome is `(status, body)` or an exception to raise. The last one repeats.
    """
    calls: List[Request] = []

    def transport(request: Request) -> Any:
        outcome = outcomes[min(len(calls), len(outcomes) - 1)]
        calls.append(request)
        if isinstance(outcome, BaseException):
            raise outcome
        status, body = outcome
        return FakeResponse(status, json.dumps(body))

    return Client(base_url=BASE, token="tok_1", project="prj_default", transport=transport), calls


def sent_body(request: Request) -> Any:
    """The JSON body a recorded request carried."""
    assert request.data is not None, "expected a request body"
    return json.loads(request.data.decode("utf-8"))

RUN = {"runId": "run_1", "status": "queued"}
VERSION_LIST = {
    "enabled": True,
    "currentPublishedVersion": 2,
    "versions": [
        {"versionNumber": 2, "createdAt": "t2", "createdBy": None, "isCurrentPublished": True},
        {"versionNumber": 1, "createdAt": "t1", "createdBy": "u", "isCurrentPublished": False},
    ],
}
VERSION = {
    "versionNumber": 2,
    "createdAt": "t2",
    "createdBy": None,
    "isCurrentPublished": True,
    "definition": {"name": "x"},
}
PUBLISH = {
    "version": {
        "kind": "workflow",
        "callableId": "wf_1",
        "versionNumber": 3,
        "createdAt": "t3",
        "createdBy": None,
    },
    "currentPublishedVersion": 3,
}
REVERT = {"reverted": {"kind": "workflow", "callableId": "wf_1", "versionNumber": 1}}

#: (namespace, id, unknown-code) — the two kinds the lifecycle is shared by.
KINDS = [("workflows", "wf_1", "unknown_workflow"), ("functions", "fn_1", "unknown_function")]


class LifecycleWireTest(unittest.TestCase):
    """Method, URL and body of every lifecycle op, for both kinds."""

    def test_list_versions_returns_the_whole_body(self) -> None:
        for ns, id, _ in KINDS:
            with self.subTest(ns=ns):
                c, calls = client((200, VERSION_LIST))
                self.assertEqual(getattr(c, ns).list_versions(id), VERSION_LIST)
                self.assertEqual((calls[0].get_method(), calls[0].full_url),
                                 ("GET", f"{BASE}/{ns}/{id}/versions"))

    def test_get_version_unwraps_the_version_key(self) -> None:
        for ns, id, _ in KINDS:
            with self.subTest(ns=ns):
                c, calls = client((200, {"version": VERSION}))
                self.assertEqual(getattr(c, ns).get_version(id, 2), VERSION)
                self.assertEqual((calls[0].get_method(), calls[0].full_url),
                                 ("GET", f"{BASE}/{ns}/{id}/versions/2"))

    def test_publish_returns_the_whole_body_and_sends_no_body(self) -> None:
        for ns, id, _ in KINDS:
            with self.subTest(ns=ns):
                c, calls = client((201, PUBLISH))
                self.assertEqual(getattr(c, ns).publish(id), PUBLISH)
                self.assertEqual((calls[0].get_method(), calls[0].full_url),
                                 ("POST", f"{BASE}/{ns}/{id}/publish"))
                self.assertIsNone(calls[0].data)

    def test_revert_unwraps_the_reverted_key(self) -> None:
        for ns, id, _ in KINDS:
            with self.subTest(ns=ns):
                c, calls = client((200, REVERT))
                self.assertEqual(getattr(c, ns).revert(id, 1), REVERT["reverted"])
                self.assertEqual((calls[0].get_method(), calls[0].full_url),
                                 ("POST", f"{BASE}/{ns}/{id}/versions/1/revert"))

    def test_enable_and_disable_return_none(self) -> None:
        for ns, id, _ in KINDS:
            for op, flag in (("enable", True), ("disable", False)):
                with self.subTest(ns=ns, op=op):
                    c, calls = client((200, {"enabled": flag}))
                    self.assertIsNone(getattr(getattr(c, ns), op)(id))
                    self.assertEqual((calls[0].get_method(), calls[0].full_url),
                                     ("POST", f"{BASE}/{ns}/{id}/{op}"))

    def test_malformed_success_bodies_are_bad_response(self) -> None:
        c, _ = client((200, {"nope": 1}))
        with self.assertRaises(ApiError) as caught:
            c.workflows.get_version("wf_1", 1)
        self.assertEqual(caught.exception.code, "bad_response")
        c, _ = client((200, {"nope": 1}))
        with self.assertRaises(ApiError) as caught:
            c.functions.revert("fn_1", 1)
        self.assertEqual(caught.exception.code, "bad_response")


class ErrorTest(unittest.TestCase):
    """The server's status, code and body reach the caller intact."""

    def test_every_lifecycle_method_raises_api_error_with_the_body(self) -> None:
        body = {"error": {"code": "unknown_version", "message": "No such version."}}
        for ns, id, _ in KINDS:
            calls_by_name: List[Tuple[str, Callable[[Any], Any]]] = [
                ("list_versions", lambda api, id=id: api.list_versions(id)),
                ("get_version", lambda api, id=id: api.get_version(id, 9)),
                ("publish", lambda api, id=id: api.publish(id)),
                ("revert", lambda api, id=id: api.revert(id, 9)),
                ("enable", lambda api, id=id: api.enable(id)),
                ("disable", lambda api, id=id: api.disable(id)),
                ("run_version", lambda api, id=id: api.run_version(id, 9)),
            ]
            for name, call in calls_by_name:
                with self.subTest(ns=ns, op=name):
                    c, _ = client(http_error(404, body))
                    with self.assertRaises(ApiError) as caught:
                        call(getattr(c, ns))
                    self.assertEqual(caught.exception.status, 404)
                    self.assertEqual(caught.exception.code, "unknown_version")
                    self.assertEqual(caught.exception.raw, body)


class WorkflowRunVersionTest(unittest.TestCase):
    """`workflows.run_version` shares `run`'s body, `?wait=` rule and result."""

    def test_posts_to_the_run_route_of_that_version(self) -> None:
        c, calls = client((202, RUN))

        result = c.workflows.run_version("wf_1", 4)

        self.assertEqual(calls[0].full_url, f"{BASE}/workflows/wf_1/versions/4/run")
        self.assertEqual(calls[0].get_method(), "POST")
        self.assertEqual(sent_body(calls[0]), {})
        self.assertEqual((result.runId, result.status, result.terminal, result.httpStatus),
                         ("run_1", "queued", False, 202))

    def test_wait_is_a_query_flag_only_when_true_and_fields_are_body(self) -> None:
        c, calls = client((200, {"runId": "run_1", "status": "failed", "error": {"message": "x"}}))

        result = c.workflows.run_version(
            "wf_1", 4, wait=True, variables={"a": 1}, trigger="manual", input={"b": 2}
        )

        self.assertEqual(calls[0].full_url, f"{BASE}/workflows/wf_1/versions/4/run?wait=true")
        self.assertEqual(
            sent_body(calls[0]), {"variables": {"a": 1}, "trigger": "manual", "input": {"b": 2}}
        )
        # A failed run is data, not an error.
        self.assertEqual((result.status, result.terminal), ("failed", True))

    def test_a_non_run_body_is_bad_response(self) -> None:
        c, _ = client((200, {"ok": True}))
        with self.assertRaises(ApiError) as caught:
            c.workflows.run_version("wf_1", 1)
        self.assertEqual(caught.exception.code, "bad_response")


class FunctionRunVersionTest(unittest.TestCase):
    """`functions.run_version` posts to `/invoke` and unwraps `output`."""

    def test_wire_and_unwrap(self) -> None:
        c, calls = client((200, {"output": {"sent": True}}))

        self.assertEqual(c.functions.run_version("fn_1", 3, payload={"to": "a"}), {"sent": True})
        self.assertEqual(calls[0].full_url, f"{BASE}/functions/fn_1/versions/3/invoke")
        self.assertEqual(calls[0].get_method(), "POST")
        self.assertEqual(sent_body(calls[0]), {"inputs": {"to": "a"}})

    def test_no_payload_is_an_empty_inputs_object(self) -> None:
        c, calls = client((200, {"output": 1}))
        c.functions.run_version("fn_1", 3)
        self.assertEqual(sent_body(calls[0]), {"inputs": {}})

    def test_a_null_output_is_a_successful_run_and_a_missing_key_is_not(self) -> None:
        c, _ = client((200, {"output": None}))
        self.assertIsNone(c.functions.run_version("fn_1", 1))
        c, _ = client((200, {}))
        with self.assertRaises(ApiError) as caught:
            c.functions.run_version("fn_1", 1)
        self.assertEqual(caught.exception.code, "bad_response")

    def test_there_is_no_draft_flag_on_a_version_run(self) -> None:
        c, _ = client((200, {"output": 1}))
        with self.assertRaises(TypeError):
            c.functions.run_version("fn_1", 1, allow_unpublished=True)  # type: ignore[call-arg]


class FunctionAllowUnpublishedTest(unittest.TestCase):
    """`functions.run(allow_unpublished=True)` — body field, only when `True`."""

    def test_true_is_sent_alongside_inputs(self) -> None:
        c, calls = client((200, {"output": 1}))
        c.functions.run("send-email", payload={"to": "a"}, allow_unpublished=True)
        self.assertEqual(sent_body(calls[0]), {"inputs": {"to": "a"}, "allowUnpublished": True})
        self.assertEqual(calls[0].full_url, f"{BASE}/functions/send-email/invoke")

    def test_default_and_false_leave_it_out(self) -> None:
        c, calls = client((200, {"output": 1}))
        c.functions.run("send-email")
        c.functions.run("send-email", allow_unpublished=False)
        self.assertEqual(sent_body(calls[0]), {"inputs": {}})
        self.assertEqual(sent_body(calls[1]), {"inputs": {}})


if __name__ == "__main__":  # pragma: no cover - convenience for a single-file run.
    unittest.main()
