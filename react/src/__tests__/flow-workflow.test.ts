/**
 * `toFlowWorkflow` / `fromFlowWorkflow` — validation (every violation listed)
 * and unknown-key preservation in both directions.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { WorkflowDefinition } from "@w6w/sdk";
import { WorkflowShapeError, fromFlowWorkflow, toFlowWorkflow } from "../flow-workflow.ts";

function valid(): WorkflowDefinition {
  return {
    manifestVersion: "1",
    id: "wf_1",
    name: "demo",
    "x-host": { owner: "me" },
    steps: [
      {
        id: "a",
        uses: { app: "@w6w/trigger", action: "manual" },
        retry: { maxAttempts: 3 },
        onError: "continue",
        ports: { out: "many" },
        "x-host": 1,
      },
      { id: "b", uses: { app: "@w6w/http", action: "request" } },
    ],
    edges: [{ from: "a", to: "b" }],
    settings: { autoSave: true },
    variables: [{ key: "k" }],
  };
}

test("a valid definition converts and keeps every unknown key, top level and per step", () => {
  const flow = toFlowWorkflow(valid());
  assert.equal(flow.id, "wf_1");
  assert.deepEqual((flow as unknown as Record<string, unknown>)["x-host"], { owner: "me" });
  assert.equal((flow.steps[0] as unknown as Record<string, unknown>)["x-host"], 1);
  assert.deepEqual(flow.steps[0]?.retry, { maxAttempts: 3 });
  assert.equal(flow.steps[0]?.onError, "continue");
  assert.deepEqual(flow.steps[0]?.ports, { out: "many" });
});

test("fromFlowWorkflow(toFlowWorkflow(def)) deep-equals def", () => {
  const def = valid();
  assert.deepEqual(fromFlowWorkflow(toFlowWorkflow(def)), def);
});

test("a minimal definition (no edges/settings/variables) is valid", () => {
  const def = { manifestVersion: "1", id: "w", name: "n", steps: [] };
  assert.deepEqual(fromFlowWorkflow(toFlowWorkflow(def)), def);
});

test("the converter copies: mutating the result does not touch the input", () => {
  const def = valid();
  const flow = toFlowWorkflow(def);
  flow.name = "changed";
  (flow.steps[0] as { id: string }).id = "zzz";
  assert.equal(def.name, "demo");
  assert.equal((def.steps as { id: string }[])[0]?.id, "a");
});

function issues(def: WorkflowDefinition): { path: string; message: string }[] {
  try {
    toFlowWorkflow(def);
  } catch (err) {
    assert.ok(err instanceof WorkflowShapeError, "threw something other than WorkflowShapeError");
    assert.equal(err.name, "WorkflowShapeError");
    return err.issues;
  }
  assert.fail("expected toFlowWorkflow to throw");
}

test("every violation is reported, not just the first", () => {
  const got = issues({
    manifestVersion: 1,
    id: 2,
    name: null,
    steps: [{ id: "ok" }, { id: 5 }, "str", null],
    edges: {},
    settings: [],
    variables: "v",
  });
  assert.deepEqual(
    got.map((i) => i.path),
    [
      "manifestVersion",
      "id",
      "name",
      "steps[1].id",
      "steps[2]",
      "steps[3]",
      "edges",
      "settings",
      "variables",
    ],
  );
  for (const i of got) assert.ok(i.message.length > 0);
});

test("a non-array steps is rejected", () => {
  assert.deepEqual(
    issues({ manifestVersion: "1", id: "w", name: "n", steps: { a: 1 } }).map((i) => i.path),
    ["steps"],
  );
});

test("nodes[] is accepted; canvas and unknown keys survive", () => {
  const flow = toFlowWorkflow({
    manifestVersion: "1", id: "w", name: "n",
    nodes: [{ id: "a", "x-host": 1 }],
    canvas: { notes: [] },
  });
  const rec = flow as unknown as Record<string, unknown>;
  assert.deepEqual(rec.canvas, { notes: [] });
  assert.equal((rec.nodes as { id: string }[])[0]?.id, "a");
  assert.equal(rec.steps, undefined);
});

test("nodes entries are checked at nodes[i].id", () => {
  assert.deepEqual(
    issues({ manifestVersion: "1", id: "w", name: "n", nodes: [{ id: 5 }] }).map((i) => i.path),
    ["nodes[0].id"],
  );
});

test("nodes combined with steps is refused", () => {
  assert.deepEqual(
    issues({ manifestVersion: "1", id: "w", name: "n", nodes: [], steps: [] }),
    [{ path: "nodes", message: "must not be combined with steps" }],
  );
});

test("neither nodes nor steps is refused", () => {
  assert.deepEqual(issues({ manifestVersion: "1", id: "w", name: "n" }), [
    { path: "nodes", message: "must be an array" },
  ]);
});

test("missing steps is rejected alongside other violations", () => {
  assert.deepEqual(
    issues({ manifestVersion: "1", id: "w" }).map((i) => i.path),
    ["name", "nodes"],
  );
});

test("the error message names each issue", () => {
  try {
    toFlowWorkflow({ manifestVersion: "1", id: "w", name: 3, steps: 4 });
  } catch (err) {
    assert.match((err as Error).message, /name: must be a string/);
    assert.match((err as Error).message, /steps: must be an array/);
    return;
  }
  assert.fail("expected throw");
});
