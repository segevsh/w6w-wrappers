/**
 * Configuration resolution: what server, what credential, what project.
 *
 * This module turns whatever the caller supplied — plus the environment, read
 * through the single seam in `src/env.ts` — into one plain {@linkcode
 * ResolvedConfig} value. It is resolved **once, at client construction**, and
 * handed to the transport; nothing downstream re-reads the environment.
 *
 * @module
 */

import { ENV_BASE_URL, ENV_TOKEN, readEnv } from "./env.ts";
import { type ApiError, ConfigError } from "./errors.ts";

/**
 * The API's base path, from the shared contract's `basePath`
 * (`packages/wrappers/endpoints.json`).
 *
 * **Empty since v0.2.0.** The server serves its routes at the ROOT of its own
 * host (`https://api.w6w.io/vars`, not `.../api/vars` — the host already says
 * "api"), so there is no prefix to append and {@linkcode joinBaseUrl} appends
 * nothing. Kept exported, and kept mirroring the contract, so the constant
 * still answers "what does this client prepend?" — the answer is now "nothing".
 */
export const BASE_PATH = "";

/**
 * A `fetch`-shaped function.
 *
 * This is the injection seam every test in this package runs against: no test
 * may require a live server (`docs/implementation.md` §9). It is
 * constructor-injected for the same reason the credential is — a module-patched
 * global cannot be exercised two different ways in one process.
 *
 * `globalThis.fetch` satisfies it (a wider parameter type is assignable to a
 * narrower one), while a fake only has to accept a URL string.
 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * A per-request token supplier.
 *
 * Called **fresh on every request** — never cached, never resolved once at
 * construction — so a host can rotate or mint a token out-of-band (a tenant
 * exchange, a short-lived partner credential) and have the very next call pick
 * it up. `ctx.forceRefresh` is set to `true` exactly once, on the single
 * recovery retry a `401`/`unauthorized` triggers (`docs/implementation.md`
 * §3); every ordinary per-request resolution omits it. A `string` `token` is
 * the degenerate case of this shape — it behaves exactly as before.
 *
 * May return synchronously or return a `Promise`; either is awaited before the
 * bearer is attached. A nullish or blank (after trimming) result is treated
 * exactly like a nullish/blank static token — a {@linkcode ConfigError}, never
 * a request sent with no credential.
 */
export type TokenProvider = (
  ctx?: { forceRefresh?: boolean },
) => string | null | undefined | Promise<string | null | undefined>;

/** Constructor options for a client. Every field is optional. */
export interface W6WClientOptions {
  /**
   * The **origin** of the w6w server, e.g. `https://api.example.com`. The API
   * is served at its root, so no path is appended. It must be an absolute
   * `http(s)` URL with a host: a relative value like `/api` is a browser
   * same-origin assumption with no meaning in a library, and is rejected at
   * construction rather than misreported as an outage later.
   * Overrides `W6W_BASE_URL`.
   */
  baseUrl?: string;
  /**
   * Bearer token, resolved on **every** request — not just once at
   * construction. A plain `string` is sent verbatim on every call, exactly as
   * before; a {@linkcode TokenProvider} function is called (and awaited)
   * fresh per request, so a host can hand back a token minted or rotated after
   * this client was constructed. Overrides `W6W_TOKEN`, which stays a plain
   * string (there is no environment-variable spelling of a supplier).
   */
  token?: string | TokenProvider;
  /**
   * Opt in to a single, one-shot recovery when a request fails with
   * `401`/`unauthorized`: `token` (which must be a function for this to do
   * anything) is called once more with `{forceRefresh: true}`, and if that
   * yields a usable value the SAME request is re-sent once with it. Off
   * (`false`) by default — the behaviour before this option existed. Never
   * retries a second time, never retries any other status or code, and never
   * applies to a `requireAuth: false` request.
   */
  refreshOnUnauthorized?: boolean;
  /**
   * Called with the terminal `401`/`unauthorized` {@linkcode ApiError} of a
   * bearer request — after a failed recovery retry, or immediately when
   * recovery is off or not possible (a static `token`) — at most once per
   * call. Never called on success, never called twice, and never called for a
   * `requireAuth: false` request.
   */
  onUnauthorized?: (error: ApiError) => void;
  /**
   * Default headers sent with every request. This is the **base** every
   * per-request `headers` option builds on: a per-request header with the
   * same name wins, and neither can ever displace the bearer this transport
   * attaches (`authorization`) or the `content-type` it sets for a JSON body.
   */
  headers?: Record<string, string>;
  /**
   * Default project id for the project-scoped operations — `documents.*` and
   * `workflows.list`, which read it too.
   * Omitted, the server resolves the account's default project. There is no
   * environment variable for this and no `project` on any `vars.*` operation —
   * vars are not project-scoped (`docs/implementation.md` §7).
   */
  project?: string;
  /** Transport override. Defaults to `globalThis.fetch`. */
  fetch?: FetchLike;
}

