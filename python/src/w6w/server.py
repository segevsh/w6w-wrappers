"""`w6w.server` — a backend-only token exchange, for a partner embedding w6w
inside its own product.

A **flat module**, following this package's own convention (`team.py`,
`run.py`, …), deliberately **NOT re-exported from `w6w/__init__.py` and NOT
listed in `w6w.__all__`** — reached only as ``import w6w.server`` /
``from w6w.server import exchange_token`` (R-5). Excluded from
`endpoints.json`'s `operations[]` too; see `docs/sdk-surface.md`.

**Egress / trust boundary.** :func:`exchange_token` sends a tenant's client
secret over the wire, once per call, and only as an HTTP Basic credential —
never in the body, the URL or a query string. It is built on this package's
existing transport (`._http._request`, `._config.resolve_config`) with
``require_auth=False`` — the python mirror of the `node` lane's
`requireAuth: false` escape hatch — so this is a thin caller of the one HTTP
path this package has, never a second one.

This function is meant to run on a partner's OWN backend, never shipped to a
browser or a mobile client: the client secret it takes must never reach
end-user code. See the `node` lane's ``README.md`` "Embedding for enterprise
tenants" section for the worked route this is designed to sit behind — the
same shape applies here.
"""

from __future__ import annotations

import base64
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, Optional

from ._config import DEFAULT_BASE_URL, resolve_config
from ._http import Transport, _request, no_redirect_transport
from .errors import ApiError, ConfigError


# ECMAScript `String.prototype.trim()` whitespace set (WhiteSpace + LineTerminator):
# TAB LF VT FF CR SP, NBSP, U+1680, U+2000-U+200A, U+2028, U+2029, U+202F, U+205F,
# U+3000, U+FEFF. The server trims `account` with JS `trim()`, so the session client
# must blank-check and trim with the SAME set, not Python's `str.strip()` (which
# strips U+0085 / U+001C-U+001F that JS keeps, and keeps U+FEFF that JS strips).
JS_WS = (
    "\t\n\v\f\r \u00a0\u1680"
    + "".join(chr(c) for c in range(0x2000, 0x200B))
    + "\u2028\u2029\u202f\u205f\u3000\ufeff"
)


def _required(
    value: str, field: str, who: str = "exchange_token", ws: Optional[str] = None
) -> None:
    """Raise unless `value` is non-blank after stripping. `who` prefixes the
    message (the raw path keeps ``exchange_token``). `ws` is an explicit
    strip-character set (default: Python's `str.strip()` whitespace)."""
    if not value.strip(ws):
        raise ConfigError("{who}: `{field}` must not be blank.".format(who=who, field=field))


def _none_to_blank(value: Optional[str]) -> str:
    """A missing (``None``) required parameter reads as blank so `_required` raises."""
    return "" if value is None else value


def _base_or_default(base_url: Optional[str]) -> str:
    """`base_url`, or :data:`DEFAULT_BASE_URL` when omitted. Never consults the env."""
    return DEFAULT_BASE_URL if base_url is None else base_url


def _required_text(value: Any, field: str, who: str, ws: Optional[str] = None) -> None:
    """:func:`_required`, but a non-string is a :class:`ConfigError` too."""
    if not isinstance(value, str):
        raise ConfigError(
            "{who}: `{field}` must be a non-blank string.".format(who=who, field=field)
        )
    _required(value, field, who, ws)


def _basic_auth_header(client_id: str, client_secret: str, who: str = "exchange_token") -> str:
    """Base64-encode ``client_id:client_secret`` the way the server decodes it:
    latin-1 (the alphabet `atob` reads), via ``str.encode("latin-1")``.

    Never re-implemented with a UTF-8 path: a secret containing a non-ASCII
    latin-1 character (e.g. ``"é"``) would base64 to a DIFFERENT value under
    UTF-8, and the server's `atob`-based decode could never read it back to
    the same bytes.

    :raises ConfigError: When `client_id` contains `:` (indistinguishable from
        the Basic separator on decode) or either value is not latin-1.
    """
    if ":" in client_id:
        raise ConfigError(
            who + ": `client_id` must not contain \":\" — the server "
            "splits a decoded Basic credential on the FIRST colon, so a colon "
            "in `client_id` would be read as part of the secret instead."
        )
    try:
        raw = "{0}:{1}".format(client_id, client_secret).encode("latin-1")
    except UnicodeEncodeError:
        raise ConfigError(
            who + ": `client_id`/`client_secret` must be "
            "representable as latin-1 (ISO-8859-1) — the server decodes the "
            "Basic header with `atob`, which cannot represent a wider "
            "character set."
        ) from None
    return base64.b64encode(raw).decode("ascii")


