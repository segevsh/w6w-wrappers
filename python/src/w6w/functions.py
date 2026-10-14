"""`client.functions.*` — run a Function by the name you gave it.

A Function is a canonical, vendor-stable interface bound to one swappable app
Action. Before this namespace existed, calling one meant the URN operation::

    client.run("fn_a9b39917-cd4e-4eea-ab89-c3d079684193", payload=payload)

— an opaque id for a Function the user named ``send-email``. ``client.run`` is
still the right tool when the caller is *dispatching* something whose kind it
does not know; it is the wrong tool for "call my send-email Function"::

    client.functions.run("send-email", payload={"to": to, "subject": subject})

The name is the FIRST argument, matching ``workflows.run(id, ...)`` — the
namespace already shaped this way — so all three runnable kinds read alike.

── The rest of the namespace ──
`list`, `get`, `create`, `update` and `delete` complete the definition lifecycle,
mirroring `client.workflows.*` op for op with one difference the server
dictates, not this package: there is no `?project=` anywhere on this domain.
`archive` comes before `delete`, exactly as for workflows.

The server has ONE write route (`POST /functions`, an upsert), so `create` and
`update` are the same request shaped differently — `create` mints the required
`id`, `update` pins the one you addressed — and `update` is a full replacement
rather than a patch.

ID OR KEY, one argument. The server's ``/functions/{idOrKey}/invoke`` accepts
either, because the two shapes cannot collide: an id carries a kind prefix and
therefore an underscore, and a key is a kebab-slug, which forbids one. So this
takes no flag and no prefix to say which you meant — pass whichever you have.
"""

from __future__ import annotations

from typing import Any, Dict, List, Mapping, Optional, Protocol

from ._config import ResolvedConfig
from ._http import HttpResponse, path
from .errors import ApiError
from .types import (
    FunctionDetail,
    FunctionSummary,
    SaveResult,
    mint_id,
    require_object,
    unwrap_list,
    unwrap_object,
)


class FunctionsHost(Protocol):
    """The slice of `Client` this namespace needs.

    Structural rather than a concrete client type, so the namespace stays
    independently constructible in a test and this module never imports the
    client back.
    """

    #: The resolved configuration.
    config: ResolvedConfig

    def request(
        self,
        method: str,
        path: str,
        query: Optional[Mapping[str, Any]] = None,
        body: Optional[Any] = None,
    ) -> HttpResponse:
        """Perform one request."""
        ...


