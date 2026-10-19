/**
 * `@w6w/sdk/server` — a backend-only token exchange, for a partner embedding
 * w6w inside its own product.
 *
 * A **separate** entry point from the package root (`@w6w/sdk`) and from
 * `@w6w/sdk/console`: deliberately excluded from `endpoints.json`'s
 * `operations[]` and from the root barrel (`../../mod.ts`), documented
 * instead in `docs/sdk-surface.md` (R-5). Nothing here is reachable from
 * either of those entry points, and this module imports nothing from
 * `../console/mod.ts`.
 *
 * **Egress / trust boundary.** {@linkcode exchangeToken} sends a tenant's
 * client secret over the wire, once per call, and only as an HTTP Basic
 * credential — never in the body, the URL or a query string. It is built on
 * the package's existing transport (`../http.ts`'s `request`, `../config.ts`'s
 * `resolveConfig`) with `requireAuth: false` — the same escape hatch
 * `console.auth.login` uses for a route that authenticates itself rather than
 * via a bearer — so this is a thin caller of the one HTTP path this package
 * has, never a second one.
 *
 * This function is meant to run on a partner's OWN backend, never in a
 * browser: the client secret it takes must never reach client-side code. See
 * `README.md`'s "Embedding for enterprise tenants" section for the worked
 * route this is designed to sit behind.
 *
 * @module
 */

import { DEFAULT_BASE_URL, type FetchLike, resolveConfig } from "../config.ts";
import { ApiError, ConfigError } from "../errors.ts";
import { request } from "../http.ts";

/** Options for {@linkcode exchangeToken}. */
export interface ExchangeTokenOptions {
  /**
   * The w6w server's origin, e.g. `https://api.example.com`. Same rules as
   * {@linkcode W6WClientOptions.baseUrl} — an absolute `http(s)` URL with a
   * host. Defaults to {@linkcode DEFAULT_BASE_URL} when omitted; this helper
   * never reads `W6W_BASE_URL`. A blank value is a {@linkcode ConfigError}.
   */
  baseUrl?: string;
  /** The tenant's client id. Must not contain `:` or a non-latin-1 character. */
  clientId: string;
  /** The tenant's client secret. Must be latin-1 encodable. */
  clientSecret: string;
  /**
   * The partner's end-user id. Minted into the returned token's `sub` claim
   * verbatim — this function does not validate or canonicalise it.
   */
  subject: string;
  /**
   * Optional account claim. **Trusted verbatim**: the server mints whatever
   * `account` it is given into the token, so the caller — this function's own
   * caller, on the partner's backend — is responsible for deriving it from
   * ITS OWN membership data, never from an unauthenticated client input. See
   * `README.md`'s embedding example.
   */
  account?: string;
  /** Transport override. Defaults to `globalThis.fetch`, bound. */
  fetch?: FetchLike;
}

/** The shape `POST /auth/exchange` answers with on success. */
export interface ExchangeTokenResult {
  /** The minted, short-lived bearer token. */
  token: string;
  /** The identity the token carries. */
  user: {
    /** The `subject` this call passed, echoed back. */
    subject: string;
    /** The tenant the client credentials resolved to. */
    tenant: string;
    /** Always `"user"` for a token minted this way. */
    role: string;
    /** The server's resolved account id (`acct_…`), never the ref you passed. */
    account: string;
  };
  /** Token lifetime, in seconds. */
  expiresIn: number;
}

/** Non-blank after trimming. `who` prefixes the message (the raw path keeps `exchangeToken`). */
function required(value: string, field: string, who = "exchangeToken"): void {
  if (value.trim().length === 0) {
    throw new ConfigError(`${who}: \`${field}\` must not be blank.`);
  }
}

/** {@linkcode required}, but a non-string is a {@linkcode ConfigError} too, not a TypeError. */
function requiredText(value: unknown, field: string, who: string): void {
  if (typeof value !== "string") {
    throw new ConfigError(`${who}: \`${field}\` must be a non-blank string.`);
  }
  required(value, field, who);
}

/**
 * Base64-encode `clientId:clientSecret` the way the server decodes it:
 * latin-1 (`atob`'s own alphabet), via `btoa`.
 *
 * `btoa` itself rejects any character outside latin-1 (U+0000–U+00FF),
 * raising for us — this is NOT re-implemented with a UTF-8 path, because that
 * would silently encode a secret the server's `atob` could never decode back
 * to the same bytes.
 *
 * @throws {ConfigError} When `clientId` contains `:` (indistinguishable from
 *   the Basic separator on decode) or either value is not latin-1.
 */
