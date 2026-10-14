/**
 * `toFlowWorkflow` / `fromFlowWorkflow` — a validating converter between the
 * SDK's deliberately OPAQUE `WorkflowDefinition` (`Record<string, unknown>`,
 * `node/src/workflows.ts`) and {@link FlowWorkflowShape}, a STRUCTURAL MIRROR
 * of `@w6w/ui`'s `FlowWorkflow` (`src/flow-types.ts`) — the typed shape the
 * visual editor reads and writes.
 *
 * This lane is MIT and takes no runtime dependency on `@w6w/ui` (not even a
 * type import in the shipped build), so the mirror below is transcribed by
 * hand. `ui-conformance.check.ts` pins it in BOTH directions at compile time:
 * ui's `FlowWorkflow` is assignable to {@link fromFlowWorkflow}'s parameter,
 * and {@link FlowWorkflowShape} is assignable to ui's `FlowWorkflow`.
 *
 * The mirror carries no index signature (ui's interfaces have none, and an
 * index signature would break the first direction), yet unknown keys — `retry`,
 * `onError`, `ports`, a host's `x-*` extension — are never dropped: both
 * directions copy by spread, so a definition a newer server enriched
 * round-trips untouched. The validation is the minimum the editor needs to not
 * crash (see {@link toFlowWorkflow}); it does not check the contents of
 * `steps[].uses` or any other nested field.
 *
 * @module
 */
import type { WorkflowDefinition } from "@w6w/sdk";

/** Mirror of ui's `FlowStep`. Unknown keys are preserved at runtime. */
export interface FlowStepShape {
  id: string;
  uses: { app: string; action: string; connection?: string | null };
  ports?: { in?: number | "many"; out?: number | "many" };
  with?: Record<string, unknown>;
  retry?: {
    maxAttempts: number;
    backoff?: "fixed" | "exponential";
    delayMs?: number;
  };
  onError?: "fail" | "continue" | "continue-record";
  notes?: string;
  fanOut?: "sequential" | "parallel";
  position?: { x: number; y: number };
}

/** Mirror of ui's `FlowEdge`. */
export interface FlowEdgeShape {
  from: string;
  to: string;
  when?: "success" | "error";
}

/** Mirror of ui's `FlowWorkflow`. */
export interface FlowWorkflowShape {
  manifestVersion: string;
  id: string;
  name: string;
  displayName?: string;
  description?: string;
  variables?: Array<{ key: string; type?: string; required?: boolean; default?: unknown }>;
  steps: FlowStepShape[];
  edges?: FlowEdgeShape[];
  settings?: {
    autoSave?: boolean;
    savePosition?: boolean;
    viewport?: { x: number; y: number; zoom: number };
  };
}

/** One violation found by {@link toFlowWorkflow}. */
export interface WorkflowShapeIssue {
  /** Dotted/indexed location in the definition, e.g. `steps[2].id`. */
  path: string;
  message: string;
}

/** Thrown by {@link toFlowWorkflow}; `issues` lists EVERY violation, not just the first. */
export class WorkflowShapeError extends Error {
  readonly issues: WorkflowShapeIssue[];

  constructor(issues: WorkflowShapeIssue[]) {
    super(
      `Workflow definition is not a valid flow workflow: ${issues
        .map((i) => `${i.path}: ${i.message}`)
        .join("; ")}`,
    );
    this.name = "WorkflowShapeError";
    this.issues = issues;
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Validate an opaque `WorkflowDefinition` and return it as a
 * {@link FlowWorkflowShape}. Requires string `manifestVersion`/`id`/`name`; a
 * `steps` array of objects each with a string `id`; and, when present,
 * `edges` an array, `settings` an object, `variables` an array. Anything else
 * throws a {@link WorkflowShapeError} listing every violation. The result is a
 * copy (top level and each step) that keeps every unknown key.
 */
export function toFlowWorkflow(def: WorkflowDefinition): FlowWorkflowShape {
  const issues: WorkflowShapeIssue[] = [];
  const input: unknown = def;
  if (!isObject(input)) {
    throw new WorkflowShapeError([{ path: "", message: "must be an object" }]);
  }
  for (const key of ["manifestVersion", "id", "name"]) {
    if (typeof input[key] !== "string") issues.push({ path: key, message: "must be a string" });
  }
  const steps = input.steps;
  if (!Array.isArray(steps)) {
    issues.push({ path: "steps", message: "must be an array" });
  } else {
    steps.forEach((step: unknown, i) => {
      if (!isObject(step)) {
        issues.push({ path: `steps[${i}]`, message: "must be an object" });
      } else if (typeof step.id !== "string") {
        issues.push({ path: `steps[${i}].id`, message: "must be a string" });
      }
    });
  }
  if (input.edges !== undefined && !Array.isArray(input.edges)) {
    issues.push({ path: "edges", message: "must be an array" });
  }
  if (input.settings !== undefined && !isObject(input.settings)) {
    issues.push({ path: "settings", message: "must be an object" });
  }
  if (input.variables !== undefined && !Array.isArray(input.variables)) {
    issues.push({ path: "variables", message: "must be an array" });
  }
  if (issues.length > 0) throw new WorkflowShapeError(issues);

  return {
    ...input,
    steps: (steps as Record<string, unknown>[]).map((s) => ({ ...s })),
  } as unknown as FlowWorkflowShape;
}

/**
 * The inverse of {@link toFlowWorkflow}: a {@link FlowWorkflowShape} (the
 * editor's output) back to the opaque `WorkflowDefinition` the SDK sends.
 * Spread-copies the top level and each step, so unknown keys survive and no
 * caller cast is needed.
 */
export function fromFlowWorkflow(flow: FlowWorkflowShape): WorkflowDefinition {
  return { ...flow, steps: flow.steps.map((s) => ({ ...s })) };
}
