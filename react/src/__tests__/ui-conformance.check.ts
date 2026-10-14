/**
 * Type-only: asserts `createW6WUiAdapter`'s return type is assignable to the
 * REAL `@w6w/ui` `W6WApi` — not the hand-duplicate in `../adapter.ts`. Never
 * executed; only *compiled*, by `tsconfig.ui-conformance.json`
 * (`ui-conformance.test.ts` runs that project and asserts exit 0, surfacing
 * tsc's own output on failure — the output names whichever member went
 * missing).
 *
 * Compile against the published UI's public exports. Its expression dependency
 * is also available from npm, so this checks the same declarations consumers use.
 *
 * @module
 */

import type { W6WApi } from "@w6w/ui";
import type { FlowWorkflow } from "@w6w/ui/flow";
import type { createW6WUiAdapter } from "../adapter.ts";
import type { FlowWorkflowShape, fromFlowWorkflow } from "../flow-workflow.ts";

// An assignment to an explicitly-typed, EXPORTED const — not a bare
// expression — so a real tsc diagnostic fires (naming every missing/
// mismatched member) rather than a lint-only "unused variable". The double
// cast through `unknown` is needed only because `{}` itself does not satisfy
// `ReturnType<typeof createW6WUiAdapter>`; it does nothing to the check
// below, which is the `: W6WApi` annotation on the left.
export const _uiConformanceCheck: W6WApi = {} as unknown as ReturnType<typeof createW6WUiAdapter>;

// The `FlowWorkflow` converter's structural mirror, both directions (R-7):
// ui's real `FlowWorkflow` is accepted by `fromFlowWorkflow`, and the mirror
// is accepted wherever ui expects a `FlowWorkflow`.
export const _uiFlowIntoConverter: Parameters<typeof fromFlowWorkflow>[0] = {} as FlowWorkflow;
export const _converterShapeIntoUi: FlowWorkflow = {} as FlowWorkflowShape;
