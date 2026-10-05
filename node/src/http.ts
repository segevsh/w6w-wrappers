/**
 * The transport: one `request()`, three failure modes, and one opt-in policy.
 *
 * Everything the operation modules do goes through {@linkcode request}. It
 * attaches the bearer, serialises a JSON body, reads the response exactly once,
 * parses it guardedly, and raises one of the three failure modes pinned in
 * `docs/implementation.md` §3 — and nothing else. It does **not** poll and does
 * **not** inspect an error code to decide on a side effect, beyond the one
 * policy described next.
 *
 * **The one exception is opt-in**: when `config.refreshOnUnauthorized` is
 * `true`, `config.token` is a function, and the request used a bearer
 * (`requireAuth !== false`), a `401` whose `code` is exactly `"unauthorized"`
 * is given a single recovery attempt — the provider is called once more with
 * `{forceRefresh: true}` and, if that yields a usable token, the identical
 * request is re-sent once with it by calling `request()` a second time (never
 * a third). Off by default, this is exactly the old unconditional "a `401`
 * raises and stops" behaviour. `config.onUnauthorized`, when set, receives the
 * terminal `401`/`unauthorized` `ApiError` of a bearer request — after a failed
 * retry, or immediately when recovery is off or impossible — at most once per
 * call, never on success, and never for a `requireAuth: false` request.
 *
 * It also returns the **HTTP status** alongside the parsed body, because a
 * `202` is a normal outcome on this API (a queued workflow run), not an error —
 * and a signature that dropped the status would leave the run operations unable
 * to tell "finished" from "queued" (§4).
 *
 * @module
 */

import { type FetchLike, requireToken, type ResolvedConfig } from "./config.ts";
import { ApiError } from "./errors.ts";

/**
 * HTTP methods this surface uses.
 *
 * `PUT` was added by T2.2.1 (BLK-3): `console.apps.upsertOAuthConfig` relocates
 * `client.ts`'s `upsertAppOAuthConfig`, which sends `PUT
 * /apps/:id/oauth-config/:authKey` — the first operation in this package to
 * need it. Purely additive to the union; no existing caller's behavior changes.
 */
export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

/**
 * Query parameters. `undefined` values are dropped, so an optional argument
 * can be forwarded without a conditional at the call site. Values are
 * percent-encoded by `URLSearchParams`.
 */
export type QueryParams = Record<string, string | number | boolean | undefined>;

/** One request, fully described. */
export interface RequestOptions {
  /** HTTP method. */
  method: HttpMethod;
  /**
   * Base-relative path with a leading slash, e.g. `/documents`. Build it with
   * the {@linkcode path} tag whenever any part of it comes from the caller.
   */
  path: string;
  /** Query parameters, if any. */
  query?: QueryParams;
  /** Request body. Serialised as JSON when present; omit it for a bodiless request. */
  body?: unknown;
  /**
   * Extra headers to send with this request. Precedence, low to high: the
   * client's own `headers` default < this option < the bearer
   * (`authorization`) and, when a body is present, `content-type`, which this
   * transport sets *after* both and which neither can ever override. A
   * same-named entry here beats the client default; any other header name
   * passes through untouched.
   */
  headers?: Record<string, string>;
  /**
   * Whether this request needs a bearer. Defaults to `true` — omitting the
   * field behaves exactly as it always has.
   *
   * Set `false` for the handful of routes that are public server-side (self-
   * serve login/signup) and must never send one: when `false`,
   * {@linkcode requireToken} is never called and no `authorization` header is
   * set, even when the client holds a token. This is the ONLY way
   * `console.auth.login` can work at all — a client with no token configured
   * (the normal case pre-login) would otherwise hit `requireToken`'s
   * `ConfigError` on every request, and `login` is how a caller gets a token
   * in the first place.
   */
  requireAuth?: boolean;
  /**
   * Abort this specific request. Local request control only — it is never
   * serialized into the URL or the body, and the server never sees it. Wired
   * straight through to the injected `fetch`'s own `RequestInit.signal`, so
   * cancellation semantics are whatever the runtime's `fetch` already gives an
   * aborted request; this transport adds no polling, retry or timeout policy
   * on top of it (see this module's header).
   */
  signal?: AbortSignal;
}

/**
 * Per-call transport options shared by every read method a react hook calls
 * (R-7): today, just an optional {@linkcode AbortSignal}. A thin, deliberately
 * minimal bag rather than reusing {@linkcode RequestOptions} itself — the
 * typed per-method option interfaces (`DocumentOptions`,
 * `WorkflowListOptions`, …) extend this one, and a method with no options
 * today takes a bare `options?: CallOptions`, so `signal` lands in exactly one
 * place for every read operation.
 *
 * `signal` reaches the injected `fetch` unchanged through
 * {@linkcode RequestOptions.signal} and is NEVER serialized into the URL or
 * the body — see that field's own doc for the cancellation semantics.
 */
