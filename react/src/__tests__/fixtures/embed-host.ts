/**
 * A reference embedding host (R-19): the flows a product that embeds w6w
 * performs, written against the PUBLIC surface only — `@w6w/sdk` methods,
 * `createW6WUiAdapter` and the flow converter. It is compiled by
 * `tsconfig.embed-fixture.json`, source-scanned for workaround constructs, and
 * run against a stub transport by `embed-fixture.test.ts`.
 *
 * Nothing here reaches into the console namespace, issues a raw request, casts
 * through `unknown`, or spells an API path: if a flow below needs one of those,
 * the SDK has a gap and the gap is the bug, not the fixture.
 */
import type { ConnectionSummary, W6WClient } from "@w6w/sdk";
import { createW6WUiAdapter } from "../../adapter.ts";
import { fromFlowWorkflow, toFlowWorkflow } from "../../flow-workflow.ts";

/** The `W6WApi` handed to the visual editor: the adapter, with NO added members. */
export function editorApi(client: W6WClient): ReturnType<typeof createW6WUiAdapter> {
  return createW6WUiAdapter(client);
}

/** Workflow editor lifecycle. Returns the `updatedAt` held after the revert refresh. */
export async function workflowLifecycle(client: W6WClient): Promise<string> {
  const created = await client.workflows.create({
    manifestVersion: "1",
    id: "wf_embed",
    name: "embed",
    steps: [],
  });

  // Load, edit through the typed editor shape, save with the concurrency token.
  const loaded = await client.workflows.get(created.workflow.id);
  const flow = toFlowWorkflow(loaded.workflow);
  flow.name = "embed (edited)";
  const saved = await client.workflows.update(created.workflow.id, fromFlowWorkflow(flow), {
    ifUnmodifiedSince: loaded.updatedAt,
  });

  // Draft run executes the STORED row, so it comes after the save.
  await client.workflows.run(created.workflow.id, { allowUnpublished: true, wait: true });

  await client.workflows.publish(created.workflow.id);
  const versions = await client.workflows.listVersions(created.workflow.id);
  const current = versions.currentPublishedVersion ?? 1;
  await client.workflows.getVersion(created.workflow.id, current);
  await client.workflows.runVersion(created.workflow.id, current, { wait: true });

  // Revert rewrites the stored row: the held token is stale, so re-read it.
  await client.workflows.revert(created.workflow.id, current);
  const refreshed = await client.workflows.get(created.workflow.id);

  await client.workflows.disable(created.workflow.id);
  await client.workflows.enable(created.workflow.id);
  await client.workflows.archive(created.workflow.id);
  await client.workflows.delete(created.workflow.id);
  return saved.updatedAt === refreshed.updatedAt ? saved.updatedAt : refreshed.updatedAt;
}

/** Function lifecycle: last-write-wins, so no token on save. */
export async function functionLifecycle(client: W6WClient): Promise<void> {
  const created = await client.functions.create({ id: "fn_embed", name: "embed" });
  const loaded = await client.functions.get(created.id);
  await client.functions.update(created.id, { ...loaded.function, name: "embed (edited)" });

  await client.functions.run(created.id, { payload: { a: 1 }, allowUnpublished: true });

  await client.functions.publish(created.id);
  const versions = await client.functions.listVersions(created.id);
  const current = versions.currentPublishedVersion ?? 1;
  await client.functions.getVersion(created.id, current);
  await client.functions.runVersion(created.id, current, { payload: { a: 1 } });
  await client.functions.revert(created.id, current);

  await client.functions.disable(created.id);
  await client.functions.enable(created.id);
  await client.functions.archive(created.id);
  await client.functions.delete(created.id);
}

/** One rendered integrations row. */
export interface IntegrationRow {
  id: string;
  label: string;
  deletable: boolean;
}

/** Integrations screen: inline `app` first, `apps.byIds` only for rows without it. */
export async function integrations(client: W6WClient): Promise<IntegrationRow[]> {
  const connections: ConnectionSummary[] = await client.connections.list();
  const missing = connections.filter((c) => !c.app).map((c) => c.appId);
  const fetched = await client.apps.byIds(missing);
  const names = new Map(fetched.map((a) => [a.id, a.displayName]));

  const rows = connections.map((c) => ({
    id: c.id,
    label: c.app?.displayName ?? names.get(c.appId) ?? c.appId,
    deletable: c.builtIn !== true,
  }));

  const first = rows.find((r) => r.deletable);
  if (first) {
    await client.connections.get(first.id);
    await client.connections.delete(first.id);
  }
  return rows;
}

/** Dashboard: stats plus the default project. Returns the default project's id. */
export async function dashboard(client: W6WClient): Promise<string | undefined> {
  await client.dashboard.stats({ bucket: "day" });
  const projects = await client.projects.list();
  return projects.find((p) => p.isDefault)?.id;
}

/** The server's per-request cap on `reliability.list`; batching is HOST logic. */
const RELIABILITY_BATCH = 10;

/** Reliability board: members, then host-side batches of at most ten ids. */
export async function reliability(client: W6WClient, project: string): Promise<number> {
  const members = await client.reliability.members(project);
  let services = 0;
  for (let i = 0; i < members.appIds.length; i += RELIABILITY_BATCH) {
    const board = await client.reliability.list(
      project,
      members.appIds.slice(i, i + RELIABILITY_BATCH),
    );
    services += board.services.length;
  }
  return services;
}
