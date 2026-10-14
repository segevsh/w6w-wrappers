/**
 * The session store behind `<W6WProvider getSession>` and `useW6WSession()`.
 *
 * A host hands the provider ONE callback that mints a short-lived session
 * (`{token, expiresAt, expiresIn?}`). The store caches the session until
 * shortly before it expires, shares one acquisition between every caller,
 * re-checks when a hidden tab becomes visible again, and is born and killed
 * with the provider's `identityKey` (it is created inside the client
 * `useMemo`), so an identity switch can never send the previous identity's
 * token: a disposed store commits nothing and its supplier throws.
 *
 * Layering: `@w6w/sdk` already calls the token supplier per request, dedups
 * CONCURRENT ordinary supplier calls and owns the one-shot 401 retry
 * (`refreshOnUnauthorized`, `forceRefresh: true`). This store adds only the
 * cache + single-flight acquisition + resume/expiry handling on top.
 *
 * @module
 */
import { useMemo, useSyncExternalStore } from "react";
import { useW6WProviderContext } from "./W6WProvider.tsx";

/** What `getSession` resolves to. A structural supertype of `@w6w/sdk/server`'s `EmbedSession`. */
export interface W6WSession {
  token: string;
  /** ISO-8601 instant the token stops being valid. */
  expiresAt: string;
  /** Seconds the token lives from receipt; bounds a far-future `expiresAt` (clock skew). */
  expiresIn?: number;
}

export type W6WSessionStatus = "loading" | "ready" | "renewing" | "expired" | "error";

export interface W6WSessionState {
  status: W6WSessionStatus;
  /** The cached session's `expiresAt`, or `null` (no session yet, or a `token`-mode provider). */
  expiresAt: string | null;
  /** The last acquisition failure, until the next acquisition starts. */
  error: unknown;
  /** Starts (or joins) an acquisition. Resolves when it settles; never rejects — read `error`. */
  refresh(): Promise<void>;
}

/** Default `renewBeforeMs`. */
export const DEFAULT_RENEW_BEFORE_MS = 30_000;

const MAX_TIMER_MS = 2_147_483_647;

interface Held {
  token: string;
  expiresAt: string;
  expiry: number;
  window: number;
}

type Outcome = { ok: true; token: string } | { ok: false; error: unknown };

interface Flight {
  promise?: Promise<Outcome>;
}

export class SessionStore {
  readonly #getSession: () => Promise<W6WSession>;
  readonly #renewBeforeMs: () => number;
  #held: Held | null = null;
  #flight: Flight | null = null;
  #error: unknown = null;
  #hasError = false;
  /** Bumped on disposal: an acquisition from an older epoch never commits. */
  #epoch = 0;
  #dead = false;
  #attached = false;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #listeners = new Set<() => void>();
  #snapshot: W6WSessionState;

  constructor(getSession: () => Promise<W6WSession>, renewBeforeMs: () => number) {
    this.#getSession = getSession;
    this.#renewBeforeMs = renewBeforeMs;
    this.#snapshot = this.#compute();
  }

  // ── external-store surface ─────────────────────────────────────────────

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  getSnapshot = (): W6WSessionState => this.#snapshot;

