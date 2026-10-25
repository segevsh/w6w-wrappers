"""The Agents Studio surface: `client.skills.*`, `client.context.*`, `client.agents.*`.

Mirror of the `node` lane's `agents_studio_test.ts`, case for case, because the
two lanes have to put the same bytes on the wire (contract 0.11.0). Against an
**injected fake transport** (`docs/implementation.md` §9) — no case here opens a
socket.

What this file pins that no other suite can see:

1. **The envelope each route answers with.** Every read here is wrapped
   (`{skills}`, `{skill}`, `{versions}`, `{collections}`, `{entries}`, `{agent}`,
   …); a wrapper that returned the body as-is would hand the caller a dict with
   one key and an attribute error waiting downstream.
2. **The precondition header is sent only when given.** `agents.update` and
   `context.entries.update` REQUIRE it server-side: absent, the answer is
   `428 precondition_required`; empty, `400 invalid_precondition`. So the wrapper
   never defaults it and never sends `""`.
3. **`revision` is passed through unchanged.** It is a body field the server
   bumps, not a client-side counter, and a wrapper that computed one would be
   quietly wrong on the second write.
4. **The camelCase boundary.** `model_route_id` becomes `modelRouteId` on the
   wire and nothing else is renamed; an omitted argument is LEFT OUT rather than
   sent as `null`, which would clear a patched field.
"""

from __future__ import annotations

import unittest
from typing import Any, Dict

from w6w import ApiError

from .test_definitions_crud import client, http_error, raising, responding, sent_body

#: urllib capitalises header keys; the wire name is `x-w6w-if-unmodified-since`.
HEADER = "X-w6w-if-unmodified-since"
TOKEN = "2026-10-24T09:00:00.000Z"

SKILL: Dict[str, Any] = {
    "id": "skl_1",
    "name": "Tone",
    "activeVersionId": "skv_2",
    "latestVersionId": "skv_2",
    "archivedAt": None,
}
SKILL_VERSION = {"id": "skv_2", "versionNumber": 2, "createdAt": TOKEN}
COLLECTION = {"id": "ctx_1", "name": "handbook", "description": "", "tags": []}
ENTRY_VIEW = {"id": "ent_1", "name": "hours", "text": "9-5 CET", "revision": 3}
AGENT = {
    "id": "agt_1",
    "name": "triage",
    "revision": 1,
    "runnable": False,
    "archived": False,
    "validation": [],
}


class SurfaceTest(unittest.TestCase):
    """Every contracted operation of the group is on the namespace that names it."""

    def test_skills_exposes_the_four_reads(self) -> None:
        instance, _ = client(responding({}))
        self.assertEqual(
            {name for name in dir(instance.skills) if not name.startswith("_")},
            # `_host` is private, so the public surface is exactly the contract.
            {"list", "get", "versions", "archive"},
        )
        for name in ("list", "get", "versions", "archive"):
            with self.subTest(operation=name):
                self.assertTrue(callable(getattr(instance.skills, name)))

    def test_context_exposes_its_six_and_the_entries_half(self) -> None:
        instance, _ = client(responding({}))

        self.assertEqual(
            {
                name
                for name in dir(instance.context)
                if not name.startswith("_") and callable(getattr(instance.context, name))
            },
            {"list", "create", "get", "update", "archive"},
        )
        # `entries` is a namespace, not an operation — reachable, not callable.
        self.assertFalse(callable(instance.context.entries))
        for name in ("list", "create", "update"):
            with self.subTest(operation=name):
                self.assertTrue(callable(getattr(instance.context.entries, name)))

    def test_agents_exposes_the_five(self) -> None:
        instance, _ = client(responding({}))

        self.assertEqual(
            {
                name
                for name in dir(instance.agents)
                if not name.startswith("_") and callable(getattr(instance.agents, name))
            },
            {"list", "create", "get", "update", "archive"},
        )