class FunctionsApi:
    """The `functions` namespace on a :class:`~w6w.client.Client`.

    Example::

        output = client.functions.run(
            "send-email",
            payload={"to": "ada@example.com", "subject": "Hi"},
        )

        # The definition lifecycle.
        fns = client.functions.list()
        detail = client.functions.get(fns[0].id)
        client.functions.update(
            fns[0].id, {**detail.function, "description": "Send an email"}
        )
    """

    def __init__(self, host: FunctionsHost) -> None:
        """Bind the namespace to the client it issues requests through.

        :param host: The client this namespace issues requests through.
        """
        self._host = host

    def run(
        self,
        name: str,
        payload: Optional[Mapping[str, Any]] = None,
        allow_unpublished: bool = False,
    ) -> Any:
        """Run one Function and return its output.

        Returns the Function's OUTPUT, not an envelope. ``client.run`` returns a
        kind-discriminated envelope because the caller does not know what the
        URN will resolve to; here the kind is in the method name, so the
        discriminant would be a field the caller unwraps to learn nothing.

        :param name: The Function's key (``"send-email"``) or its ``fn_…`` id.
            Percent-encoded into the path.
        :param payload: The Function's canonical inputs. Sent as ``{}`` when
            omitted rather than left out — the server's parameter schemas are
            written against an object, and ``{}`` says "no input" where an
            absent key says "I forgot".
        :param allow_unpublished: Run the **stored** definition even though it
            was never published — the draft run. A disabled Function is still
            refused. It runs the row exactly as last saved, never a definition
            you submit here, so save first. Sent as `allowUnpublished: true` in
            the body **only when true**; `False` is the same as omitting it.
            Not accepted by :meth:`run_version`.
        :returns: The Function's output, verbatim.
        :raises ConfigError: When no token is configured.
        :raises ApiError: ``404 unknown_function`` when no Function of that name
            exists for the caller.
        :raises ApiError: ``422 function_incomplete`` when the Function has no
            runnable ``impl``.
        :raises ApiError: ``bad_response`` when a `2xx` body carries no
            ``output`` key at all.
        """
        return self._invoke(path("/functions/{name}/invoke", name=name), payload, allow_unpublished)

    def run_version(
        self,
        id: str,
        n: int,
        payload: Optional[Mapping[str, Any]] = None,
    ) -> Any:
        """Run ONE published version of a Function instead of the live row.

        Same body and output unwrapping as :meth:`run`. The wire verb is
        `invoke`: `POST /functions/{id}/versions/{n}/invoke`. There is no
        `allow_unpublished` — a version is published by definition.

        :param id: The `fn_…` id.
        :param n: The 1-based version number.
        :param payload: The Function's canonical inputs; `{}` when omitted.
        :returns: The Function's output, verbatim.
        :raises ApiError: `404 unknown_version`, `404 unknown_function`,
            `422 function_incomplete` / `function_disabled` /
            `function_not_published`, `400 invalid_version`.
        """
        return self._invoke(path("/functions/{id}/versions/{n}/invoke", id=id, n=n), payload, False)

    def _invoke(
        self,
        invoke_path: str,
        payload: Optional[Mapping[str, Any]],
        allow_unpublished: bool,
    ) -> Any:
        """The one POST both :meth:`run` and :meth:`run_version` go through, so
        the output guard cannot drift between them.

        :param invoke_path: The already-encoded path.
        :param payload: The canonical inputs, if any.
        :param allow_unpublished: Sent only when `True`.
        :returns: The Function's output.
        """
        body: Dict[str, Any] = {"inputs": dict(payload) if payload is not None else {}}
        if allow_unpublished is True:
            body["allowUnpublished"] = True
        response = self._host.request("POST", invoke_path, body=body)

        # Deliberately NOT the shared `unwrap` helper. That treats `None` as
        # "the server did not send what it promised" — correct for a `documents`
        # envelope, where null is never a document. It is wrong here: a
        # Function's output is an OPAQUE pass-through, and an action that
        # returns nothing yields `{"output": null}`, which is a successful run.
        # So the guard is PRESENCE of the key, not truthiness of the value.
        body = response.body
        if not isinstance(body, dict) or "output" not in body:
            raise ApiError(
                response.status,
                "bad_response",
                f'Server returned a {response.status} with no "output" in the response body.',
                body,
            )
        return body["output"]

    def list(self) -> List[FunctionSummary]:
        """List the caller's Function definitions.

        This is how a caller discovers a `key` to pass to :meth:`run` — the same
        job `workflows.list` and `connections.list` do for their own ids (D4),
        and the reason a read-only integration needs no other access.

        Each row already carries `valid`, computed server-side; there is no
        second call to make to find out whether a Function is runnable.

        **No `project` parameter.** Unlike workflows and documents, the route
        reads no `?project=` at all (`admin/functions.ts`) — sending one would be
        inventing a parameter, which is the failure mode `endpoints.json` warns
        about.

        :returns: The Functions, unwrapped from the `functions` envelope.
        :raises ConfigError: When no token is configured.
        :raises ApiError: On any non-2xx.
        :raises ApiError: `bad_response` when a `2xx` body carries no
            `functions` list.
        """
        response = self._host.request("GET", "/functions")
        return [FunctionSummary.from_wire(item) for item in unwrap_list(response, "functions")]

    def get(self, id: str) -> FunctionDetail:
        """Fetch one Function's stored definition.

        Returns the whole body — `function` and `valid` — rather than splicing
        `valid` into the definition. See :class:`w6w.types.FunctionDetail` for
        why that placement matters on the way back OUT of this method.

        The definition itself stays a plain `dict`: its interesting field is
        `impl`, and that is a union the server extends (an app Action today,
        another Function or a Workflow since D-8, `rfcs/function.md`). A wrapper
        that modelled it would reject an arm a newer server accepts, and the
        whole point of a Function is that `impl` is the part you swap.

        :param id: The `fn_…` id, or the Function's `key`. Percent-encoded into
            the path by :func:`w6w.path`.
        :returns: The definition and the server's runnability verdict.
        :raises ConfigError: When no token is configured.
        :raises ApiError: `404 unknown_function` when there is no such Function
            for this caller.
        """
        response = self._host.request("GET", path("/functions/{id}", id=id))
        return FunctionDetail.from_wire(require_object(response, "a function"))

    def create(self, definition: Mapping[str, Any]) -> SaveResult:
        """Create a Function.

        **The id is minted client-side when the definition does not carry one** —
        `POST /functions` requires `id` and never generates one, exactly as the
        workflow route does. `key` is NOT minted: it is the name the Function is
        called by, so it is the caller's to choose, and the server validates it
        on first save only (3–39 characters, lowercase, single hyphens, no `_`).
        That grammar is what keeps `/functions/{idOrKey}/invoke` unambiguous — a
        key containing `_` could be mistaken for an `fn_…` id.

        `create` and :meth:`update` reach the SAME upsert route; posting a
        definition whose id already exists overwrites it.

        :param definition: The whole Function definition, forwarded verbatim
            apart from a minted `id`.
        :returns: The new Function's id and key.
        :raises ConfigError: When no token is configured.
        :raises ApiError: `400 invalid_function` — no `key`, no `inputs` array,
            or a malformed `impl`.
        :raises ApiError: `409 function_conflict` — another `(tenant, subject)`
            already owns that id.
        :raises ApiError: `409 function_key_conflict` — that `key` is already
            taken in this scope.
        """
        body = dict(definition)
        if not isinstance(body.get("id"), str) or not body["id"]:
            body["id"] = mint_id("fn")
        return self._save(body)

    def update(self, id: str, definition: Mapping[str, Any]) -> SaveResult:
        """Overwrite a Function's stored definition.

        **A full replacement, not a patch** — the server has one write route and
        it stores what it is given, so read with :meth:`get`, change what you
        mean to change, and send the whole thing back. There is no concurrency
        precondition on this route (workflows have one; Functions do not), so
        the write is last-write-wins.

        `id` comes from the FIRST ARGUMENT and is pinned into the body,
        overriding any `id` the definition carries — otherwise
        ``update("fn_a", def_of_b)`` would quietly write to B.

        Do not send back the `valid` field: it is not part of the stored
        document, and :meth:`get` deliberately leaves it outside the definition
        so that a read-modify-write round trip cannot pick it up by accident.

        :param id: The `fn_…` id to write to.
        :param definition: The whole replacement definition.
        :returns: The Function's id and key.
        :raises ConfigError: When no token is configured.
        :raises ApiError: `400 invalid_function` — structurally invalid body.
        :raises ApiError: `409 function_conflict` — another `(tenant, subject)`
            owns this id.
        :raises ApiError: `409 function_key_conflict` — the new `key` is already
            taken in this scope.
        """
        body = dict(definition)
        body["id"] = id
        return self._save(body)

    def archive(self, id: str) -> Dict[str, Any]:
        """Archive a Function.

        One-way: there is no unarchive route. Idempotent — archiving an
        already-archived Function re-returns it unchanged. This is a required
        step: :meth:`delete` of a Function that is not archived is
        `409 function_not_archived`.

        :param id: The `fn_…` id, or the Function's `key`.
        :returns: The archived definition, unwrapped from the `function` envelope.
        :raises ApiError: `404 unknown_function`.
        """
        response = self._host.request("POST", path("/functions/{id}/archive", id=id))
        return unwrap_object(response, "function")

    def list_versions(self, id: str) -> Dict[str, Any]:
        """List a Function's published versions (metadata only).

        :param id: The `fn_…` id.
        :returns: The whole body unchanged: `enabled`, `currentPublishedVersion`
            (`None` before the first publish) and `versions[]`.
        :raises ApiError: `404 unknown_function`.
        """
        response = self._host.request("GET", path("/functions/{id}/versions", id=id))
        return require_object(response, "a version list")

    def get_version(self, id: str, n: int) -> Dict[str, Any]:
        """Fetch one version, definition included.

        :param id: The `fn_…` id.
        :param n: The 1-based version number.
        :returns: The `version` object, unwrapped: `versionNumber`, `createdAt`,
            `createdBy`, `isCurrentPublished`, `definition` (opaque, redacted
            server-side).
        :raises ApiError: `404 unknown_version`, `404 unknown_function`,
            `400 invalid_version`.
        """
        response = self._host.request("GET", path("/functions/{id}/versions/{n}", id=id, n=n))
        return unwrap_object(response, "version")

    def publish(self, id: str) -> Dict[str, Any]:
        """Publish the STORED row as a new version (flush any pending save first).

        Also makes a never-published Function active. No precondition is taken.

        :param id: The `fn_…` id.
        :returns: The whole body: `{version: {...}, currentPublishedVersion}`.
        :raises ApiError: `404 unknown_function`.
        """
        response = self._host.request("POST", path("/functions/{id}/publish", id=id))
        return require_object(response, "a publish result")

    def revert(self, id: str, n: int) -> Dict[str, Any]:
        """Rewrite the live row from version `n`; it does not publish.

        Functions have no concurrency precondition, so a following
        :meth:`update` is last-write-wins.

        :param id: The `fn_…` id.
        :param n: The 1-based version number.
        :returns: The `reverted` object, unwrapped.
        :raises ApiError: `404 unknown_version`, `404 unknown_function`,
            `400 invalid_version`.
        """
        response = self._host.request(
            "POST", path("/functions/{id}/versions/{n}/revert", id=id, n=n)
        )
        return unwrap_object(response, "reverted")

    def enable(self, id: str) -> None:
        """Enable a Function. Idempotent. Returns nothing.

        :param id: The `fn_…` id.
        :raises ApiError: `404 unknown_function`.
        """
        self._host.request("POST", path("/functions/{id}/enable", id=id))

    def disable(self, id: str) -> None:
        """Disable a Function; every run (version and draft runs too) is then
        refused with `function_disabled`. Idempotent. Returns nothing.

        :param id: The `fn_…` id.
        :raises ApiError: `404 unknown_function`.
        """
        self._host.request("POST", path("/functions/{id}/disable", id=id))

    def delete(self, id: str) -> None:
        """Delete a Function.

        Not idempotent, and deliberately so: deleting an id that is not there is
        `404 unknown_function`, not a silent success — the same pin
        `documents.delete` carries.

        **Nothing checks for callers first.** A Function may be referenced by an
        Endpoint, by a Workflow step, or by another Function's `impl` (D-8), and
        the server does not walk those references; they break at call time.
        Deleting a Function that something else calls is the caller's decision to
        get right.

        Returns nothing: the server's `{"ok": true}` carries no information a
        caller can use (`docs/implementation.md` §5).

        :param id: The `fn_…` id, or the Function's `key`.
        :raises ConfigError: When no token is configured.
        :raises ApiError: `404 unknown_function` when there is no such Function
            for this caller.
        """
        self._host.request("DELETE", path("/functions/{id}", id=id))

    def _save(self, body: Dict[str, Any]) -> SaveResult:
        """The one POST both :meth:`create` and :meth:`update` go through.

        Private and shared rather than duplicated: the route answers `201` with
        the id and key under a `function` envelope, and two copies of that
        unwrap is two places for a server change to be half-applied.

        :param body: The complete definition, id already resolved.
        :returns: The saved Function's id and key.
        """
        response = self._host.request("POST", "/functions", body=body)
        return SaveResult.from_wire(unwrap_object(response, "function"))
