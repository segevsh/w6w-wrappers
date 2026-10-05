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
from typing import Any, Dict, Optional

from ._config import resolve_config
from ._http import Transport, _request, default_transport
from .errors import ConfigError


def _required(value: str, field: str) -> None:
    """Raise unless `value` is non-blank after stripping."""
    if not value.strip():
        raise ConfigError("exchange_token: `{field}` must not be blank.".format(field=field))


def _basic_auth_header(client_id: str, client_secret: str) -> str:
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
            "exchange_token: `client_id` must not contain \":\" — the server "
            "splits a decoded Basic credential on the FIRST colon, so a colon "
            "in `client_id` would be read as part of the secret instead."
        )
    try:
        raw = "{0}:{1}".format(client_id, client_secret).encode("latin-1")
    except UnicodeEncodeError:
        raise ConfigError(
            "exchange_token: `client_id`/`client_secret` must be "
            "representable as latin-1 (ISO-8859-1) — the server decodes the "
            "Basic header with `atob`, which cannot represent a wider "
            "character set."
        ) from None
    return base64.b64encode(raw).decode("ascii")


def exchange_token(
    base_url: str,
    client_id: str,
    client_secret: str,
    subject: str,
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
        Same rules as :func:`w6w._config.resolve_config`'s own `base_url` —
        an absolute `http(s)` URL with a host.
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
        :func:`w6w._http.default_transport` (`urllib.request.urlopen`).
    :returns: The parsed response body: ``{"token", "user": {"subject",
        "tenant", "role", "account"}, "expiresIn"}``.
    :raises ConfigError: Blank `client_id`/`client_secret`/`subject`; a
        `client_id` containing `:`; a `client_id`/`client_secret` outside
        latin-1; no base URL.
    :raises ApiError: ``invalid_client`` (401, unknown/disabled credentials),
        ``invalid_body`` / ``invalid_subject`` / ``invalid_account`` (400), or
        any of the transport's own failure modes (`._http`). Never retried:
        this call always passes ``require_auth=False``, which `_request`
        never grants a recovery attempt for.
    """
    _required(client_id, "client_id")
    _required(client_secret, "client_secret")
    _required(subject, "subject")
    basic = _basic_auth_header(client_id, client_secret)

    config = resolve_config(base_url=base_url)

    body: Dict[str, str] = {"subject": subject}
    if account is not None:
        body["account"] = account

    res = _request(
        config,
        transport if transport is not None else default_transport,
        "POST",
        "/auth/exchange",
        body=body,
        headers={"Authorization": "Basic " + basic},
        require_auth=False,
    )
    return res.body
