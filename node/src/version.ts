/**
 * The published version of this package.
 *
 * It is the same string as `package.json`'s `version` and the monorepo's
 * `packages/wrappers/VERSION` — the single source of truth all three w6w wrappers
 * publish under (see `docs/parity.md`). `tests/version_test.ts` fails if any of
 * those disagree, so this constant cannot drift silently.
 *
 * The explicit `: string` annotation is required, not decorative: it keeps the
 * emitted type `string` rather than the literal, and `scripts/check-lockstep.py`
 * matches this exact declaration shape.
 */
export const VERSION: string = "0.12.0";
