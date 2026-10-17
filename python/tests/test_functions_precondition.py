"""The stale-write token on `client.functions.*`.

Mirror of the `node` lane's `functions_precondition_test.ts`. Fixtures carry
`updatedAt` TOP-LEVEL ONLY, as the server does: it is a sibling of the
`function` envelope, never a field inside it.
"""

from __future__ import annotations

import unittest

from w6w import ApiError

from .test_definitions_crud import client, http_error, raising, responding

TOKEN = "2026-10-17T01:00:00.000Z"
HEADER = "X-w6w-if-unmodified-since"  # urllib capitalises header keys
SAVED = {"function": {"id": "fn_1", "key": "send-email"}, "updatedAt": TOKEN}
DEF = {"key": "send-email", "inputs": []}


class FunctionPreconditionTest(unittest.TestCase):
    def test_the_precondition_header_is_sent_only_when_given(self) -> None:
        instance, calls = client(responding(SAVED, 201))

        instance.functions.update("fn_1", DEF)
        instance.functions.update("fn_1", DEF, if_unmodified_since=None)
        instance.functions.update("fn_1", DEF, if_unmodified_since="")
        instance.functions.update("fn_1", DEF, if_unmodified_since=TOKEN)

        self.assertEqual(
            [c.get_header(HEADER) for c in calls], [None, None, None, TOKEN]
        )

    def test_create_never_sends_the_header(self) -> None:
        instance, calls = client(responding(SAVED, 201))

        instance.functions.create(DEF)

        self.assertIsNone(calls[0].get_header(HEADER))

    def test_save_results_carry_the_top_level_updated_at(self) -> None:
        instance, _ = client(responding(SAVED, 201))

        created = instance.functions.create(DEF)
        updated = instance.functions.update("fn_1", DEF)

        self.assertEqual((created.id, created.key, created.updatedAt), ("fn_1", "send-email", TOKEN))
        self.assertEqual((updated.id, updated.key, updated.updatedAt), ("fn_1", "send-email", TOKEN))

    def test_get_exposes_updated_at_beside_valid(self) -> None:
        instance, _ = client(
            responding({"function": {"id": "fn_1"}, "valid": True, "updatedAt": TOKEN})
        )

        detail = instance.functions.get("fn_1")

        self.assertEqual(detail.updatedAt, TOKEN)
        self.assertTrue(detail.valid)
        self.assertNotIn("updatedAt", detail.function)

    def test_list_rows_carry_archived_at_or_none(self) -> None:
        row = {
            "id": "fn_1",
            "key": "a",
            "displayName": "A",
            "description": "",
            "updatedAt": TOKEN,
            "valid": True,
        }
        instance, _ = client(
            responding({"functions": [{**row, "archivedAt": TOKEN}, {**row, "archivedAt": None}, row]})
        )

        rows = instance.functions.list()

        self.assertEqual([r.archivedAt for r in rows], [TOKEN, None, None])

    def test_a_stale_write_raises_function_stale(self) -> None:
        instance, _ = client(
            raising(http_error(409, {"error": {"code": "function_stale", "message": "!"}}))
        )

        with self.assertRaises(ApiError) as caught:
            instance.functions.update("fn_1", DEF, if_unmodified_since=TOKEN)

        self.assertEqual((caught.exception.status, caught.exception.code), (409, "function_stale"))

    def test_a_bad_token_raises_invalid_precondition(self) -> None:
        instance, _ = client(
            raising(http_error(400, {"error": {"code": "invalid_precondition", "message": "!"}}))
        )

        with self.assertRaises(ApiError) as caught:
            instance.functions.update("fn_1", DEF, if_unmodified_since="x")

        self.assertEqual(caught.exception.code, "invalid_precondition")


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
