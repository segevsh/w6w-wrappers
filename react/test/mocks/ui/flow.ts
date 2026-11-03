// @mock-of studio/packages/ui/src/flow.ts
/**
 * In-repo MOCK of the `@w6w/ui/flow` surface react's converter mirror is checked against: the
 * `FlowWorkflow`/`FlowStep`/`FlowEdge` types of the PINNED `@w6w/ui` 0.1.0 (types only). The real
 * check is the monorepo's `deploy/verify-cross.sh`.
 */
export interface FlowStep {
  id: string;
  uses: { app: string; action: string; connection?: string | null };
  ports?: { in?: number | "many"; out?: number | "many" };
  with?: Record<string, unknown>;
  retry?: { maxAttempts: number; backoff?: "fixed" | "exponential"; delayMs?: number };
  onError?: "fail" | "continue" | "continue-record";
  notes?: string;
  fanOut?: "sequential" | "parallel";
  position?: { x: number; y: number };
}

export interface FlowEdge {
  from: string;
  to: string;
  when?: "success" | "error";
}

export interface FlowWorkflow {
  manifestVersion: string;
  id: string;
  name: string;
  displayName?: string;
  description?: string;
  variables?: Array<{ key: string; type?: string; required?: boolean; default?: unknown }>;
  steps: FlowStep[];
  edges?: FlowEdge[];
  settings?: {
    autoSave?: boolean;
    savePosition?: boolean;
    viewport?: { x: number; y: number; zoom: number };
  };
}
