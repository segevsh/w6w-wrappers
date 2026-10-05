/**
 * `<W6WProvider>` — one `W6WClient` per `{baseUrl, project, identityKey,
 * refreshOnUnauthorized, headers}` combination, with the token resolved FRESH
 * on every request.
 *
 * `@w6w/sdk`'s `W6WClientOptions.token` (`node/src/config.ts:41-63`) accepts
 * either a plain string or a {@linkcode TokenProvider} function — the
 * function form is called (and its result awaited) fresh on every request,
 * never cached, never resolved once at construction. This provider hands the
 * SDK a single STABLE function that reads the CURRENT `token` prop through a
 * ref: a string prop is returned as-is, a function prop is called with
 * whatever `ctx` the SDK forwards (including `{forceRefresh: true}` on its
 * own one-shot 401 recovery retry, `node/src/http.ts`). `fetch` and
 * `onUnauthorized` are the same shape — stable wrappers over "latest" refs —
 * so neither a token rotation, a new `fetch` identity, nor a new
 * `onUnauthorized` closure identity ever rebuilds the client. A nullish or
 * blank token (sync or async) never reaches the wire: the SDK's own
 * `requireToken` raises a local {@linkcode ConfigError} before any `fetch`
 * call, which is the floor `hooks.ts`'s `useAsync` reports as `loading`, not
 * `error`.
 *
 * **What DOES rebuild the client** (the `useMemo` below): `baseUrl`,
 * `project`, `identityKey`, `refreshOnUnauthorized`, and a canonical STRING of
 * `headers`' sorted entries — never the `headers` object's own identity (an
 * inline literal would rebuild the client on every render) and never
 * `token`. `identityKey` (e.g. `${subject}:${account}`) is the one supported
 * way to force a rebuild on purpose, for a host juggling more than one
 * signed-in identity: every hook built on `useAsync` (`hooks.ts`) resets its
 * state to `{data: undefined, error: undefined, loading: true}` when the
 * client it reads through changes, aborting whatever it had in flight first —
 * a stale account's data is never shown under a new one.
 *
 * `ready` (default `true`) gates every READ hook, never a mutation: while
 * `false`, a read hook reports `loading: true` and never calls the SDK at
 * all. Flipping it to `true` (or changing `identityKey`) fetches.
 *
 * @module
 */
import { type ApiError, type FetchLike, type TokenProvider, W6WClient } from "@w6w/sdk";
import { type ReactNode, createContext, useContext, useMemo, useRef } from "react";

/** A static bearer token, or a supplier called fresh on every request. */
export type TokenSource = string | TokenProvider;

export interface W6WProviderProps {
  /** The w6w server's origin, e.g. `"https://api.example.com"`. */
  baseUrl: string;
  /** A literal bearer token, or a supplier called fresh on every request. */
  token: TokenSource;
  /**
   * The real transport this provider's stable `fetch` wrapper delegates to.
   * Defaults to `globalThis.fetch`. Mainly for tests — a caller wanting to
   * record or stub outbound requests.
   */
  fetch?: FetchLike;
  /** Default project id for the project-scoped operations (`documents.*`, `workflows.list`). */
  project?: string;
  /**
   * Default headers sent with every request — e.g. `{"X-W6W-Tenant": "t1"}`
   * for a Path 3 tenant binding. Compared by CONTENT (sorted entries), not by
   * object identity: a new-but-equal `headers` object on every render never
   * rebuilds the client.
   */
  headers?: Record<string, string>;
  /**
   * Gates every read hook. `false` (default `true`) means "I don't have a
   * token/identity yet": no read hook calls the SDK, and every one reports
   * `loading: true` until this flips — or forever, if it never does.
   */
  ready?: boolean;
  /**
   * Identifies WHICH signed-in identity this client speaks for. Changing it
   * (e.g. `${subject}:${account}`) rebuilds the `W6WClient` and resets every
   * read hook's state — the one supported way to switch accounts without a
   * stale read from the previous identity ever rendering under the new one.
   */
  identityKey?: string;
  /**
   * Opt in to a single, one-shot recovery when a request 401s with
   * `{code: "unauthorized"}`: the `token` supplier is called once more with
   * `{forceRefresh: true}`, and a usable result retries the same request
   * once. See `@w6w/sdk`'s `W6WClientOptions.refreshOnUnauthorized`.
   */
  refreshOnUnauthorized?: boolean;
  /**
   * Called with the terminal `401`/`unauthorized` error — after a failed
   * recovery retry, or immediately when recovery is off or not possible — at
   * most once per call. Always the LATEST `onUnauthorized` prop, read through
   * a ref like `token`/`fetch`.
   */
  onUnauthorized?: (error: ApiError) => void;
  children: ReactNode;
}