def exchange_token(
    base_url: Optional[str] = None,
    client_id: Optional[str] = None,
    client_secret: Optional[str] = None,
    subject: Optional[str] = None,
    account: Optional[str] = None,
    transport: Optional[Transport] = None,
) -> Dict[str, Any]:
    """Exchange a tenant's client credentials for a short-lived, per-user w6w
    token: ``POST /auth/exchange``.

    Credentials travel ONLY as
    ``Authorization: Basic base64(client_id:client_secret)`` — never in the
    body, the URL or a query string. The body sent is exactly
    ``{"subject": subject}``, or ``{"subject": subject, "account": account}``
    when `account` is given; omitting `account` never puts the key in the
    body at all (not even as `null`).

    Every validation failure below is a local :class:`ConfigError`, raised
    **before any network call**, and none of them ever echo `client_secret`.

    :param base_url: The w6w server's origin, e.g. ``"https://api.example.com"``.
        Omitted (``None``) it is :data:`w6w.DEFAULT_BASE_URL`
        (``https://api.w6w.io``) — this helper NEVER reads ``W6W_BASE_URL``. An
        explicit value follows the same rules as `resolve_config`'s own
        `base_url`: an absolute `http(s)` URL with a host; blank is an error.
    :param client_id: The tenant's client id. Must not contain `:` or a
        non-latin-1 character.
    :param client_secret: The tenant's client secret. Must be latin-1
        encodable.
    :param subject: The partner's end-user id. Minted into the returned
        token's `sub` claim verbatim — this function does not validate or
        canonicalise it.
    :param account: Optional account claim. **Trusted verbatim**: the server
        mints whatever `account` it is given into the token, so this
        function's own caller — the partner's backend — is responsible for
        deriving it from ITS OWN membership data, never from an
        unauthenticated client input.
    :param transport: Transport override. Defaults to
        :func:`w6w._http.no_redirect_transport` — stdlib `urllib` that
        never follows a redirect, so a 3xx raises `ApiError` and the Basic client
        credential is never re-sent to another host.
    :returns: The parsed response body: ``{"token", "user": {"subject",
        "tenant", "role", "account"}, "expiresIn"}``.
    :raises ConfigError: Blank `client_id`/`client_secret`/`subject`; a
        `client_id` containing `:`; a `client_id`/`client_secret` outside
        latin-1; a blank/relative explicit `base_url`.
    :raises ApiError: ``invalid_client`` (401, unknown/disabled credentials),
        ``invalid_body`` / ``invalid_subject`` / ``invalid_account`` (400), or
        any of the transport's own failure modes (`._http`). Never retried:
        this call always passes ``require_auth=False``, which `_request`
        never grants a recovery attempt for.
    """
    _required(_none_to_blank(client_id), "client_id")
    _required(_none_to_blank(client_secret), "client_secret")
    _required(_none_to_blank(subject), "subject")
    assert client_id is not None and client_secret is not None and subject is not None
    basic = _basic_auth_header(client_id, client_secret)

    # Default here, never via `resolve_config(base_url=None)`, which reads the env.
    config = resolve_config(base_url=_base_or_default(base_url))

    body: Dict[str, str] = {"subject": subject}
    if account is not None:
        body["account"] = account

    res = _request(
        config,
        transport if transport is not None else no_redirect_transport,
        "POST",
        "/auth/exchange",
        body=body,
        headers={"Authorization": "Basic " + basic},
        require_auth=False,
    )
    return res.body


_SESSION = "EmbedSessionClient"
_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


