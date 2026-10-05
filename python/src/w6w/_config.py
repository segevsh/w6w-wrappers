"""Configuration resolution: what server, what credential, what project.

This module turns whatever the caller supplied — plus the environment, read
through the single seam in `_env.py` — into one plain :class:`ResolvedConfig`
value. It is resolved **once, at client construction**, and handed to the
transport; nothing downstream re-reads the environment.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Callable, Mapping, Optional, Union
from urllib.parse import urlsplit

from ._env import ENV_BASE_URL, ENV_TOKEN, read_env
from .errors import ApiError, ConfigError

#: A per-request token supplier.
#:
#: Called **fresh on every request** — never cached, never resolved once at
#: construction — with **no arguments** on an ordinary call and with
#: ``force_refresh=True`` exactly once, on the single recovery retry a `401`
#: with code `"unauthorized"` triggers (`docs/implementation.md` §3). Unlike
#: the node lane, this is **sync-only** (R-1): there is no `asyncio` anywhere
#: in this package, and a provider that itself needs to await something is the
#: caller's own problem to resolve before handing the value here. A plain
#: `str` token is the degenerate case of this shape and needs no call at all.
TokenProvider = Callable[..., Optional[str]]

#: The API's base path, from the shared contract's `basePath`
#: (`packages/wrappers/endpoints.json`).
#:
#: **Empty since v0.2.0.** The server serves its routes at the ROOT of its own
#: host (``https://api.w6w.io/vars``, not ``.../api/vars`` — the host already
#: says "api"), so there is no prefix to append and :func:`join_base_url`
#: appends nothing. Kept exported, and kept mirroring the contract, so the
#: constant still answers "what does this client prepend?" — now "nothing".
BASE_PATH: str = ""

#: The schemes a w6w base URL may use. Anything else is a configuration
#: mistake — most often a bare `host:port` that `urlsplit` reads as a scheme.
ALLOWED_SCHEMES = ("http", "https")

#: Characters that may never appear in an HTTP header value. CR and LF are
#: header injection; NUL and the rest are rejected with them rather than left to
#: fail somewhere deeper. HTAB is technically legal in a field-value and is
#: rejected too — it cannot appear in a bearer token for any good reason.
_CONTROL_CHARS_RE = re.compile(r"[\x00-\x1f\x7f]")


@dataclass(frozen=True)
class ResolvedConfig:
    """Configuration after resolution — the value the transport runs on.

    Held as **instance** state on the client, never in a module-level variable:
    two clients in one process must be able to hold different credentials and
    point at different servers with no interference
    (`docs/implementation.md` §2). Frozen, so nothing downstream can mutate a
    client's identity in place.
    """

    #: The normalized base, e.g. `https://api.example.com`. Never
    #: trailing-slashed, never relative.
    base_url: str
    #: The bearer token or supplier, or `None` when none was configured.
    token: Union[str, TokenProvider, None] = None
    #: Opt-in one-shot 401 recovery. Defaults to `False`.
    refresh_on_unauthorized: bool = False
    #: Terminal-401 callback, or `None` when none was configured.
    on_unauthorized: Optional[Callable[[ApiError], None]] = None
    #: Default headers sent with every request. Defaults to `{}`.
    headers: Mapping[str, str] = field(default_factory=dict)
    #: Default project id for the project-scoped operations, or `None`.
    project: Optional[str] = None


def join_base_url(origin: str) -> str:
    """Validate a configured origin and join it with the API base path.

    **This is the one and only base-URL code path.** `resolve_config` calls this
    function and does no normalising of its own, so a caller who imports the
    helper gets exactly the answer their client will use — including the same
    errors. A helper that were merely *similar* to the client's path (skipping
    the whitespace trim, say) would answer differently for the same input, which
    is worse than having no helper at all.

    The join rule is pinned by `docs/implementation.md` §2 and mirrors the house
    helper the operator console already uses against this same API, so every
    client agrees on what `W6W_BASE_URL` means:

    1. strip surrounding whitespace, then **all** trailing slashes;
    2. reject anything that is not an absolute `http`/`https` URL;
    3. append nothing — the API is served at the root of its own host.

    ::

        https://api.example.com      -> https://api.example.com
        https://api.example.com/     -> https://api.example.com
        https://api.example.com///   -> https://api.example.com

    Any path in the configured value is preserved verbatim, so a deployment
    that genuinely sits behind a gateway prefix can still be addressed by
    configuring that prefix. This is also why a stale
    ``https://api.example.com/api`` is NOT silently rewritten: it is
    indistinguishable from such a prefix, and quietly stripping it would break
    the deployments that mean it. It will 404 — the announced break for the
    v0.1.x base path.

    Step 2 exists because a **relative** base URL must fail *here*, as
    configuration, with a message about configuration. Without an absoluteness
    check, ``W6W_BASE_URL=/foo`` would walk straight past blank-is-absent
    (`_env.read_env`) and then fail on the first request as "the server may be
    down" — the same hole, reopened by another route, and misdiagnosed.

    :param origin: The configured origin. Surrounding whitespace and trailing
        slashes are tolerated.
    :returns: The normalized base URL.
    :raises ConfigError: When the origin is blank, relative, or not http(s).
    """
    trimmed = origin.strip().rstrip("/")
    if not trimmed:
        raise ConfigError(
            "No w6w base URL is configured. Pass one to the client "
            '(Client(base_url="https://api.example.com")) or set the '
            "{env} environment variable. It holds the server's origin, e.g. "
            '"https://api.example.com" — the API is served at its root, so no '
            "path is appended.".format(env=ENV_BASE_URL),
        )

    split = urlsplit(trimmed)
    if split.scheme not in ALLOWED_SCHEMES or not split.netloc:
        raise ConfigError(
            "The w6w base URL {value!r} is not an absolute http(s) URL. "
            "{env} holds an ORIGIN, e.g. \"https://api.example.com\" — scheme "
            "and host. A relative or host-only value cannot be requested and "
            "would fail later as a connection problem rather than as the "
            "configuration mistake it is.".format(value=trimmed, env=ENV_BASE_URL),
        )

    return trimmed


def resolve_config(
    base_url: Optional[str] = None,
    token: Union[str, TokenProvider, None] = None,
    project: Optional[str] = None,
    environ: Optional[Mapping[str, str]] = None,
    refresh_on_unauthorized: bool = False,
    on_unauthorized: Optional[Callable[[ApiError], None]] = None,
    headers: Optional[Mapping[str, str]] = None,
) -> ResolvedConfig:
    """Resolve explicit arguments and the environment into one config value.

    Precedence is **explicit argument > environment variable**, always; there is
    no default base URL. The two sides of that chain treat emptiness
    *asymmetrically*, on purpose (`docs/implementation.md` §2, Precedence):

    - An explicitly passed empty string is an **explicit value**, not "unset".
      It does not fall through to the environment — a caller who wrote
      ``base_url=""`` gets the configuration error, not a value the wrapper went
      looking for behind their back. (It is still not a usable base URL, so the
      error is the same one either way.)
    - An **empty or whitespace-only environment variable is ABSENT** and falls
      through (see `_env.read_env`), so ``W6W_BASE_URL=``, ``W6W_BASE_URL="  "``
      and an unset ``W6W_BASE_URL`` all end here, in the same configuration
      error — never in a relative base.

    The difference is the difference between a value a *caller* chose and a
    value a *shell* produced.

    :param base_url: Explicit origin; `None` consults `W6W_BASE_URL`.
    :param token: Explicit bearer token, or a :data:`TokenProvider` called
        fresh on every request — a plain `str` is sent verbatim, exactly as
        before. `None` consults `W6W_TOKEN`, which stays a plain string: there
        is no environment-variable spelling of a supplier.
    :param project: Default project id for the `documents.*` operations. There
        is no environment variable for it, and no `vars.*` operation takes one —
        vars are not project-scoped (`docs/implementation.md` §7).
    :param environ: Environment mapping override, for tests.
    :param refresh_on_unauthorized: Opt in to a single, one-shot recovery when
        a request fails with `401`/`unauthorized`: the provider (which must be
        callable for this to do anything) is called once more with
        `force_refresh=True`, and if that yields a usable value the SAME
        request is re-sent once with it. Off by default.
    :param on_unauthorized: Called with the terminal `401`/`unauthorized`
        :class:`ApiError`, at most once per call, never on success.
    :param headers: Default headers sent with every request — the **base** any
        per-request `headers` argument builds on; neither can displace the
        bearer this transport attaches.
    :returns: The resolved configuration.
    :raises ConfigError: When no usable base URL was supplied, naming
        `W6W_BASE_URL`.
    """
    raw_base_url = base_url if base_url is not None else read_env(ENV_BASE_URL, environ)
    return ResolvedConfig(
        # Every normalisation, emptiness test and validation lives in
        # `join_base_url` — one code path, so the exported helper and the client
        # can never answer differently for the same input.
        base_url=join_base_url(raw_base_url or ""),
        token=token if token is not None else read_env(ENV_TOKEN, environ),
        refresh_on_unauthorized=refresh_on_unauthorized,
        on_unauthorized=on_unauthorized,
        headers=dict(headers) if headers is not None else {},
        project=project,
    )


def require_token(config: ResolvedConfig, force_refresh: bool = False) -> str:
    """Return the configured token, or raise a :class:`ConfigError` naming `W6W_TOKEN`.

    A client may be *constructed* without a token so that a CLI's `--help` and
    `--version` work offline; the error surfaces on the first request instead.
    There are no anonymous operations in this surface
    (`docs/implementation.md` §2).

    **Resolved fresh every call, never cached.** When `config.token` is
    callable (a :data:`TokenProvider`) it is called right here — a plain `str`
    is the degenerate case that needs no call at all. The call is made with
    **no arguments** unless `force_refresh` is `True`, in which case it is
    called as ``token(force_refresh=True)`` — the one and only seam `_request`'s
    recovery retry uses (`docs/implementation.md` §3). A provider that does not
    accept that keyword simply never needs to: ordinary resolution never passes
    it.

    A blank token counts as no token, for the same reason a blank base URL does:
    ``W6W_TOKEN=`` is how a shell or a Dockerfile spells "I meant to set this and
    did not", and ``Authorization: Bearer `` would turn that into an opaque 401
    instead of the one message that explains it. The same rule applies to
    whatever a provider returns: nullish or blank is treated exactly like a
    nullish/blank static token — the error never echoes the value either way.

    **The token is also validated as a header value, here, by this package.**
    A token carrying CR or LF is HTTP header injection — everything after the
    newline becomes an attacker-chosen header or request line — and it arrives
    the way secrets usually do: `$(cat token.txt)` with a trailing newline, a
    copy-paste out of a UI, a CI variable spanning two lines. This check is not
    delegated to the runtime on purpose. `http.client` does reject CR/LF, but
    only when the request is actually *sent*, and it raises a bare `ValueError`
    from outside this package's error model — so an injected token would sail
    through every unit test in this suite (which never sends), and in production
    would surface as an exception a caller has no reason to be catching. NUL and
    the other control characters are rejected alongside them.

    The offending character is reported by codepoint and position; **the token
    itself is never echoed**, because this message lands in logs.

    :param config: The resolved configuration.
    :param force_refresh: Forwarded to a callable `token` as the
        `force_refresh` keyword; unused for a plain `str` one.
    :returns: The configured token, verbatim.
    :raises ConfigError: When no non-blank token is configured, or when the
        token cannot be sent as a header value.
    """
    token = config.token
    if callable(token):
        raw: Optional[str] = token(force_refresh=True) if force_refresh else token()
    else:
        raw = token

    if raw is None or not raw.strip():
        raise ConfigError(
            "No w6w API token is configured. Pass one to the client "
            '(Client(token="...")) or set the {env} environment variable. '
            "Every w6w API operation is authenticated.".format(env=ENV_TOKEN),
        )

    control = _CONTROL_CHARS_RE.search(raw)
    if control is not None:
        raise ConfigError(
            "The configured w6w API token contains a control character "
            "(U+{code:04X}) at position {index}, so it cannot be sent as an "
            "Authorization header — a carriage return or newline in a header "
            "value is header injection. Check {env} for a stray newline (a "
            "token read from a file usually has one).".format(
                code=ord(control.group()),
                index=control.start(),
                env=ENV_TOKEN,
            ),
        )
    try:
        # http.client encodes header values as latin-1; anything else would
        # raise a UnicodeEncodeError from deep inside the send path.
        raw.encode("latin-1")
    except UnicodeEncodeError as err:
        raise ConfigError(
            "The configured w6w API token contains a non-latin-1 character at "
            "position {index}, so it cannot be sent as an Authorization header. "
            "Check {env}.".format(index=err.start, env=ENV_TOKEN),
        ) from None

    return raw