/**
 * Configuration after resolution — the value the transport actually runs on.
 *
 * Held as **instance** state on the client, never in a module-level variable:
 * two clients in one process must be able to hold different credentials and
 * point at different servers with no interference (`docs/implementation.md` §2).
 */
export interface ResolvedConfig {
  /**
   * The normalized base, e.g. `https://api.example.com`. Never
   * trailing-slashed, and never relative — {@linkcode joinBaseUrl} rejects a
   * value that is not an absolute `http(s)` URL with a host.
   */
  readonly baseUrl: string;
  /** The bearer token or supplier, or `null` when none was configured. */
  readonly token: string | TokenProvider | null;
  /** Opt-in one-shot 401 recovery. Defaults to `false`. */
  readonly refreshOnUnauthorized: boolean;
  /** Terminal-401 callback, or `null` when none was configured. */
  readonly onUnauthorized: ((error: ApiError) => void) | null;
  /** Default headers sent with every request. Defaults to `{}`. */
  readonly headers: Record<string, string>;
  /** Default project id, or `null`. */
  readonly project: string | null;
}

/**
 * An absolute `http(s)` origin, spelled with a real authority.
 *
 * Deliberately checked *before* `new URL`, because the WHATWG parser silently
 * repairs the one spelling this rule most needs to catch: `new URL("http:///foo")`
 * does **not** fail and does **not** yield an empty host — it collapses the extra
 * slash and resolves to `http://foo/`, so a host check alone would accept a
 * hostless value and then request a different server than the one the user typed.
 * Measured in the api container, not assumed. The pattern therefore requires the
 * authority to start with a character that is not a slash, backslash, `?` or `#`.
 */