function basicAuthHeader(
  clientId: string,
  clientSecret: string,
  who = "exchangeToken",
): string {
  if (clientId.includes(":")) {
    throw new ConfigError(
      `${who}: \`clientId\` must not contain ":" — the server splits a ` +
        "decoded Basic credential on the FIRST colon, so a colon in `clientId` " +
        "would be read as part of the secret instead.",
    );
  }
  try {
    return btoa(`${clientId}:${clientSecret}`);
  } catch {
    throw new ConfigError(
      `${who}: \`clientId\`/\`clientSecret\` must be representable as ` +
        "latin-1 (ISO-8859-1) — the server decodes the Basic header with " +
        "`atob`, which cannot represent a wider character set.",
    );
  }
}

function resolveFetch(fetchOption: FetchLike | undefined): FetchLike {
  if (fetchOption) return fetchOption;
  const global = globalThis.fetch;
  if (typeof global !== "function") {
    throw new ConfigError(
      "This runtime has no global fetch. Pass an implementation " +
        "(exchangeToken({ ..., fetch })) or run on Node 18+, Deno or Bun.",
    );
  }
  // Bound, so it keeps working when called as a bare function reference —
  // exactly W6WClient's own default (../client.ts).
  return global.bind(globalThis);
}

/**
 * Exchange a tenant's client credentials for a short-lived, per-user w6w
 * token: `POST /auth/exchange`.
 *
 * Credentials travel ONLY as `Authorization: Basic base64(clientId:clientSecret)`
 * — never in the body, the URL or a query string. The body sent is exactly
 * `{ subject }`, or `{ subject, account }` when `account` is given; omitting
 * `account` never puts the key in the body at all (not even as `null` or
 * `undefined`).
 *
 * Every validation failure below is a local {@linkcode ConfigError}, raised
 * **before any network call**, and none of them ever echo `clientSecret`.
 *
 * @param options - See {@linkcode ExchangeTokenOptions}.
 * @returns The minted token and the identity it carries.
 * @throws {ConfigError} Blank `clientId`/`clientSecret`/`subject`; a `clientId`
 *   containing `:`; a `clientId`/`clientSecret` outside latin-1; a blank or
 *   malformed `baseUrl`; no runtime `fetch`.
 * @throws {ApiError} `invalid_client` (401, unknown/disabled credentials),
 *   `invalid_body` / `invalid_subject` / `invalid_account` (400), or any of
 *   the transport's own failure modes (`../http.ts`). Never retried: this
 *   call always passes `requireAuth: false`, which `request()` never grants a
 *   recovery attempt.
 */
export async function exchangeToken(
  options: ExchangeTokenOptions,
): Promise<ExchangeTokenResult> {
  const { baseUrl, clientId, clientSecret, subject, account } = options;

  required(clientId, "clientId");
  required(clientSecret, "clientSecret");
  required(subject, "subject");
  const basic = basicAuthHeader(clientId, clientSecret);

  // A defined string never reaches resolveConfig's W6W_BASE_URL fallback: the
  // credentials below go to the explicit host or the default, never an env host.
  const config = resolveConfig({ baseUrl: baseUrl ?? DEFAULT_BASE_URL });
  const fetchImpl = resolveFetch(options.fetch);

  const body: { subject: string; account?: string } = { subject };
  if (account !== undefined) {
    body.account = account;
  }

  const res = await request<ExchangeTokenResult>(config, fetchImpl, {
    method: "POST",
    path: "/auth/exchange",
    body,
    headers: { authorization: `Basic ${basic}` },
    requireAuth: false,
  });
  return res.body;
}

/** Options for {@linkcode createEmbedSessionClient}. */
export interface EmbedSessionClientOptions {
  /**
   * The w6w server's origin. Defaults to {@linkcode DEFAULT_BASE_URL}; like
   * {@linkcode exchangeToken} this factory never reads `W6W_BASE_URL`. A blank
   * value is a {@linkcode ConfigError}.
   */
  baseUrl?: string;
  /** The tenant's client id. Must not contain `:` or a non-latin-1 character. */
  clientId: string;
  /** The tenant's client secret. Held by this instance only; never returned. */
  clientSecret: string;
  /** Transport override, passed through to {@linkcode exchangeToken}. */
  fetch?: FetchLike;
  /** Epoch-milliseconds clock, sampled before each request. Defaults to `Date.now`. */
  now?: () => number;
}

