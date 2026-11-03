// @mock-of studio/packages/ui/src/index.ts
/**
 * In-repo MOCK of the `@w6w/ui` surface react calls: the `W6WApi` type (types only; react calls no
 * ui value). It mirrors the member set of the PINNED `@w6w/ui` 0.1.0 `W6WApi` — 21 required, 8
 * `?`-optional — with the same arity and optionality; payload types are loosened to `unknown`
 * records because react's tests exercise forwarding, not ui's payload types. The real check
 * against `@w6w/ui` is the monorepo's `deploy/verify-cross.sh`, which also drift-checks this file
 * (no `exact` for `W6WApi`: current ui source has since grown members react does not forward).
 * Keep the 4-space member indentation: `adapter-conformance.test.ts` parses it.
 */
type Rec = Record<string, unknown>;

export interface W6WApi {
    listApps?(): Promise<unknown[]>;
    listAppsPage?(options?: {
      q?: string;
      category?: string;
      cursor?: string;
      limit?: number;
      compact?: boolean;
    }): Promise<unknown>;
    listAppsByIds?(ids: readonly string[], options?: { signal?: AbortSignal }): Promise<unknown[]>;
    getAppAuth(appId: string): Promise<unknown[]>;
    createConnection(appId: string, body: Rec): Promise<unknown>;
    startAppOAuthFlow(
      appId: string,
      authKey: string,
      body: { displayName?: string },
    ): Promise<{ authorizationUrl: string }>;
    getAppActions(appId: string): Promise<unknown[]>;
    listConnectionsForApp(appId: string): Promise<unknown[]>;
    listConnections(): Promise<unknown[]>;
    invokeAction(
      appId: string,
      actionKey: string,
      params: Rec,
      opts?: { connectionId?: string; project?: string },
    ): Promise<{ value: unknown; logs?: string[] }>;
    listSavedTests(connectionId: string): Promise<unknown[]>;
    createSavedTest(connectionId: string, body: Rec): Promise<unknown>;
    updateSavedTest(connectionId: string, id: string, patch: Rec): Promise<unknown>;
    deleteSavedTest(connectionId: string, id: string): Promise<void>;
    recordTestRun(connId: string, body: Rec): Promise<void>;
    listTestRuns?(connectionId: string): Promise<unknown[]>;
    saveStepTest(workflowId: string, stepId: string, body: Rec): Promise<unknown>;
    recordStepTestRun(workflowId: string, stepId: string, body: Rec): Promise<void>;
    listStepTests(workflowId: string, stepId: string): Promise<unknown[]>;
    listFunctions(): Promise<unknown[]>;
    getFunction(id: string): Promise<unknown>;
    invokeFunction(id: string, inputs: Rec): Promise<unknown>;
    listWorkflows(): Promise<unknown[]>;
    getWorkflow(id: string): Promise<unknown>;
    runWorkflow(
      id: string,
      opts?: { variables?: Rec; input?: Rec },
    ): Promise<{ runId: string; status: string; output?: unknown; error?: unknown; terminal: boolean }>;
    listTriggerApps?(): Promise<unknown[]>;
    getAppTriggers?(appId: string): Promise<unknown[]>;
    listSubscriptionsForWorkflow?(workflowId: string): Promise<unknown[]>;
    createSubscription?(appId: string, triggerKey: string, input: Rec): Promise<unknown>;
}