class SkillsTest(unittest.TestCase):
    """`GET /skills*` and `POST /skills/{id}/archive`."""

    def test_list_unwraps_the_skills_envelope(self) -> None:
        instance, calls = client(responding({"skills": [SKILL]}))

        rows = instance.skills.list()

        self.assertEqual(rows, [SKILL])
        self.assertEqual(calls[0].get_method(), "GET")
        self.assertEqual(calls[0].full_url, "https://api.example.com/skills")

    def test_list_forward_the_two_optional_filters(self) -> None:
        # `False` is a value, not an omission: dropping it would silently widen
        # the answer to "everything" for a caller who asked to exclude archived.
        instance, calls = client(responding({"skills": []}))

        instance.skills.list(include_archived=False, limit=5)

        self.assertEqual(
            calls[0].full_url,
            "https://api.example.com/skills?includeArchived=false&limit=5",
        )

    def test_get_addresses_one_skill_and_unwraps_it(self) -> None:
        instance, calls = client(responding({"skill": SKILL}))

        self.assertEqual(instance.skills.get("skl_1"), SKILL)
        self.assertEqual(calls[0].full_url, "https://api.example.com/skills/skl_1")

    def test_a_caller_supplied_id_is_percent_encoded(self) -> None:
        instance, calls = client(responding({"skill": SKILL}))

        instance.skills.get("a/b")

        self.assertEqual(calls[0].full_url, "https://api.example.com/skills/a%2Fb")

    def test_versions_unwraps_the_versions_envelope(self) -> None:
        instance, calls = client(responding({"versions": [SKILL_VERSION]}))

        self.assertEqual(instance.skills.versions("skl_1"), [SKILL_VERSION])
        self.assertEqual(calls[0].full_url, "https://api.example.com/skills/skl_1/versions")

    def test_archive_posts_and_unwraps_the_archived_row(self) -> None:
        archived = {**SKILL, "archivedAt": TOKEN}
        instance, calls = client(responding({"skill": archived}))

        self.assertEqual(instance.skills.archive("skl_1"), archived)
        self.assertEqual(calls[0].full_url, "https://api.example.com/skills/skl_1/archive")
        self.assertEqual(calls[0].get_method(), "POST")

    def test_a_uniform_404_is_a_typed_not_found(self) -> None:
        instance, _ = client(
            raising(http_error(404, {"error": {"code": "not_found", "message": "No such."}}))
        )

        with self.assertRaises(ApiError) as caught:
            instance.skills.get("skl_missing")

        self.assertEqual((caught.exception.status, caught.exception.code), (404, "not_found"))


class ContextCollectionTest(unittest.TestCase):
    """`/context-collections`: the collection half."""

    def test_list_unwraps_the_collections_envelope(self) -> None:
        instance, calls = client(responding({"collections": [COLLECTION]}))

        self.assertEqual(instance.context.list(), [COLLECTION])
        self.assertEqual(calls[0].full_url, "https://api.example.com/context-collections")

    def test_list_forwards_the_two_optional_filters(self) -> None:
        instance, calls = client(responding({"collections": []}))

        instance.context.list(include_archived=True, limit=2)

        self.assertEqual(
            calls[0].full_url,
            "https://api.example.com/context-collections?includeArchived=true&limit=2",
        )

    def test_create_sends_only_what_the_caller_supplied(self) -> None:
        # An omitted field must not arrive as `null`: `visibility: null` is
        # `400 invalid_body` on the server, not "leave the default".
        instance, calls = client(responding({"collection": COLLECTION}))

        self.assertEqual(instance.context.create("handbook"), COLLECTION)
        self.assertEqual(sent_body(calls[0]), {"name": "handbook"})
        self.assertEqual(calls[0].get_method(), "POST")
        self.assertEqual(calls[0].full_url, "https://api.example.com/context-collections")

    def test_create_carries_every_optional_field_verbatim(self) -> None:
        instance, calls = client(responding({"collection": COLLECTION}))

        instance.context.create(
            "handbook", description="Team handbook", tags=["docs"], visibility="project"
        )

        self.assertEqual(
            sent_body(calls[0]),
            {
                "name": "handbook",
                "description": "Team handbook",
                "tags": ["docs"],
                "visibility": "project",
            },
        )

    def test_get_unwraps_the_collection_envelope(self) -> None:
        instance, calls = client(responding({"collection": COLLECTION}))

        self.assertEqual(instance.context.get("ctx_1"), COLLECTION)
        self.assertEqual(calls[0].full_url, "https://api.example.com/context-collections/ctx_1")

    def test_update_patches_only_the_given_fields(self) -> None:
        instance, calls = client(responding({"collection": COLLECTION}))

        instance.context.update("ctx_1", name="handbook-2")

        self.assertEqual(calls[0].get_method(), "PATCH")
        self.assertEqual(sent_body(calls[0]), {"name": "handbook-2"})

    def test_update_keeps_a_deliberate_empty_string_and_empty_list(self) -> None:
        # `""` and `[]` clear a field; they are values, not "not supplied".
        instance, calls = client(responding({"collection": COLLECTION}))

        instance.context.update("ctx_1", description="", tags=[])

        self.assertEqual(sent_body(calls[0]), {"description": "", "tags": []})

    def test_a_collection_patch_carries_no_precondition_and_no_revision(self) -> None:
        # Deliberate asymmetry with the entry and agent writes: this route is
        # last-write-wins, and inventing a guard here would be a 428 nobody asked
        # for.
        instance, calls = client(responding({"collection": COLLECTION}))

        instance.context.update("ctx_1", name="handbook-2")

        self.assertIsNone(calls[0].get_header(HEADER))
        self.assertNotIn("revision", sent_body(calls[0]))

    def test_archive_posts_and_unwraps_the_archived_row(self) -> None:
        archived = {**COLLECTION, "archivedAt": TOKEN}
        instance, calls = client(responding({"collection": archived}))

        self.assertEqual(instance.context.archive("ctx_1"), archived)
        self.assertEqual(
            calls[0].full_url, "https://api.example.com/context-collections/ctx_1/archive"
        )
        self.assertEqual(calls[0].get_method(), "POST")


