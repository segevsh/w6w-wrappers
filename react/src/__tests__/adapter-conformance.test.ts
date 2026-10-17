/**
 * RUNTIME conformance of `createW6WUiAdapter` against the pinned `@w6w/ui`
 * `W6WApi` (R-17). `ui-conformance.check.ts` is type-only and so cannot see a
 * member that is present in the type but missing, mis-forwarded, or
 * error-body-dropping at run time. Three things are asserted here:
 *
 * 1. Every member name is READ from the installed `@w6w/ui` declarations
 *    (`provider.d.ts`'s `interface W6WApi`) — not the adapter's hand-copied
 *    interface — and each is a function on the adapter.
 * 2. Forwarding: each member, driven with sentinel arguments through a stub
 *    transport, produces the literal wire request listed in `CASES`.
 * 3. Error bodies: a 4xx JSON body per member reaches the caller as `err.body`,
 *    deep-equal to the literal body the server sent.
 *
 * The pinned UI is read as TEXT; nothing imports `@w6w/ui` at run time.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { FetchLike } from "@w6w/sdk";
import { W6WClient } from "@w6w/sdk";
import { createW6WUiAdapter } from "../adapter.ts";

const PROVIDER_SRC = fileURLToPath(new URL("./provider.d.ts", import.meta.resolve("@w6w/ui")));

/** `W6WApi` members read from the pinned UI source: `name` and whether it is `?`-optional. */
function readUiMembers(): { name: string; optional: boolean }[] {
  const src = readFileSync(PROVIDER_SRC, "utf8");
  const start = src.indexOf("export interface W6WApi {");
  if (start < 0) return [];
  const end = src.indexOf("\n}", start);
  const body = src.slice(start, end);
  const members: { name: string; optional: boolean }[] = [];
  // Declaration members have four-space indentation; nested fields and JSDoc do not match.
  for (const m of body.matchAll(/^ {4}([A-Za-z]\w*)(\?)?\(/gm)) {
    members.push({ name: m[1] as string, optional: m[2] === "?" });
  }
  return members;
}

const uiMembers = readUiMembers();
const required = uiMembers.filter((m) => !m.optional).map((m) => m.name);
const optional = uiMembers.filter((m) => m.optional).map((m) => m.name);

interface Call {
  method: string;
  path: string;
  body: string | null;
}

function transport(status: number, payload: unknown): { client: W6WClient; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = (input, init) => {
    calls.push({
      method: init?.method ?? "GET",
      path: input.replace("https://api.example.com", ""),
      body: typeof init?.body === "string" ? init.body : null,
    });
    return Promise.resolve(
      new Response(JSON.stringify(payload), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
  };
  return {
    client: new W6WClient({ baseUrl: "https://api.example.com", token: "tok", fetch }),
    calls,
  };
}

interface Case {
  member: string;
  args: unknown[];
  method: string;
  path: string;
  /** The literal JSON body the wire request must carry (`null` = no body). */
  body: unknown;
}

const CASES: Case[] = [
  { member: "listApps", args: [], method: "GET", path: "/apps?limit=200", body: null },
  {
    member: "listAppsPage",
    args: [{ q: "x", category: "ai", cursor: "c", limit: 5, compact: true }],
    method: "GET",
    path: "/apps?q=x&category=ai&limit=5&cursor=c&compact=true",
    body: null,
  },
  {
    member: "listAppsByIds",
    args: [["a", "b"]],
    method: "GET",
    path: "/apps?ids=a%2Cb",
    body: null,
  },
  { member: "getAppAuth", args: ["app1"], method: "GET", path: "/apps/app1/auths", body: null },
  {
    member: "createConnection",
    args: ["app1", { authKey: "k", credential: { t: 1 }, displayName: "D" }],
    method: "POST",
    path: "/apps/app1/connections",
    body: { authKey: "k", credential: { t: 1 }, displayName: "D" },
  },
  {
    member: "startAppOAuthFlow",
    args: ["app1", "oauth", { displayName: "D" }],
    method: "POST",
    path: "/apps/app1/oauth-config/oauth/authorize-url",
    body: { displayName: "D" },
  },
  { member: "getAppActions", args: ["app1"], method: "GET", path: "/apps/app1", body: null },
  {
    member: "listConnectionsForApp",
    args: ["app1"],
    method: "GET",
    path: "/apps/app1/connections",
    body: null,
  },
  { member: "listConnections", args: [], method: "GET", path: "/connections", body: null },
  {
    member: "invokeAction",
    args: ["app1", "act", { p: 1 }, { connectionId: "c1", project: "pr" }],
    method: "POST",
    path: "/apps/app1/actions/act/invoke",
    body: { params: { p: 1 }, connectionId: "c1", project: "pr" },
  },
  {
    member: "listSavedTests",
    args: ["c1"],
    method: "GET",
    path: "/connections/c1/saved-tests",
    body: null,
  },
  {
    member: "createSavedTest",
    args: ["c1", { actionKey: "a", name: "n", values: { v: 1 } }],
    method: "POST",
    path: "/connections/c1/saved-tests",
    body: { actionKey: "a", name: "n", values: { v: 1 } },
  },
  {
    member: "updateSavedTest",
    args: ["c1", "t1", { name: "n2" }],
    method: "PATCH",
    path: "/connections/c1/saved-tests/t1",
    body: { name: "n2" },
  },
  {
    member: "deleteSavedTest",
    args: ["c1", "t1"],
    method: "DELETE",
    path: "/connections/c1/saved-tests/t1",
    body: null,
  },
  {
    member: "recordTestRun",
    args: ["c1", { savedTestId: "t1", actionKey: "a", ok: true }],
    method: "POST",
    path: "/connections/c1/test-runs",
    body: { savedTestId: "t1", actionKey: "a", ok: true },
  },
  {
    member: "listTestRuns",
    args: ["c1"],
    method: "GET",
    path: "/connections/c1/test-runs",
    body: null,
  },
  {
    member: "saveStepTest",
    args: ["wf1", "s1", { name: "n", input: { i: 1 }, with: { w: 1 } }],
    method: "POST",
    path: "/workflows/wf1/steps/s1/tests",
    body: { name: "n", input: { i: 1 }, with: { w: 1 } },
  },
  {
    member: "recordStepTestRun",
    args: ["wf1", "s1", { stepTestId: "st1", status: "ok" }],
    method: "POST",
    path: "/workflows/wf1/steps/s1/test-runs",
    body: { stepTestId: "st1", status: "ok" },
  },
  {
    member: "listStepTests",
    args: ["wf1", "s1"],
    method: "GET",
    path: "/workflows/wf1/steps/s1/tests",
    body: null,
  },
  { member: "listTriggerApps", args: [], method: "GET", path: "/apps?limit=200", body: null },
  {
    member: "getAppTriggers",
    args: ["app1"],
    method: "GET",
    path: "/apps/app1/triggers",
    body: null,
  },
  {
    member: "listSubscriptionsForWorkflow",
    args: ["wf1"],
    method: "GET",
    path: "/workflows/wf1/subscriptions",
    body: null,
  },
  {
    member: "createSubscription",
    args: ["app1", "trig", { workflowId: "wf1", connectionId: "c1", params: { p: 1 } }],
    method: "POST",
    path: "/apps/app1/triggers/trig/subscriptions",
    body: { workflowId: "wf1", connectionId: "c1", params: { p: 1 } },
  },
  { member: "listFunctions", args: [], method: "GET", path: "/functions", body: null },
  { member: "getFunction", args: ["fn1"], method: "GET", path: "/functions/fn1", body: null },
  {
    member: "invokeFunction",
    args: ["fn1", { x: 1 }],
    method: "POST",
    path: "/functions/fn1/invoke",
    body: { inputs: { x: 1 } },
  },
  { member: "listWorkflows", args: [], method: "GET", path: "/workflows", body: null },
  { member: "getWorkflow", args: ["wf1"], method: "GET", path: "/workflows/wf1", body: null },
  {
    member: "runWorkflow",
    args: ["wf1", { variables: { a: 1 }, input: { b: 2 } }],
    method: "POST",
    path: "/workflows/wf1/run?wait=true",
    body: { variables: { a: 1 }, input: { b: 2 } },
  },
];

type Adapter = Record<string, (...args: unknown[]) => Promise<unknown>>;

test("the pinned UI contract is read from source: exactly 21 required + 8 optional members", () => {
  assert.equal(required.length, 21, `required members read: ${required.join(", ")}`);
  assert.equal(optional.length, 8, `optional members read: ${optional.join(", ")}`);
  assert.equal(new Set(uiMembers.map((m) => m.name)).size, 29);
});

test("every W6WApi member (required and optional) is a function on the adapter", () => {
  const adapter = createW6WUiAdapter(transport(200, {}).client) as unknown as Adapter;
  for (const name of [...required, ...optional]) {
    assert.equal(typeof adapter[name], "function", `adapter.${name} is not a function`);
  }
});

test("the forwarding/error table covers exactly the members read from the UI source", () => {
  assert.deepEqual(CASES.map((c) => c.member).sort(), [...required, ...optional].sort());
});

for (const c of CASES) {
  test(`${c.member} forwards its arguments to the expected wire request`, async () => {
    const { client, calls } = transport(200, {});
    const adapter = createW6WUiAdapter(client) as unknown as Adapter;
    // The empty `{}` response may not satisfy the member's unwrapping; only the
    // request it produced is under test here.
    await (adapter[c.member] as (...a: unknown[]) => Promise<unknown>)(...c.args).catch(
      () => undefined,
    );
    assert.equal(calls.length, 1, `${c.member} issued ${calls.length} requests`);
    const call = calls[0] as Call;
    assert.equal(call.method, c.method);
    assert.equal(call.path, c.path);
    assert.deepEqual(call.body === null ? null : JSON.parse(call.body), c.body);
  });

  test(`${c.member} preserves a 4xx JSON error body as err.body`, async () => {
    const errBody = { error: { code: "nope", message: "rejected", detail: { member: c.member } } };
    const { client } = transport(409, errBody);
    const adapter = createW6WUiAdapter(client) as unknown as Adapter;
    let caught: unknown;
    try {
      await (adapter[c.member] as (...a: unknown[]) => Promise<unknown>)(...c.args);
    } catch (err) {
      caught = err;
    }
    assert.ok(caught, `${c.member} did not reject on a 409`);
    assert.deepEqual((caught as { body?: unknown }).body, errBody);
  });
}

// A standalone case, not a CASES row: CASES' members must equal the UI member list exactly.
test("listAppsPage forwards snapshot and offset (offset 0 is sent) after cursor, before compact", async () => {
  const { client, calls } = transport(200, {});
  const adapter = createW6WUiAdapter(client) as unknown as Adapter;
  await adapter
    .listAppsPage({ snapshot: "lsn_s", offset: 0, limit: 50, compact: true })
    .catch(() => undefined);
  assert.equal(calls.length, 1);
  assert.equal((calls[0] as Call).path, "/apps?limit=50&snapshot=lsn_s&offset=0&compact=true");
});