interface W6WContextValue {
  client: W6WClient;
  /** Mirrors the `ready` prop. Read by `hooks.ts`'s `useAsync`, never by `useW6WClient`. */
  ready: boolean;
}

const Ctx = createContext<W6WContextValue | null>(null);

/**
 * Canonical encoding of a headers object for the `useMemo` dependency array —
 * sorted entries, so `{a: "1", b: "2"}` and `{b: "2", a: "1"}` produce the
 * SAME key and two structurally-equal-but-distinct objects never rebuild the
 * client.
 */
function headersKey(headers: Record<string, string> | undefined): string {
  const entries = Object.entries(headers ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return entries.map(([name, value]) => `${name}\u0000${value}`).join("\u0001");
}

/**
 * Provides one memoized `W6WClient` (plus `ready`) to every component under
 * it. See this module's header for the token-freshness mechanism and the
 * memoization policy.
 */
export function W6WProvider(props: W6WProviderProps): ReactNode {
  const {
    baseUrl,
    token,
    fetch: fetchOverride,
    project,
    headers,
    ready = true,
    identityKey,
    refreshOnUnauthorized,
    onUnauthorized,
    children,
  } = props;

  // "Latest ref" pattern: kept in sync on every render, but never a `useMemo`
  // dependency below — the stable wrappers constructed inside always read the
  // CURRENT prop value through these, so a token rotation, a new `fetch`
  // identity or a new `onUnauthorized` closure identity never forces a client
  // rebuild. Refs are stable across renders and are not "reactive" values, so
  // `useExhaustiveDependencies` correctly does not require them in the memo's
  // dependency array. `headers` gets the same treatment for the same reason —
  // the memo depends on its canonical STRING (`headersKey`, below), not on
  // this ref — but the value actually handed to `W6WClient` is read fresh at
  // the moment the memo recomputes.
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const fetchRef = useRef(fetchOverride);
  fetchRef.current = fetchOverride;
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;
  const headersRef = useRef(headers);
  headersRef.current = headers;

  const headersSnapshot = headersKey(headers);

  const client = useMemo(() => {
    // `identityKey` and `headersSnapshot` are not otherwise read in this body
    // — they exist purely so this memo depends on them (identity switch;
    // headers content change, per this module's header). Referencing them
    // here (as opposed to only in the dependency array below) is what keeps
    // `useExhaustiveDependencies` from treating them as superfluous.
    void identityKey;
    void headersSnapshot;
    const stableToken: TokenProvider = (ctx) => {
      const current = tokenRef.current;
      return typeof current === "function" ? current(ctx) : current;
    };
    const stableFetch: FetchLike = (input, init) => {
      const transport =
        fetchRef.current ?? ((i: string, ii?: RequestInit) => globalThis.fetch(i, ii));
      return transport(input, init);
    };
    const stableOnUnauthorized = (error: ApiError) => {
      onUnauthorizedRef.current?.(error);
    };
    return new W6WClient({
      baseUrl,
      project,
      token: stableToken,
      fetch: stableFetch,
      headers: headersRef.current,
      refreshOnUnauthorized,
      onUnauthorized: stableOnUnauthorized,
    });
  }, [baseUrl, project, identityKey, refreshOnUnauthorized, headersSnapshot]);

  const value = useMemo<W6WContextValue>(() => ({ client, ready }), [client, ready]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * Access the memoized `W6WClient`. Throws a helpful error if used outside a
 * `<W6WProvider>` (mirrors `packages/ui/src/provider.tsx:249-258`'s
 * `useW6WApi` shape — read-only reference, transcribed here, never imported).
 */
export function useW6WClient(): W6WClient {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error(
      "useW6WClient must be used inside <W6WProvider>. " +
        'Wrap your app root with <W6WProvider baseUrl="..." token="...">...</W6WProvider>.',
    );
  }
  return ctx.client;
}

/**
 * Internal: the context value including `ready`, consumed only by the read
 * hooks in `hooks.ts` (via a relative import — never re-exported from
 * `mod.ts`). `useW6WClient`'s `W6WClient` return type is the public surface;
 * this is the one extra bit every read hook needs to gate on.
 */
export function useW6WProviderContext(): W6WContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error(
      "This hook must be used inside <W6WProvider>. " +
        'Wrap your app root with <W6WProvider baseUrl="..." token="...">...</W6WProvider>.',
    );
  }
  return ctx;
}