class ContextEntryTest(unittest.TestCase):
    """`/context-collections/{id}/entries`: the entry half."""

    def test_list_unwraps_the_entries_envelope(self) -> None:
        row = {"id": "ent_1", "name": "hours", "assetVersionId": None}
        instance, calls = client(responding({"entries": [row]}))

        self.assertEqual(instance.context.entries.list("ctx_1"), [row])
        self.assertEqual(
            calls[0].full_url, "https://api.example.com/context-collections/ctx_1/entries"
        )

    def test_list_forwards_include_archived(self) -> None:
        instance, calls = client(responding({"entries": []}))

        instance.context.entries.list("ctx_1", include_archived=True)

        self.assertEqual(
            calls[0].full_url,
            "https://api.example.com/context-collections/ctx_1/entries?includeArchived=true",
        )

    def test_create_sends_the_name_and_text_and_answers_the_view(self) -> None:
        instance, calls = client(responding({"entry": ENTRY_VIEW}))

        self.assertEqual(instance.context.entries.create("ctx_1", "hours", "9-5 CET"), ENTRY_VIEW)
        self.assertEqual(sent_body(calls[0]), {"name": "hours", "text": "9-5 CET"})
        self.assertEqual(calls[0].get_method(), "POST")

    def test_update_replaces_the_text_with_the_given_revision(self) -> None:
        instance, calls = client(responding({"entry": {**ENTRY_VIEW, "revision": 4}}))

        answer = instance.context.entries.update("ctx_1", "ent_1", "9-6 CET", 3)

        self.assertEqual(answer["revision"], 4)
        self.assertEqual(calls[0].get_method(), "PUT")
        self.assertEqual(
            calls[0].full_url,
            "https://api.example.com/context-collections/ctx_1/entries/ent_1",
        )
        self.assertEqual(sent_body(calls[0]), {"text": "9-6 CET", "revision": 3})

    def test_the_precondition_header_is_sent_only_when_given(self) -> None:
        instance, calls = client(responding({"entry": ENTRY_VIEW}))
        instance.context.entries.update("ctx_1", "ent_1", "a", 1)
        instance.context.entries.update("ctx_1", "ent_1", "a", 1, if_unmodified_since="")
        instance.context.entries.update("ctx_1", "ent_1", "a", 1, if_unmodified_since=TOKEN)

        self.assertEqual([c.get_header(HEADER) for c in calls], [None, None, TOKEN])

    def test_a_stale_write_is_a_typed_conflict_carrying_the_current_revision(self) -> None:
        instance, _ = client(
            raising(
                http_error(
                    409,
                    {
                        "error": {
                            "code": "conflict",
                            "message": "The entry moved on.",
                            "currentRevision": 7,
                        }
                    },
                )
            )
        )

        with self.assertRaises(ApiError) as caught:
            instance.context.entries.update("ctx_1", "ent_1", "a", 3, if_unmodified_since=TOKEN)

        self.assertEqual((caught.exception.status, caught.exception.code), (409, "conflict"))
        self.assertEqual(caught.exception.raw["error"]["currentRevision"], 7)

    def test_a_missing_precondition_is_a_typed_precondition_error(self) -> None:
        instance, _ = client(
            raising(
                http_error(
                    428,
                    {"error": {"code": "precondition_required", "message": "Send the header."}},
                )
            )
        )

        with self.assertRaises(ApiError) as caught:
            instance.context.entries.update("ctx_1", "ent_1", "a", 3)

        self.assertEqual(
            (caught.exception.status, caught.exception.code), (428, "precondition_required")
        )


