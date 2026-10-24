"""`client.skills.*`, `client.context.*` and `client.agents.*` — the Agents Studio surface.

Three namespaces in one module because they are one feature, added together and
exercised together (`endpoints.json` contract 0.11.0)::

    skill  = client.skills.get(skill_id)
    coll   = client.context.create("handbook", description="Team handbook")
    entry  = client.context.entries.create(coll["id"], "hours", "9-5 CET")
    agent  = client.agents.create(name="Support triage")

── What is NOT here ──
No Agent runtime, no RAG, no chat history. An Agent in this contract is a saved
DRAFT: every answer carries ``runnable: false``, and no operation in this group
runs one (A22). Likewise there is no ``skills.create``: a skill is created by
uploading bytes with ``client.assets.uploads.create(..., purpose="skill")``.

── The two writes that carry a precondition ──
``context.entries.update`` and ``agents.update`` are the guarded ones. Each sends
the body ``revision`` (required, passed through unchanged) and, when given, the
``x-w6w-if-unmodified-since`` header — the same header name the workflow and
Function writes use, imported rather than re-spelled so the three cannot drift.
The server REQUIRES the header on both routes: omit it and the answer is
``428 precondition_required``. Send a stale token and the answer is a ``409``
(errors.py classification: ``conflict``) whose envelope carries
``currentRevision`` under ``err.raw["error"]`` — re-read and re-send.
``context.update`` (a collection patch) carries neither: it is last-write-wins.

Nothing here holds module state: each namespace is constructed with the client
it issues requests through (`docs/implementation.md` §2).
"""

from __future__ import annotations

from typing import Any, Dict, List, Mapping, Optional, Protocol, Sequence

from ._config import ResolvedConfig
from ._http import HttpResponse, path
from .types import unwrap_list, unwrap_object
from .workflows import PRECONDITION_HEADER


class AgentsStudioHost(Protocol):
    """The slice of `Client` these namespaces need.

    Structural rather than a concrete client type, so a namespace stays
    independently constructible in a test and this module never imports the
    client back (an import cycle as well as a layering inversion). The
    configuration is part of it because a host may want to see which server
    answered; no operation here sends a project.
    """

    #: The resolved configuration.
    config: ResolvedConfig

    def request(
        self,
        method: str,
        path: str,
        query: Optional[Mapping[str, Any]] = None,
        body: Optional[Any] = None,
        headers: Optional[Mapping[str, str]] = None,
    ) -> HttpResponse:
        """Perform one request."""
        ...


def _body(**fields: Any) -> Dict[str, Any]:
    """Build a request body from the fields the caller actually supplied.

    An omitted keyword is left OUT of the body rather than sent as ``null``:
    every write in this group is a patch (``agents.update``,
    ``context.update``) or has optional fields (``context.create``,
    ``agents.create``), and `null` would either clear a field or be rejected —
    neither is what "I did not pass it" means. ``False``, ``0``, ``""`` and an
    empty list are values, not omissions, so the test is `is None`.

    :param fields: The camelCase wire names and their values.
    :returns: The body, without the `None` values.
    """
    return {name: value for name, value in fields.items() if value is not None}