export interface CallOptions {
  /** Abort this call. See {@linkcode RequestOptions.signal}. */
  signal?: AbortSignal;
}

/**
 * A successful response: the parsed body plus the status that carried it.
 *
 * `body` is `null` for an empty body — a `204`-style response must not crash a
 * caller, and the server's `{ok:true}` deletes carry nothing an operation needs.
 */
export interface HttpResponse<T> {
  status: number;
  body: T;
}

/**
 * Build a base-relative path, percent-encoding every interpolated value.
 *
 * ```ts
 * path`/documents/by-key/${key}`   // key "a/b" → "/documents/by-key/a%2Fb"
 * ```
 *
 * **Use this tag for every path that contains a caller-supplied value**, per the
 * encoding pin in `docs/implementation.md` §2. It exists as a tag rather than a
 * helper function because the encoding then happens at the point of
 * interpolation and cannot be forgotten one call site at a time: there is no way
 * to write the template and skip it.
 *
 * Why it matters, in one line: the server accepts any non-empty key up to 128
 * characters, so `".."` is a key a user can legitimately create — and
 * `` `/documents/by-key/${".."}` `` naively concatenated resolves to the
 * **list** route, returning every document with a `200` and no error anywhere.
 *
 * This is encoding, never validation. A key the server accepts is sent as-is
 * (encoded); the wrapper does not reject, canonicalise or rewrite it. A
 * character policy for keys is business logic, and it lives in the server.
 *
 * The one case encoding cannot fix is a dot-only segment: `.` is unreserved in
 * RFC 3986, and the URL parser behind `fetch` removes dot segments regardless of
 * how they are spelled. `"."` and `".."` are therefore not addressable through a
 * path segment from this runtime — encode and send anyway, and let the server
 * decide what it means.
 *
 * @param strings - Template literal fragments (author-controlled, not encoded).
 * @param values - Interpolated values (caller-controlled, each percent-encoded).
 * @returns The assembled path.
 */
export function path(strings: TemplateStringsArray, ...values: string[]): string {
  return strings.reduce(
    (acc, fragment, i) =>
      i === 0 ? fragment : `${acc}${encodeURIComponent(values[i - 1])}${fragment}`,
    "",
  );
}

/**
 * Assemble the full request URL from a resolved base, a path and query params.
 *
 * The base is already joined with the API base path by `src/config.ts`; the
 * path is appended verbatim (it is expected to be encoded already — see
 * {@linkcode path}), and the query string is built with `URLSearchParams`,
 * which encodes both names and values.
 *
 * @param config - The resolved configuration.
 * @param options - The request being built.
 * @returns The absolute URL to fetch.
 */
export function buildUrl(config: ResolvedConfig, options: RequestOptions): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) params.set(name, String(value));
  }
  const query = params.toString();
  return `${config.baseUrl}${options.path}${query ? `?${query}` : ""}`;
}

/**
 * Perform one request and map its outcome.
 *
 * Returns `{status, body}` on any `2xx`. Raises {@linkcode ApiError} in exactly
 * three cases, transcribed from the studio's client, which has these three and
 * no others:
 *
 * 1. **Transport failure** — `fetch` itself rejected: server down, DNS, TLS,
 *    connection refused. `status` `0`, code `network_error`, and the message
 *    names the **method and full URL** plus the underlying message, because a
 *    bare `TypeError: Failed to fetch` says nothing a user can act on.
 * 2. **Non-JSON body on a non-OK status** — a proxy or Cloudflare HTML error
 *    page. `code` `bad_response`, message carrying a ≤200-character snippet;
 *    reporting it as an opaque `SyntaxError` would throw away the only
 *    diagnostic present. A non-JSON body on an **OK** status is not an error.
 * 3. **Envelope error** — a non-OK status with a JSON body. `code` from
 *    `body.error.code` (else `"error"`), `message` from `body.error.message`
 *    (else the status text), and `raw` = the parsed body, which carries the
 *    fields an invoke failure rides alongside (`logs`, `apiCalls`).
 *
 * A `424` lands in case 3 like any other non-OK JSON status: it means the
 * target app or its upstream vendor failed during execute, and it is
 * deliberately a 4xx so Cloudflare cannot swallow it. It is never a transport
 * error and is never normalised into a 5xx.
 *
 * **Recovery (opt-in, this module's header).** When a `401`/`unauthorized`
 * {@linkcode ApiError} is about to be raised and `config.refreshOnUnauthorized
 * === true && typeof config.token === "function" && options.requireAuth !==
 * false`, this function calls `config.token({forceRefresh: true})` once; a
 * usable result re-enters `request()` itself — never a second mapper — with a
 * config carrying that **string**, which is what caps the retry at one: the
 * recursive call's `config.token` is no longer a function, so its own recovery
 * check is false by construction. `config.onUnauthorized` is invoked with
 * whichever `401`/`unauthorized` error turns out to be terminal.
 *
 * @param config - Resolved configuration (base URL and credential).
 * @param fetchImpl - The transport to use; injected, never read from a module global.
 * @param options - The request.
 * @returns The status and parsed body.
 * @throws {ConfigError} When no token is configured.
 * @throws {ApiError} On any of the three failure modes above.
 */