class AgentsTest(unittest.TestCase):
    """`/agents`: drafts, revisions and pins."""

    def test_list_unwraps_the_agents_envelope(self) -> None:
        instance, calls = client(responding({"agents": [AGENT]}))

        self.assertEqual(instance.agents.list(), [AGENT])
        self.assertEqual(calls[0].full_url, "https://api.example.com/agents")

    def test_list_forwards_include_archived(self) -> None:
        instance, calls = client(responding({"agents": []}))

        instance.agents.list(include_archived=True)

        self.assertEqual(calls[0].full_url, "https://api.example.com/agents?includeArchived=true")

    def test_create_sends_an_empty_body_when_nothing_is_supplied(self) -> None:
        # An incomplete draft is legal: `validation` on the answer says what is
        # missing, so `{}` is a real request, not a bug.
        instance, calls = client(responding({"agent": AGENT}))

        self.assertEqual(instance.agents.create(), AGENT)
        self.assertEqual(sent_body(calls[0]), {})
        self.assertEqual(calls[0].get_method(), "POST")

    def test_create_renames_model_route_and_passes_the_pins_through(self) -> None:
        instance, calls = client(responding({"agent": AGENT}))
        skills = [{"skillId": "skl_1", "skillVersionId": "skv_2"}]
        pins = [{"collectionId": "ctx_1", "assetVersionId": "astv_1"}]

        instance.agents.create(
            name="triage",
            instructions="Sort the inbox.",
            model_route_id="mroute_1",
            skills=skills,
            context=pins,
            visibility="private",
            project="prj_1",
        )

        self.assertEqual(
            sent_body(calls[0]),
            {
                "name": "triage",
                "instructions": "Sort the inbox.",
                "modelRouteId": "mroute_1",
                "skills": skills,
                "context": pins,
                "visibility": "private",
                "project": "prj_1",
            },
        )

    def test_get_unwraps_the_draft_and_keeps_runnable_false(self) -> None:
        instance, calls = client(responding({"agent": AGENT}))

        self.assertEqual(instance.agents.get("agt_1"), AGENT)
        self.assertIs(instance.agents.get("agt_1")["runnable"], False)
        self.assertEqual(calls[0].full_url, "https://api.example.com/agents/agt_1")

    def test_update_patches_one_field_plus_the_required_revision(self) -> None:
        instance, calls = client(responding({"agent": {**AGENT, "revision": 2}}))

        answer = instance.agents.update("agt_1", 1, name="triage-2")

        self.assertEqual(answer["revision"], 2)
        self.assertEqual(calls[0].get_method(), "PATCH")
        self.assertEqual(sent_body(calls[0]), {"revision": 1, "name": "triage-2"})

    def test_update_sends_the_precondition_header_only_when_given(self) -> None:
        instance, calls = client(responding({"agent": AGENT}))
        instance.agents.update("agt_1", 1, name="a")
        instance.agents.update("agt_1", 1, name="a", if_unmodified_since="")
        instance.agents.update("agt_1", 1, name="a", if_unmodified_since=TOKEN)

        self.assertEqual([c.get_header(HEADER) for c in calls], [None, None, TOKEN])

    def test_update_sends_the_revision_even_when_it_is_the_only_field(self) -> None:
        instance, calls = client(responding({"agent": AGENT}))

        instance.agents.update("agt_1", 4)

        self.assertEqual(sent_body(calls[0]), {"revision": 4})

    def test_a_stale_write_is_a_typed_conflict_carrying_the_current_revision(self) -> None:
        instance, _ = client(
            raising(
                http_error(
                    409,
                    {
                        "error": {
                            "code": "conflict",
                            "message": "The draft moved on.",
                            "currentRevision": 9,
                        }
                    },
                )
            )
        )

        with self.assertRaises(ApiError) as caught:
            instance.agents.update("agt_1", 1, name="a", if_unmodified_since=TOKEN)

        self.assertEqual((caught.exception.status, caught.exception.code), (409, "conflict"))
        self.assertEqual(caught.exception.raw["error"]["currentRevision"], 9)

    def test_a_missing_precondition_is_a_typed_precondition_error(self) -> None:
        instance, _ = client(
            raising(
                http_error(
                    428,
                    {"error": {"code": "precondition_required", "message": "Send the header."}},
                )
            )
        )

        with self.assertRaises(ApiError) as caught:
            instance.agents.update("agt_1", 1, name="a")

        self.assertEqual(
            (caught.exception.status, caught.exception.code), (428, "precondition_required")
        )

    def test_a_disallowed_pin_is_a_typed_validation_failure(self) -> None:
        instance, _ = client(
            raising(
                http_error(
                    422,
                    {"error": {"code": "validation_failed", "message": "Bad pin.", "issues": []}},
                )
            )
        )

        with self.assertRaises(ApiError) as caught:
            instance.agents.update("agt_1", 1, skills=[{"skillId": "skl_x"}])

        self.assertEqual(
            (caught.exception.status, caught.exception.code), (422, "validation_failed")
        )

    def test_archive_posts_and_unwraps_the_archived_draft(self) -> None:
        archived = {**AGENT, "archived": True}
        instance, calls = client(responding({"agent": archived}))

        self.assertEqual(instance.agents.archive("agt_1"), archived)
        self.assertEqual(calls[0].full_url, "https://api.example.com/agents/agt_1/archive")
        self.assertEqual(calls[0].get_method(), "POST")


if __name__ == "__main__":  # pragma: no cover - convenience for a single-file run.
    unittest.main()