class SkillsApi:
    """The `skills` namespace: read and archive uploaded skills.

    A skill is immutable once uploaded — a new upload is a new version, never an
    edit — so there is no `create` and no `update` here. Skills are CREATED with
    ``client.assets.uploads.create(..., purpose="skill")``.

    Every read answers with the skill's `id`, `name`, `description`,
    `activeVersionId`, `latestVersionId`, `archivedAt` and timestamps; ``bytes``
    (storage paths, object keys) never ride on a skill row.

    Example::

        for skill in client.skills.list():
            print(skill["name"], skill["activeVersionId"])
    """

    def __init__(self, host: AgentsStudioHost) -> None:
        """Bind the namespace to the client it issues requests through.

        :param host: The client this namespace issues requests through.
        """
        self._host = host

    def list(
        self,
        include_archived: Optional[bool] = None,
        limit: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """List the skills visible to the caller.

        Principal-scoped: no project argument, because the route reads none.

        :param include_archived: Include archived skills. Omitted, the server
            omits them.
        :param limit: Cap the number of rows.
        :returns: The `skills` array, unwrapped — newest first.
        :raises ConfigError: When no token is configured.
        :raises ApiError: `bad_response` when a `2xx` body carries no ``skills``
            array.
        """
        response = self._host.request(
            "GET",
            "/skills",
            query={"includeArchived": include_archived, "limit": limit},
        )
        return unwrap_list(response, "skills")

    def get(self, id: str) -> Dict[str, Any]:
        """Fetch one skill.

        :param id: The `skl_…` id, percent-encoded into the path.
        :returns: The skill, unwrapped from ``{skill}``.
        :raises ApiError: `404 not_found` — missing, foreign, private or in
            another project; the server draws no distinction.
        """
        return unwrap_object(self._host.request("GET", path("/skills/{id}", id=id)), "skill")

    def versions(self, id: str) -> List[Dict[str, Any]]:
        """List a skill's immutable versions.

        A version's `id` is what an agent's ``skills[].skillVersionId`` pins, so
        this is how a caller records "the version this agent was built on".

        :param id: The `skl_…` id.
        :returns: The `versions` array, unwrapped.
        :raises ApiError: `404 not_found`.
        """
        response = self._host.request("GET", path("/skills/{id}/versions", id=id))
        return unwrap_list(response, "versions")

    def archive(self, id: str) -> Dict[str, Any]:
        """Archive a skill; the bytes are never deleted.

        One-way: there is no unarchive route, and an archived skill is omitted
        from :meth:`list` unless ``include_archived`` is true. Idempotent.

        :param id: The `skl_…` id.
        :returns: The archived skill (`archivedAt` set), unwrapped from
            ``{skill}``.
        :raises ApiError: `404 not_found`.
        """
        response = self._host.request("POST", path("/skills/{id}/archive", id=id))
        return unwrap_object(response, "skill")


class ContextEntriesApi:
    """The `context.entries.*` half of `client.context`.

    An entry is one unit of context: ``text`` here, a file version for an
    uploaded document. :meth:`create` and :meth:`update` answer a
    **ContextEntryView** — the entry plus ``revision`` — while :meth:`list`
    answers the plain rows, which carry no ``revision`` at all. So the revision
    for a first :meth:`update` comes from the :meth:`create` answer — or, for an
    entry that already exists, from its create/update answer at the time it was
    written — never from a list row.
    """

    def __init__(self, host: AgentsStudioHost) -> None:
        """Bind the namespace to the client it issues requests through.

        :param host: The client this namespace issues requests through.
        """
        self._host = host

    def list(
        self,
        id: str,
        include_archived: Optional[bool] = None,
    ) -> List[Dict[str, Any]]:
        """List a collection's entries.

        :param id: The COLLECTION id.
        :param include_archived: Include archived entries.
        :returns: The `entries` array, unwrapped.
        :raises ApiError: `404 not_found` — a collection the caller may not see.
        """
        response = self._host.request(
            "GET",
            path("/context-collections/{id}/entries", id=id),
            query={"includeArchived": include_archived},
        )
        return unwrap_list(response, "entries")

    def create(self, id: str, name: str, text: str) -> Dict[str, Any]:
        """Add a text entry to a collection.

        Binary context is not sent here: upload it with
        ``client.assets.uploads.create(..., purpose="context")``, which pins an
        asset version into the collection instead.

        :param id: The COLLECTION id.
        :param name: The entry's display name; unique within the collection.
        :param text: The entry's text, size-capped by the server.
        :returns: The new entry as a `ContextEntryView` (with ``revision``),
            unwrapped from ``{entry}``.
        :raises ApiError: `400 invalid_body` — a non-string name or text.
        :raises ApiError: `404 not_found`.
        """
        response = self._host.request(
            "POST",
            path("/context-collections/{id}/entries", id=id),
            body={"name": name, "text": text},
        )
        return unwrap_object(response, "entry")

    def update(
        self,
        id: str,
        entry_id: str,
        text: str,
        revision: int,
        if_unmodified_since: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Replace an entry's text. A FULL REPLACEMENT, not a patch.

        Two tokens guard it, and they are not interchangeable: ``revision`` is
        the body field the server bumps on every accepted write, and
        ``if_unmodified_since`` is the ``updatedAt`` precondition header. The
        server requires the header on this route — omitted, the answer is
        ``428 precondition_required`` — so this wrapper never defaults it.

        :param id: The COLLECTION id.
        :param entry_id: The entry's id. An entry that does not belong to this
            collection is the same uniform `404`.
        :param text: The whole new text.
        :param revision: The entry's last-seen revision, passed through
            unchanged. `< 1` or a non-integer is `400 invalid_body`.
        :param if_unmodified_since: The exact ``updatedAt`` this client last
            read. Sent as `x-w6w-if-unmodified-since` **only when given** —
            never as an empty string, which the server rejects as
            `400 invalid_precondition`.
        :returns: The entry as a `ContextEntryView` with the bumped
            ``revision``, unwrapped from ``{entry}``.
        :raises ApiError: `409 conflict` — a stale revision or `updatedAt`;
            recoverable by re-reading and re-sending.
        :raises ApiError: `428 precondition_required` — no precondition header.
        :raises ApiError: `404 not_found`.
        """
        response = self._host.request(
            "PUT",
            path("/context-collections/{id}/entries/{entryId}", id=id, entryId=entry_id),
            body={"text": text, "revision": revision},
            headers=self._precondition(if_unmodified_since),
        )
        return unwrap_object(response, "entry")

    @staticmethod
    def _precondition(if_unmodified_since: Optional[str]) -> Optional[Dict[str, str]]:
        """Render the precondition header, or nothing at all.

        :param if_unmodified_since: The caller's token, if any.
        :returns: The header mapping, or `None` so no header is sent.
        """
        return {PRECONDITION_HEADER: if_unmodified_since} if if_unmodified_since else None


class ContextApi:
    """The `context` namespace: context collections and their entries.

    A collection is a named bag of entries — text via :attr:`entries`, files via
    ``client.assets.uploads.*`` with ``purpose="context"``. Creating one never
    populates it; it starts empty.

    Example::

        coll = client.context.create("handbook", tags=["docs"])
        client.context.entries.create(coll["id"], "hours", "9-5 CET")
    """

    def __init__(self, host: AgentsStudioHost) -> None:
        """Bind the namespace, and its `entries` half, to the client.

        :param host: The client this namespace issues requests through.
        """
        self._host = host
        #: The collection's text entries: ``list``, ``create``, ``update``.
        self.entries = ContextEntriesApi(host)

    def list(
        self,
        include_archived: Optional[bool] = None,
        limit: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """List the context collections visible to the caller.

        Principal-scoped: no project argument, because the route reads none.

        :param include_archived: Include archived collections.
        :param limit: Cap the number of rows.
        :returns: The `collections` array, unwrapped.
        :raises ApiError: `bad_response` when a `2xx` body carries no
            ``collections`` array.
        """
        response = self._host.request(
            "GET",
            "/context-collections",
            query={"includeArchived": include_archived, "limit": limit},
        )
        return unwrap_list(response, "collections")

    def create(
        self,
        name: str,
        description: Optional[str] = None,
        tags: Optional[Sequence[str]] = None,
        visibility: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Create an empty collection.

        :param name: The collection's name, required.
        :param description: Free text.
        :param tags: A list of tags.
        :param visibility: ``private``, ``project`` or ``account``. Anything
            else is `400 invalid_body`.
        :returns: The collection, unwrapped from ``{collection}``.
        :raises ApiError: `400 invalid_body`.
        """
        response = self._host.request(
            "POST",
            "/context-collections",
            body=_body(
                name=name,
                description=description,
                tags=tags,
                visibility=visibility,
            ),
        )
        return unwrap_object(response, "collection")

    def get(self, id: str) -> Dict[str, Any]:
        """Fetch one collection — metadata only, never its entries.

        :param id: The `ctx_…` id.
        :returns: The collection, unwrapped from ``{collection}``.
        :raises ApiError: `404 not_found`.
        """
        response = self._host.request("GET", path("/context-collections/{id}", id=id))
        return unwrap_object(response, "collection")

    def update(
        self,
        id: str,
        name: Optional[str] = None,
        description: Optional[str] = None,
        tags: Optional[Sequence[str]] = None,
    ) -> Dict[str, Any]:
        """Patch a collection's name, description or tags.

        Every field is optional — an omitted one is left alone — and there is
        deliberately no ``visibility`` argument: the server does not let a patch
        change it. Unlike :meth:`ContextEntriesApi.update` and
        ``client.agents.update``, this write carries NO revision and NO
        precondition: it is last-write-wins.

        :param id: The `ctx_…` id.
        :param name: The new name.
        :param description: The new description; ``""`` clears it.
        :param tags: The new tags; ``[]`` clears them.
        :returns: The patched collection, unwrapped from ``{collection}``.
        :raises ApiError: `400 invalid_body`.
        :raises ApiError: `404 not_found`.
        """
        response = self._host.request(
            "PATCH",
            path("/context-collections/{id}", id=id),
            body=_body(name=name, description=description, tags=tags),
        )
        return unwrap_object(response, "collection")

    def archive(self, id: str) -> Dict[str, Any]:
        """Archive a collection; nothing is ever deleted. Idempotent.

        :param id: The `ctx_…` id.
        :returns: The archived collection (`archivedAt` set), unwrapped from
            ``{collection}``.
        :raises ApiError: `404 not_found`.
        """
        response = self._host.request("POST", path("/context-collections/{id}/archive", id=id))
        return unwrap_object(response, "collection")


class AgentsApi:
    """The `agents` namespace: saved agent DRAFTS.

    Every agent answers ``runnable: false``. There is no Agent runtime, no RAG
    and no chat history in this contract (A22), and no operation here runs one.
    An agent pins immutable versions — ``skills`` as ``[{skillId,
    skillVersionId}]`` and ``context`` as ``[{collectionId, entryId?,
    assetVersionId}]`` — so a later skill upload never changes an existing pin.

    :meth:`create` accepts an incomplete draft on purpose: every field is
    optional and the answer's ``validation`` lists what is missing. :meth:`update`
    is the guarded write — body ``revision`` required, precondition header
    required by the server.
    """

    def __init__(self, host: AgentsStudioHost) -> None:
        """Bind the namespace to the client it issues requests through.

        :param host: The client this namespace issues requests through.
        """
        self._host = host

    def list(self, include_archived: Optional[bool] = None) -> List[Dict[str, Any]]:
        """List the agent drafts visible to the caller.

        Principal-scoped: no project argument, because the route reads none.

        :param include_archived: Include archived drafts.
        :returns: The `agents` array, unwrapped. Every row is ``runnable:
            false``.
        :raises ApiError: `bad_response` when a `2xx` body carries no ``agents``
            array.
        """
        response = self._host.request(
            "GET", "/agents", query={"includeArchived": include_archived}
        )
        return unwrap_list(response, "agents")

    def create(
        self,
        name: Optional[str] = None,
        instructions: Optional[str] = None,
        model_route_id: Optional[str] = None,
        skills: Optional[Sequence[Mapping[str, Any]]] = None,
        context: Optional[Sequence[Mapping[str, Any]]] = None,
        visibility: Optional[str] = None,
        project: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Save a new agent draft. Every field is optional.

        Saving an incomplete draft is allowed: the answer's ``validation`` lists
        what is missing or disallowed, so a caller can build one up over several
        :meth:`update` calls.

        :param name: The draft's display name.
        :param instructions: The draft's instructions; capped at 64 KiB
            server-side.
        :param model_route_id: The model route to bind.
        :param skills: Pins to immutable versions —
            ``[{"skillId": ..., "skillVersionId": ...}]``.
        :param context: Pins to immutable versions —
            ``[{"collectionId": ..., "entryId": ..., "assetVersionId": ...}]``.
        :param visibility: ``private``, ``project`` or ``account``.
        :param project: The project to own the draft. Not this client's default.
        :returns: The new draft, unwrapped from ``{agent}``, carrying
            ``revision``, ``updatedAt``, ``validation`` and ``runnable: false``.
        :raises ApiError: `422 validation_failed` — a malformed body or a
            disallowed pin; ``issues`` rides in the envelope.
        """
        response = self._host.request(
            "POST",
            "/agents",
            body=_body(
                name=name,
                instructions=instructions,
                modelRouteId=model_route_id,
                skills=skills,
                context=context,
                visibility=visibility,
                project=project,
            ),
        )
        return unwrap_object(response, "agent")

    def get(self, id: str) -> Dict[str, Any]:
        """Fetch one agent draft.

        :param id: The `agt_…` id.
        :returns: The draft, unwrapped from ``{agent}``. Carries ``revision``
            and ``updatedAt`` — the two tokens :meth:`update` needs — and
            ``runnable: false``.
        :raises ApiError: `404 not_found`.
        """
        return unwrap_object(self._host.request("GET", path("/agents/{id}", id=id)), "agent")

    def update(
        self,
        id: str,
        revision: int,
        name: Optional[str] = None,
        instructions: Optional[str] = None,
        model_route_id: Optional[str] = None,
        skills: Optional[Sequence[Mapping[str, Any]]] = None,
        context: Optional[Sequence[Mapping[str, Any]]] = None,
        visibility: Optional[str] = None,
        project: Optional[str] = None,
        if_unmodified_since: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Patch an agent draft.

        An omitted field is left alone — this is a patch, unlike
        :meth:`ContextEntriesApi.update`, which replaces an entry's text. Two
        tokens guard it and they are not interchangeable: ``revision`` is the
        body field the server bumps on every accepted write,
        ``if_unmodified_since`` is the ``updatedAt`` precondition header. The
        server requires the header on this route — omitted, the answer is
        ``428 precondition_required`` — so this wrapper never defaults it.

        :param id: The `agt_…` id.
        :param revision: The draft's last-seen revision, passed through
            unchanged. `< 1` or a non-integer is `400 invalid_body`.
        :param name: The new display name.
        :param instructions: The new instructions.
        :param model_route_id: The model route to bind.
        :param skills: The whole new pin list.
        :param context: The whole new pin list.
        :param visibility: ``private``, ``project`` or ``account``.
        :param project: Move the draft to this project.
        :param if_unmodified_since: The exact ``updatedAt`` this client last
            read. Sent as `x-w6w-if-unmodified-since` **only when given** —
            never as an empty string, which the server rejects as
            `400 invalid_precondition`.
        :returns: The patched draft, unwrapped from ``{agent}``; ``runnable``
            stays ``false``.
        :raises ApiError: `409 conflict` — a stale revision or `updatedAt`; the
            envelope carries ``currentRevision`` under ``err.raw["error"]``.
            Recoverable by re-reading and re-sending.
        :raises ApiError: `428 precondition_required` — no precondition header.
        :raises ApiError: `422 validation_failed` — a disallowed pin.
        :raises ApiError: `404 not_found`.
        """
        body = _body(
            revision=revision,
            name=name,
            instructions=instructions,
            modelRouteId=model_route_id,
            skills=skills,
            context=context,
            visibility=visibility,
            project=project,
        )
        response = self._host.request(
            "PATCH",
            path("/agents/{id}", id=id),
            body=body,
            headers=(
                {PRECONDITION_HEADER: if_unmodified_since} if if_unmodified_since else None
            ),
        )
        return unwrap_object(response, "agent")

    def archive(self, id: str) -> Dict[str, Any]:
        """Archive a draft. Idempotent; there is no agent delete or purge op.

        :param id: The `agt_…` id.
        :returns: The archived draft (``archived: true``), unwrapped from
            ``{agent}``.
        :raises ApiError: `404 not_found`.
        """
        return unwrap_object(
            self._host.request("POST", path("/agents/{id}/archive", id=id)), "agent"
        )