  refresh = async (): Promise<void> => {
    if (this.#dead) return;
    await (this.#flight ? this.#flight.promise : this.#start());
  };

  // ── the stable supplier handed to the SDK ──────────────────────────────

  /** `forceRefresh` JOINS an acquisition already in flight, else starts exactly one. */
  supplier = async (ctx?: { forceRefresh?: boolean }): Promise<string> => {
    if (this.#dead)
      throw new Error("w6w session store was disposed (identity changed or unmounted)");
    const held = this.#held;
    if (ctx?.forceRefresh !== true && held && Date.now() < held.expiry - held.window) {
      return held.token;
    }
    const outcome = await (this.#flight ? this.#flight.promise : this.#start());
    if (this.#dead || !outcome) {
      throw new Error("w6w session store was disposed (identity changed or unmounted)");
    }
    if (outcome.ok) return outcome.token;
    const still = this.#held;
    if (still && Date.now() < still.expiry) return still.token;
    throw outcome.error;
  };

  // ── lifecycle (effect-driven; disposal deferred so StrictMode's remount works) ─

  /**
   * Called from the provider's effect. Disposal is DEFERRED one microtask (the
   * same refcount idiom `hooks.ts` uses for its abort controller): React
   * StrictMode runs mount -> cleanup -> mount synchronously, and descendants'
   * passive effects (a read hook's first request) have already entered the
   * supplier by the time the cleanup runs, so tearing the flight down at
   * cleanup would reject that request ("stale acquisition"). A re-attach in
   * the same task simply cancels the pending disposal; a real unmount or
   * identity change disposes one microtask later.
   */
  attach(): void {
    this.#dead = false;
    this.#attached = true;
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.#onVisibility);
    }
    this.#schedule();
  }

  detach(): void {
    this.#attached = false;
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.#onVisibility);
    }
    queueMicrotask(() => {
      if (this.#attached || this.#dead) return;
      this.#dead = true;
      this.#epoch += 1;
      this.#flight = null;
    });
  }

  // ── internals ──────────────────────────────────────────────────────────

  #visible(): boolean {
    return typeof document !== "undefined" && document.visibilityState === "visible";
  }

  #onVisibility = (): void => {
    if (this.#dead || !this.#visible() || this.#flight || this.#hasError) return;
    const held = this.#held;
    if (!held || Date.now() >= held.expiry - held.window) void this.#start();
    else this.#update();
  };

  #start(): Promise<Outcome> {
    const epoch = this.#epoch;
    const flight: Flight = {};
    this.#flight = flight;
    this.#hasError = false;
    this.#error = null;
    this.#update();
    const run = async (): Promise<Outcome> => {
      let outcome: Outcome;
      try {
        const session = await this.#getSession();
        const held = this.#toHeld(session);
        if (epoch !== this.#epoch) return { ok: false, error: new Error("stale acquisition") };
        this.#held = held;
        outcome = { ok: true, token: held.token };
      } catch (error) {
        if (epoch !== this.#epoch) return { ok: false, error };
        this.#hasError = true;
        this.#error = error;
        outcome = { ok: false, error };
      }
      if (this.#flight === flight) this.#flight = null;
      this.#update();
      this.#schedule();
      return outcome;
    };
    flight.promise = run();
    return flight.promise;
  }

  #toHeld(session: W6WSession): Held {
    const receivedAt = Date.now();
    if (!session || typeof session.token !== "string" || session.token.trim().length === 0) {
      throw new Error("getSession returned a blank token");
    }
    let expiry = Date.parse(session.expiresAt);
    if (Number.isNaN(expiry)) throw new Error("getSession returned an invalid expiresAt");
    if (typeof session.expiresIn === "number" && Number.isFinite(session.expiresIn)) {
      expiry = Math.min(expiry, receivedAt + session.expiresIn * 1000);
    }
    const window = Math.max(0, Math.min(this.#renewBeforeMs(), (expiry - receivedAt) / 2));
    return { token: session.token, expiresAt: session.expiresAt, expiry, window };
  }

  #schedule(): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
    const held = this.#held;
    if (!this.#attached || !held) return;
    const now = Date.now();
    const renewAt = held.expiry - held.window;
    const target = now < renewAt ? renewAt : now < held.expiry ? held.expiry : null;
    if (target === null) return;
    this.#timer = setTimeout(this.#tick, Math.min(Math.max(0, target - now), MAX_TIMER_MS));
  }

  #tick = (): void => {
    this.#timer = undefined;
    if (this.#dead) return;
    const held = this.#held;
    if (
      held &&
      !this.#flight &&
      !this.#hasError &&
      this.#visible() &&
      Date.now() >= held.expiry - held.window
    ) {
      void this.#start(); // updates + reschedules itself on settle
    }
    this.#update();
    this.#schedule();
  };

  #compute(): W6WSessionState {
    const held = this.#held;
    let status: W6WSessionStatus;
    if (this.#flight) status = held ? "renewing" : "loading";
    else if (this.#hasError) status = "error";
    else if (!held) status = "loading";
    else status = Date.now() >= held.expiry ? "expired" : "ready";
    return {
      status,
      expiresAt: held ? held.expiresAt : null,
      error: this.#error,
      refresh: this.refresh,
    };
  }

  #update(): void {
    const next = this.#compute();
    const prev = this.#snapshot;
    if (
      next.status === prev.status &&
      next.expiresAt === prev.expiresAt &&
      next.error === prev.error
    ) {
      return;
    }
    this.#snapshot = next;
    for (const listener of [...this.#listeners]) listener();
  }
}

const noopSubscribe = (): (() => void) => () => {};
const noopRefresh = (): Promise<void> => Promise.resolve();

/**
 * The provider's session state. With a `getSession` provider it mirrors the
 * store; with a `token` provider `status` is `"ready"` when the provider's
 * `ready` is true (else `"loading"`), `expiresAt` is `null` and `refresh()`
 * resolves without calling anything.
 */
export function useW6WSession(): W6WSessionState {
  const { session, ready } = useW6WProviderContext();
  const tokenState = useMemo<W6WSessionState>(
    () => ({
      status: ready ? "ready" : "loading",
      expiresAt: null,
      error: null,
      refresh: noopRefresh,
    }),
    [ready],
  );
  return useSyncExternalStore(
    session ? session.subscribe : noopSubscribe,
    session ? session.getSnapshot : () => tokenState,
    session ? session.getSnapshot : () => tokenState,
  );
}
