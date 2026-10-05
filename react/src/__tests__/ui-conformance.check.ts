/**
 * Type-only: asserts `createW6WUiAdapter`'s return type is assignable to the
 * REAL `@w6w/ui` `W6WApi` — not the hand-duplicate in `../adapter.ts`. Never
 * executed; only *compiled*, by `tsconfig.ui-conformance.json`
 * (`ui-conformance.test.ts` runs that project and asserts exit 0, surfacing
 * tsc's own output on failure — the output names whichever member went
 * missing).
 *
 * `@w6w/ui`'s root barrel (`import type { W6WApi } from "@w6w/ui"`) reaches
 * `@w6w/expr` (`packages/core`) through its own import chain; npm installs
 * the `github:w6w-io/w6w-ui#<sha>` devDependency's OWN `package.json`
 * dependency on `github:w6w-io/w6w-core#path:packages/expr`, but npm does
 * not honor a `#path:` subpath on a `github:` spec — it installs core's
 * REPO ROOT as `@w6w/expr`, which has no matching exports and fails
 * `TS2307` the moment anything resolves the barrel. So this imports `W6WApi`
 * by RELATIVE PATH straight into `provider.tsx` instead — that file's own
 * closure (`./theme.ts` → `./types.ts` → `react`) compiles clean standalone,
 * with no `@w6w/expr` in it anywhere (building-blocks.md §1).
 *
 * @module
 */
import type { W6WApi } from "../../node_modules/@w6w/ui/src/provider.tsx";
import type { createW6WUiAdapter } from "../adapter.ts";

// An assignment to an explicitly-typed, EXPORTED const — not a bare
// expression — so a real tsc diagnostic fires (naming every missing/
// mismatched member) rather than a lint-only "unused variable". The double
// cast through `unknown` is needed only because `{}` itself does not satisfy
// `ReturnType<typeof createW6WUiAdapter>`; it does nothing to the check
// below, which is the `: W6WApi` annotation on the left.
export const _uiConformanceCheck: W6WApi = {} as unknown as ReturnType<typeof createW6WUiAdapter>;