export async function request<T>(
  config: ResolvedConfig,
  fetchImpl: FetchLike,
  options: RequestOptions,
): Promise<HttpResponse<T>> {
  const url = buildUrl(config, options);
  // Precedence, low to high: the client's own default `headers` < this
  // request's `headers` < the bearer/content-type this transport re-pins
  // below. `.set` on an already-present name overrides it, which is what lets
  // a per-request header beat a same-named client default.
  const headers = new Headers(config.headers);
  for (const [name, value] of Object.entries(options.headers ?? {})) {
    headers.set(name, value);
  }
  // Resolved per request rather than at construction: a client with no token is
  // constructible (so a CLI's --help works offline) and fails here instead.
  // Skipped entirely when `requireAuth: false` — not just left unset, but never
  // even attempted, so a tokenless client can call a public route without
  // `requireToken` raising first.
  if (options.requireAuth !== false) {
    headers.set("authorization", `Bearer ${await requireToken(config)}`);
  }

  const hasBody = options.body !== undefined;
  if (hasBody) headers.set("content-type", "application/json");

  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: options.method,
      headers,
      body: hasBody ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    });
  } catch (err) {
    // An aborted request is a distinct, recognizable outcome from an actual
    // network failure — a caller that cancelled a stale search/tab-switch
    // request must be able to tell "I cancelled this" from "the server is
    // unreachable" without inspecting `err.message` text. `signal.aborted` is
    // checked rather than matching only on `err.name === "AbortError"`
    // because it is the runtime-agnostic source of truth (the DOM/undici
    // `fetch` both set it synchronously before the promise rejects).
    const cancelled = options.signal?.aborted === true ||
      (err instanceof Error && err.name === "AbortError");
    if (cancelled) {
      throw new ApiError(
        0,
        "cancelled",
        `Request cancelled (${options.method} ${url}).`,
      );
    }
    throw new ApiError(
      0,
      "network_error",
      `Could not reach the w6w server (${options.method} ${url}). ` +
        `It may be down or unreachable. (${err instanceof Error ? err.message : String(err)})`,
    );
  }

  // Read the body exactly once, as text, then parse it guardedly — a response
  // body is a single-use stream, and `res.json()` on an HTML error page throws
  // an opaque SyntaxError that loses the page.
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      if (!res.ok) {
        throw new ApiError(
          res.status,
          "bad_response",
          `Server returned a non-JSON ${res.status} response: ${text.slice(0, 200)}`,
        );
      }
    }
  }

  if (!res.ok) {
    const envelope = (data as { error?: { code?: string; message?: string } } | null)?.error ?? {};
    const apiError = new ApiError(
      res.status,
      envelope.code ?? "error",
      envelope.message ?? res.statusText,
      data,
    );

    const isUnauthorized = apiError.status === 401 && apiError.code === "unauthorized";
    const { token } = config;

    if (
      config.refreshOnUnauthorized === true &&
      typeof token === "function" &&
      options.requireAuth !== false &&
      isUnauthorized
    ) {
      let refreshed: string | null | undefined;
      try {
        // The one and only forced refresh: never passed by ordinary
        // resolution, passed here exactly once.
        refreshed = await token({ forceRefresh: true });
      } catch {
        refreshed = undefined;
      }

      if (typeof refreshed === "string" && refreshed.trim().length > 0) {
        // Re-enter request() itself — the only status→ApiError mapper in this
        // module — rather than re-implementing it. The retried config carries
        // the refreshed token as a plain STRING, so this recursive call's own
        // `typeof config.token === "function"` check is false: that is what
        // caps this at one retry, never a third attempt, AND it is why the
        // recursive call's own terminal-error handling below (not a second
        // copy of it here) is what calls `onUnauthorized` on a retry that
        // still comes back 401 — calling it here too would fire it twice.
        return await request<T>({ ...config, token: refreshed }, fetchImpl, options);
      }
      // No usable refreshed token (nullish, blank, or the provider threw):
      // no retry — fall through and report the ORIGINAL 401.
    }

    if (isUnauthorized && options.requireAuth !== false) {
      config.onUnauthorized?.(apiError);
    }
    throw apiError;
  }

  return { status: res.status, body: data as T };
}
