"""`tag` on `workflows.list` / `functions.list`, and the `endpoints.list` op, against a fake transport.

Each case asserts the OUTGOING URL: `?tag=` is on the wire only when a tag was given, and a
missing or blank tag sends the bare list path. Measured against plan P1 — the server's `?tag=`
filter itself is not exercised here.
"""

from __future__ import annotations

import unittest

from tests.test_discovery import client, responding


class TagListTest(unittest.TestCase):
    def test_functions_list_sends_tag_only_when_given(self) -> None:
        instance, calls = client(responding({"functions": []}))

        instance.functions.list(tag="action.order")
        instance.functions.list()
        instance.functions.list(tag="  ")

        self.assertEqual(
            [c.full_url for c in calls],
            [
                "https://api.example.com/functions?tag=action.order",
                "https://api.example.com/functions",
                "https://api.example.com/functions",
            ],
        )

    def test_endpoints_list_sends_tag_only_when_given_and_returns_summaries(self) -> None:
        instance, calls = client(
            responding({"endpoints": [{"id": "ep_1", "key": "k", "tags": ["action.order"]}]})
        )

        rows = instance.endpoints.list(tag="action.order")
        instance.endpoints.list()

        self.assertEqual(
            [c.full_url for c in calls],
            [
                "https://api.example.com/endpoints?tag=action.order",
                "https://api.example.com/endpoints",
            ],
        )
        self.assertEqual(rows[0].id, "ep_1")
        self.assertEqual(rows[0].tags, ["action.order"])

    def test_workflows_list_sends_tag_beside_project(self) -> None:
        instance, calls = client(responding({"workflows": []}))

        instance.workflows.list(tag="action.order")
        instance.workflows.list(project="prj_1", tag="action.order")
        instance.workflows.list()

        self.assertEqual(
            [c.full_url for c in calls],
            [
                "https://api.example.com/workflows?tag=action.order",
                "https://api.example.com/workflows?project=prj_1&tag=action.order",
                "https://api.example.com/workflows",
            ],
        )

    def test_function_summary_carries_tags_and_defaults_to_empty(self) -> None:
        instance, _calls = client(
            responding(
                {"functions": [{"id": "fn_1", "tags": ["a.b"]}, {"id": "fn_2"}]},
            )
        )

        rows = instance.functions.list()

        self.assertEqual([r.tags for r in rows], [["a.b"], []])


if __name__ == "__main__":
    unittest.main()