const ABSOLUTE_HTTP_ORIGIN = /^https?:\/\/[^/\\?#]/i;

/**
 * Validate a configured origin and join it with the API base path.
 *
 * **This is the one and only base-URL code path.** {@linkcode resolveConfig}
 * calls this function and normalises nothing itself, so a caller who imports
 * the helper gets exactly the answer their client will use — including the same
 * errors. A helper that were merely *similar* to the client's path (skipping the
 * whitespace trim, say) would answer differently for the same input, which is
 * worse than having no helper at all. The python lane found and fixed the
 * identical divergence in its own draft; this mirrors its resolution.
 *
 * The join rule is pinned by `docs/implementation.md` §2 and mirrors the house
 * helper that the operator console already uses against this same API, so all
 * clients agree on what `W6W_BASE_URL` means:
 *
 * 1. strip surrounding whitespace, then **all** trailing slashes;
 * 2. reject anything that is not an absolute `http`/`https` URL with a host;
 * 3. append nothing — the API is served at the root of its own host.
 *
 * ```
 * https://api.example.com      → https://api.example.com
 * https://api.example.com/     → https://api.example.com
 * https://api.example.com///   → https://api.example.com
 * ```
 *
 * Any path in the configured value is preserved verbatim, so a deployment that
 * genuinely sits behind a gateway prefix can still be addressed by configuring
 * that prefix. This is also why a stale `https://api.example.com/api` is NOT
 * silently rewritten: it is indistinguishable from such a prefix, and quietly
 * stripping it would break the deployments that mean it. It will 404 — the
 * announced break for the v0.1.x base path.
 *
 * Step 2 exists because a **relative** base URL has to fail *here*, as
 * configuration, with a message about configuration. Blank-is-absent
 * (`src/env.ts`) already stops `""` from joining to the relative `"/api"`; with
 * no absoluteness check, `W6W_BASE_URL=/foo` walked straight past that guard to
 * `"/foo/api"` and then failed on the first request as "the server may be down"
 * — the same hole, reopened by another route, and misdiagnosed. Closing only one
 * of the two leaves the other open.
 *
 * @param origin - The configured origin. Surrounding whitespace and trailing slashes are tolerated.
 * @returns The joined base URL.
 * @throws {ConfigError} When the origin is blank, relative, hostless or not `http(s)`.
 */
export function joinBaseUrl(origin: string): string {
  // Surrounding whitespace is stripped before the emptiness test so a blank
  // explicit argument fails the same way a blank environment variable does — an
  // env file's stray "\n" must not become part of the origin.
  const trimmed = origin.trim().replace(/\/+$/, "");
  if (trimmed.length === 0) {
    throw new ConfigError(
      "No w6w base URL is configured. Pass one to the client " +
        '(new W6WClient({ baseUrl: "https://api.example.com" })) or set the ' +
        `${ENV_BASE_URL} environment variable. It holds the server's origin, ` +
        'e.g. "https://api.example.com" — the API is served at its root, so no ' +
        "path is appended.",
    );
  }
  if (!ABSOLUTE_HTTP_ORIGIN.test(trimmed) || !parses(trimmed)) {
    throw new ConfigError(
      `The w6w base URL "${trimmed}" is not an absolute http(s) URL. ` +
        `${ENV_BASE_URL} holds an ORIGIN, e.g. "https://api.example.com" — scheme and host. ` +
        "A relative or hostless value cannot be requested and would fail later as a " +
        "connection problem rather than as the configuration mistake it is.",
    );
  }
  return trimmed;
}

/**
 * Does the runtime's URL parser accept this origin at all?
 *
 * The pattern above settles *shape* (scheme, `//`, a real authority); this
 * settles the rest — an out-of-range port, a malformed IPv6 literal, a host the
 * parser rejects. Both have to hold, and neither subsumes the other.
 */
function parses(origin: string): boolean {
  try {
    new URL(origin);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve constructor options and the environment into one config value.
 *
 * Precedence is **explicit argument > environment variable**, always; there is
 * no default base URL. An explicitly passed empty string is an *explicit*
 * value, not "unset" — it does not fall through to the environment, and an
 * empty base URL is a configuration error either way. Only an absent
 * (`undefined`) argument consults the environment.
 *
 * An **empty or whitespace-only environment variable is absent** and falls
 * through (see `src/env.ts`), so `W6W_BASE_URL=`, `W6W_BASE_URL="  "` and an
 * unset `W6W_BASE_URL` all end here, in the same configuration error — never in
 * a relative `"/api"`.
 *
 * @param options - Constructor options; `fetch` is ignored here (the client owns it).
 * @returns The resolved configuration.
 * @throws {ConfigError} When no usable base URL was supplied, naming `W6W_BASE_URL`.
 */
export function resolveConfig(options: W6WClientOptions = {}): ResolvedConfig {
  return {
    // Every normalisation, the emptiness test and the absoluteness check live in
    // `joinBaseUrl` — one code path, so the exported helper and the client can
    // never answer differently for the same input.
    baseUrl: joinBaseUrl(options.baseUrl ?? readEnv(ENV_BASE_URL) ?? ""),
    token: options.token ?? readEnv(ENV_TOKEN) ?? null,
    refreshOnUnauthorized: options.refreshOnUnauthorized ?? false,
    onUnauthorized: options.onUnauthorized ?? null,
    headers: options.headers ?? {},
    project: options.project ?? null,
  };
}

/**
 * The token, or a {@linkcode ConfigError} naming `W6W_TOKEN`.
 *
 * A client may be *constructed* without a token so that a CLI's `--help` and
 * `--version` work offline; the error surfaces on the first request instead.
 * There are no anonymous operations in this surface
 * (`docs/implementation.md` §2).
 *
 * **Resolved fresh every call, never cached.** When `config.token` is a
 * {@linkcode TokenProvider} it is called (and its result awaited) right here —
 * a plain string is the degenerate case that needs no call at all. `ctx` is
 * forwarded verbatim to the provider; passing `{forceRefresh: true}` is the
 * one and only seam `request()`'s recovery retry uses (`docs/implementation.md`
 * §3) — ordinary resolution never passes it.
 *
 * A blank token counts as no token, for the same reason a blank base URL does:
 * `W6W_TOKEN=` is how a shell or a Dockerfile spells "I meant to set this and
 * did not", and `Authorization: Bearer ` would turn that into an opaque 401
 * instead of the one message that explains it. The same rule applies to
 * whatever a provider returns: nullish or blank is treated exactly like a
 * nullish/blank static token — the error never echoes the value either way.
 *
 * @param config - The resolved configuration.
 * @param ctx - Forwarded to a function-typed `token`; unused for a string one.
 * @returns The configured token, verbatim.
 * @throws {ConfigError} When no non-blank token is configured.
 */
export async function requireToken(
  config: ResolvedConfig,
  ctx?: { forceRefresh?: boolean },
): Promise<string> {
  const raw = typeof config.token === "function" ? await config.token(ctx) : config.token;
  if (raw === null || raw === undefined || raw.trim().length === 0) {
    throw new ConfigError(
      "No w6w API token is configured. Pass one to the client " +
        '(new W6WClient({ token: "…" })) or set the ' +
        `${ENV_TOKEN} environment variable. Every w6w API operation is authenticated.`,
    );
  }
  return raw;
}
