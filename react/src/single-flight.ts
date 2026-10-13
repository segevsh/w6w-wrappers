/**
 * Single-flight store behind the read hooks: identical in-flight reads (same
 * client, same key) share ONE request, and nothing outlives it.
 *
 * Scoping: one `Map` per `W6WClient` object, held in a `WeakMap` — never a
 * bare module-level map and never keyed by `baseUrl`/token, so two providers
 * with identical props (different tenants) cannot see each other's data.
 *
 * Lifetime: an entry exists only while its request is pending. It is deleted
 * on resolve OR reject (only if it is still the mapped entry), so a consumer
 * that mounts after the flight settled sends a fresh request — no staleness.
 *
 * Abort: refcounted. The shared `AbortController` aborts only when the last
 * subscriber has detached AND stayed detached past a microtask grace. React
 * StrictMode's synchronous cleanup -> remount re-attaches inside that grace,
 * so it re-joins the flight instead of abort + refire.
 *
 * @module
 */

interface Entry<T> {
  readonly promise: Promise<T>;
  readonly controller: AbortController;
  refs: number;
}

/** One subscriber's hold on a shared flight. */
export interface Subscription<T> {
  /** The shared request's result — the same promise for every subscriber. */
  readonly promise: Promise<T>;
  /** Release this subscriber's hold. Idempotent. */
  detach(): void;
}

const stores = new WeakMap<object, Map<string, Entry<unknown>>>();

/**
 * Join the pending flight for `(client, key)`, or start one with `start`.
 * `fresh` always starts a new flight and takes over the key's slot; the entry
 * it replaces keeps running for whoever still holds it.
 */
export function subscribe<T>(
  client: object,
  key: string,
  start: (signal: AbortSignal) => Promise<T>,
  fresh = false,
): Subscription<T> {
  let map = stores.get(client);
  if (!map) {
    map = new Map();
    stores.set(client, map);
  }
  const slots = map;

  let entry = fresh ? undefined : (slots.get(key) as Entry<T> | undefined);
  if (!entry) {
    const controller = new AbortController();
    const created: Entry<T> = {
      promise: start(controller.signal),
      controller,
      refs: 0,
    };
    const settle = () => {
      if (slots.get(key) === created) slots.delete(key);
    };
    created.promise.then(settle, settle);
    slots.set(key, created as Entry<unknown>);
    entry = created;
  }
  const held = entry;
  held.refs++;

  let detached = false;
  return {
    promise: held.promise,
    detach() {
      if (detached) return;
      detached = true;
      held.refs--;
      if (held.refs > 0) return;
      queueMicrotask(() => {
        if (held.refs > 0) return;
        if (slots.get(key) === held) slots.delete(key);
        held.controller.abort();
      });
    },
  };
}