/** Input to {@linkcode EmbedSessionClient.create}. */
export interface CreateEmbedSessionInput {
  /** The signed-in end user's id on the host. Sent verbatim, never trimmed. */
  subject: string;
  /**
   * The host's own reference for the company/workspace the user is acting in
   * (the account's external ref). Required and non-blank: the server silently
   * selects the tenant's default account for a blank one, so this client refuses.
   * It is trimmed before sending.
   */
  accountRef: string;
}

/** What {@linkcode EmbedSessionClient.create} returns. Safe to hand to a browser. */
export interface EmbedSession {
  /** The minted, short-lived bearer token. */
  token: string;
  /** Token lifetime, in seconds. */
  expiresIn: number;
  /** ISO-8601 UTC expiry, computed from the host clock sampled before the request. */
  expiresAt: string;
  /** The subject the server minted into the token. */
  subject: string;
  /** The tenant the client credentials resolved to. */
  tenant: string;
  /** The server's resolved account id (`acct_…`). */
  account: string;
  /** The trimmed account ref that was sent as the wire `account`. */
  accountRef: string;
}

/** An account-scoped session minter bound to one set of tenant credentials. */
export interface EmbedSessionClient {
  /**
   * Mint one account-scoped session: exactly one `POST /auth/exchange`.
   *
   * @throws {ConfigError} A non-string or blank `subject` / `accountRef` (no request is made).
   * @throws {ApiError} Any server or transport failure, unwrapped (status and code intact).
   */
  create(input: CreateEmbedSessionInput): Promise<EmbedSession>;
}

const SESSION = "EmbedSessionClient";

/**
 * Build a session client that holds tenant credentials per instance and mints
 * one account-scoped token per `create()`. A thin layer over
 * {@linkcode exchangeToken}, which stays the only HTTP path.
 *
 * Backend-only: construction throws {@linkcode ConfigError} when both `window`
 * and `document` exist (a browser-like global). This is a runtime check by
 * design; a bundler may or may not remove it.
 *
 * @throws {ConfigError} A blank/malformed `baseUrl`, blank/non-string `clientId` or
 *   `clientSecret`, a `clientId` containing `:`, non-latin-1 credentials, or a browser-like runtime. No message echoes
 *   `clientSecret`.
 */
export function createEmbedSessionClient(options: EmbedSessionClientOptions): EmbedSessionClient {
  const g = globalThis as { window?: unknown; document?: unknown };
  if (typeof g.window !== "undefined" && typeof g.document !== "undefined") {
    throw new ConfigError(
      `${SESSION}: refusing to construct in a browser-like runtime — the tenant client ` +
        "secret must stay on your backend.",
    );
  }

  const { baseUrl, clientId, clientSecret } = options ?? ({} as EmbedSessionClientOptions);
  if (baseUrl !== undefined) requiredText(baseUrl, "baseUrl", SESSION);
  requiredText(clientId, "clientId", SESSION);
  requiredText(clientSecret, "clientSecret", SESSION);
  basicAuthHeader(clientId, clientSecret, SESSION);
  resolveConfig({ baseUrl: baseUrl ?? DEFAULT_BASE_URL });

  const fetchOption = options.fetch;
  const now = options.now ?? Date.now;

  return {
    async create(input: CreateEmbedSessionInput): Promise<EmbedSession> {
      const { subject, accountRef } = input ?? ({} as CreateEmbedSessionInput);
      requiredText(subject, "subject", SESSION);
      requiredText(accountRef, "accountRef", SESSION);
      const account = accountRef.trim();

      const t0 = now();
      const res = await exchangeToken({
        baseUrl,
        clientId,
        clientSecret,
        subject,
        account,
        fetch: fetchOption,
      });

      const expiresAtMs = t0 + res?.expiresIn * 1000;
      if (
        res === null || res === undefined ||
        typeof res.token !== "string" || typeof res.expiresIn !== "number" ||
        Number.isNaN(new Date(expiresAtMs).getTime()) || res.user === null ||
        typeof res.user !== "object" || typeof res.user.subject !== "string" ||
        typeof res.user.tenant !== "string" || typeof res.user.account !== "string"
      ) {
        throw new ApiError(
          200,
          "bad_response",
          `${SESSION}: the exchange response was not the documented shape.`,
        );
      }
      return {
        token: res.token,
        expiresIn: res.expiresIn,
        expiresAt: new Date(expiresAtMs).toISOString(),
        subject: res.user.subject,
        tenant: res.user.tenant,
        account: res.user.account,
        accountRef: account,
      };
    },
  };
}