def _iso_utc_ms(epoch_ms: int) -> str:
    """``YYYY-MM-DDTHH:MM:SS.mmmZ`` — the format JS ``toISOString`` produces."""
    moment = _EPOCH + timedelta(milliseconds=epoch_ms)
    return moment.strftime("%Y-%m-%dT%H:%M:%S") + ".{0:03d}Z".format(moment.microsecond // 1000)


class EmbedSessionClient:
    """An account-scoped session minter bound to one set of tenant credentials.

    Holds the credentials per instance and mints one account-scoped token per
    :meth:`create`. A thin layer over :func:`exchange_token`, which stays the
    only HTTP path. Backend-only, like :func:`exchange_token`; not re-exported
    from ``w6w/__init__.py``.

    :param base_url: The w6w server's origin. Omitted (``None``) it is
        :data:`w6w.DEFAULT_BASE_URL` (``https://api.w6w.io``); like
        :func:`exchange_token` this never reads ``W6W_BASE_URL``. Blank is an error.
    :param client_id: The tenant's client id (no `:`, latin-1 only).
    :param client_secret: The tenant's client secret. Never returned or put in a
        message.
    :param transport: Transport override, passed through to
        :func:`exchange_token`.
    :param now: Epoch-SECONDS clock, sampled before each request. Defaults to
        :func:`time.time`.
    :raises ConfigError: A blank explicit `base_url`, missing/blank/non-string credentials, a `client_id` containing `:`, or
        non-latin-1 credentials.
    """

    def __init__(
        self,
        base_url: Optional[str] = None,
        client_id: Optional[str] = None,
        client_secret: Optional[str] = None,
        *,
        transport: Optional[Transport] = None,
        now: Optional[Callable[[], float]] = None,
    ) -> None:
        if base_url is not None:
            _required_text(base_url, "base_url", _SESSION)
        _required_text(client_id, "client_id", _SESSION)
        _required_text(client_secret, "client_secret", _SESSION)
        _basic_auth_header(client_id, client_secret, _SESSION)
        base_url = _base_or_default(base_url)
        resolve_config(base_url=base_url)
        self._base_url = base_url
        self._client_id = client_id
        self._client_secret = client_secret
        self._transport = transport
        self._now = now if now is not None else time.time

    def __repr__(self) -> str:
        return "EmbedSessionClient(base_url={0!r})".format(self._base_url)

    def create(self, subject: str, account_ref: str) -> Dict[str, Any]:
        """Mint one account-scoped session: exactly one ``POST /auth/exchange``.

        `subject` is sent verbatim (never trimmed); `account_ref` is trimmed and
        sent as the wire ``account``. Both must be non-blank strings.

        :returns: ``{"token", "expiresIn", "expiresAt", "subject", "tenant",
            "account", "accountRef"}`` — exactly those seven keys (camelCase, like
            :func:`exchange_token`'s body). `account` is the server's resolved
            ``acct_…`` id; `accountRef` the trimmed ref that was sent.
        :raises ConfigError: A non-string or blank `subject` / `account_ref`
            (no request is made).
        :raises ApiError: Any server or transport failure, unwrapped.
        """
        _required_text(subject, "subject", _SESSION, JS_WS)
        _required_text(account_ref, "account_ref", _SESSION, JS_WS)
        account = account_ref.strip(JS_WS)

        t0 = self._now()
        res = exchange_token(
            self._base_url,
            self._client_id,
            self._client_secret,
            subject,
            account=account,
            transport=self._transport,
        )

        user = res.get("user") if isinstance(res, dict) else None
        expires_in = res.get("expiresIn") if isinstance(res, dict) else None
        try:
            if isinstance(expires_in, bool) or not isinstance(expires_in, (int, float)):
                raise ValueError
            expires_at = _iso_utc_ms(int(round(t0 * 1000 + expires_in * 1000)))
            if (
                not isinstance(res.get("token"), str)
                or not isinstance(user, dict)
                or not isinstance(user.get("subject"), str)
                or not isinstance(user.get("tenant"), str)
                or not isinstance(user.get("account"), str)
            ):
                raise ValueError
        except (ValueError, OverflowError):
            raise ApiError(
                200,
                "bad_response",
                _SESSION + ": the exchange response was not the documented shape.",
            ) from None
        return {
            "token": res["token"],
            "expiresIn": expires_in,
            "expiresAt": expires_at,
            "subject": user["subject"],
            "tenant": user["tenant"],
            "account": user["account"],
            "accountRef": account,
        }
