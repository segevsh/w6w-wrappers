/**
 * The embedding host fixture (`fixtures/embed-host.ts`, R-19) under three
 * checks: it compiles against the public surface (`tsconfig.embed-fixture.json`),
 * its source contains none of the banned workaround constructs (with a negative
 * control proving the scanner flags each one), and each flow produces exactly
 * the expected (method, path) sequence against a stub transport.
 *
 * The scanner mirrors the idiom of `studio/src/lib/no-direct-api-access.ts`
 * (read-only reference): a list of named patterns run over the source text.
 * It scans the RAW source, comments included — the fixture's prose must not
 * name a banned construct either.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { FetchLike } from "@w6w/sdk";
import { W6WClient } from "@w6w/sdk";
import {
  dashboard,
  editorApi,
  functionLifecycle,
  integrations,
  reliability,
  workflowLifecycle,
} from "./fixtures/embed-host.ts";

const reactRoot = fileURLToPath(new URL("../..", import.meta.url));
const tscBin = fileURLToPath(new URL("../../node_modules/typescript/bin/tsc", import.meta.url));
const fixtureSource = readFileSync(new URL("./fixtures/embed-host.ts", import.meta.url), "utf8");

// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------

interface Rule {
  name: string;
  pattern: RegExp;
}

const API_SEGMENTS = "workflows|functions|connections|apps|projects|dashboard|reliability";

const BANNED: Rule[] = [
  { name: "console-namespace", pattern: /\bclient\s*\.\s*console\b|\.\s*console\s*\./ },
  { name: "raw-request", pattern: /\.\s*request\s*[<(]/ },
  { name: "unknown-cast", pattern: /\bas\s+unknown\s+as\b|\bas\s+any\b/ },
  {
    name: "api-path-literal",
    pattern: new RegExp(`(["'\`])[^"'\`\\n]*/(${API_SEGMENTS})\\b[^"'\`\\n]*\\1`),
  },
  { name: "adapter-spread", pattern: /\.\.\.\s*createW6WUiAdapter\s*\(/ },
  {
    name: "six-method-patch",
    pattern:
      /\b(listFunctions|getFunction|invokeFunction|listWorkflows|getWorkflow|runWorkflow)\s*[:(]/,
  },
];

function scan(source: string, rules: Rule[] = BANNED): string[] {
  return rules.filter((r) => r.pattern.test(source)).map((r) => r.name);
}

// ---------------------------------------------------------------------------
// Compile
// ---------------------------------------------------------------------------

test("embed fixture: compiles against the public surface under the react build options", () => {
  const result = spawnSync(process.execPath, [tscBin, "-p", "tsconfig.embed-fixture.json"], {
    cwd: reactRoot,
    encoding: "utf8",
  });
  assert.equal(
    result.status,
    0,
    `tsc -p tsconfig.embed-fixture.json failed (exit ${result.status}):\n${result.stdout}${result.stderr}`,
  );
});

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

test("embed fixture: source contains none of the banned workaround constructs", () => {
  assert.deepEqual(scan(fixtureSource), []);
});

test("embed fixture: the scanner flags each banned construct in a literal sample (negative control)", () => {
  const samples: Record<string, string> = {
    "console-namespace": "await client.console.workflows.get(id);",
    "raw-request": 'await client.request({ method: "POST" });',
    "unknown-cast": "const x = def as unknown as Record<string, unknown>;",
    "api-path-literal": 'const p = "/workflows/x/publish";',
    "adapter-spread": "const api = { ...createW6WUiAdapter(client) };",
    "six-method-patch": "const api = { listFunctions: async () => [] };",
  };
  assert.equal(BANNED.length, Object.keys(samples).length);
  for (const rule of BANNED) {
    assert.deepEqual(scan(samples[rule.name] ?? "", BANNED), [rule.name], rule.name);
  }
  const anyCast = scan("const x = def as any;");
  assert.deepEqual(anyCast, ["unknown-cast"]);
  const template = scan("const p = `/connections/${id}`;");
  assert.deepEqual(template, ["api-path-literal"]);
});

test("embed fixture: positive census — every public method the flows name is called", () => {
  const methods = [
    "workflows.create",
    "workflows.get",
    "workflows.update",
    "workflows.run",
    "workflows.publish",
    "workflows.listVersions",
    "workflows.getVersion",
    "workflows.runVersion",
    "workflows.revert",
    "workflows.enable",
    "workflows.disable",
    "workflows.archive",
    "workflows.delete",
    "functions.create",
    "functions.get",
    "functions.update",
    "functions.run",
    "functions.publish",
    "functions.listVersions",
    "functions.getVersion",
    "functions.runVersion",
    "functions.revert",
    "functions.enable",
    "functions.disable",
    "functions.archive",
    "functions.delete",
    "connections.list",
    "connections.get",
    "connections.delete",
    "apps.byIds",
    "dashboard.stats",
    "projects.list",
    "reliability.members",
    "reliability.list",
  ];
  const missing = methods.filter((m) => !new RegExp(`\\bclient\\.${m}\\(`).test(fixtureSource));
  assert.deepEqual(missing, []);
  for (const fn of ["createW6WUiAdapter", "toFlowWorkflow", "fromFlowWorkflow"]) {
    assert.match(fixtureSource, new RegExp(`\\b${fn}\\(`), fn);
  }
  assert.match(fixtureSource, /allowUnpublished: true/);
  assert.match(fixtureSource, /ifUnmodifiedSince/);
});

// ---------------------------------------------------------------------------
// Flows against a stub transport
// ---------------------------------------------------------------------------

interface Recorded {
  line: string;
  body: unknown;
  headers: Headers;
}

const BASE = "https://api.example.com";
const T1 = "2026-01-01T00:00:00.000Z";
const T2 = "2026-01-02T00:00:00.000Z";
const T3 = "2026-01-03T00:00:00.000Z";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const wfDef = { manifestVersion: "1", id: "wf_embed", name: "embed", steps: [] };
const version = { versionNumber: 1, createdAt: T1, createdBy: null, isCurrentPublished: true };
const appRow = (id: string) => ({
  id,
  displayName: id.toUpperCase(),
  version: "1.0.0",
  description: "",
  categories: [],
  sourceRef: "",
  importedAt: T1,
});
const conn = (id: string, appId: string, extra: Record<string, unknown>) => ({
  id,
  appId,
  authKey: "key",
  tenant: "t",
  subject: "s",
  displayName: id,
  state: "active",
  profile: {},
  lastTestOk: null,
  lastTestedAt: null,
  createdAt: T1,
  updatedAt: T1,
  ...extra,
});
const memberIds = Array.from({ length: 12 }, (_, i) => `app${i}`);

function respond(line: string, seen: number): Response {
  switch (line) {
    case "POST /workflows":
      return json({
        workflow: { id: "wf_embed", name: "embed" },
        scheduled: false,
        updatedAt: seen === 0 ? T1 : T2,
      });
    case "GET /workflows/wf_embed":
      return json({ workflow: wfDef, sourceRef: null, updatedAt: seen === 0 ? T1 : T3 });
    case "POST /workflows/wf_embed/run?wait=true":
    case "POST /workflows/wf_embed/versions/1/run?wait=true":
      return json({ runId: "run_1", status: "succeeded", steps: {} });
    case "POST /workflows/wf_embed/archive":
      return json({ workflow: wfDef });
    case "POST /functions":
      return json({ function: { id: "fn_embed", key: "embed" } });
    case "GET /functions/fn_embed":
      return json({ function: { id: "fn_embed", name: "embed" }, valid: true });
    case "POST /functions/fn_embed/invoke":
    case "POST /functions/fn_embed/versions/1/invoke":
      return json({ output: { ok: true } });
    case "POST /functions/fn_embed/archive":
      return json({ function: { id: "fn_embed" } });
    case "GET /connections":
      return json({
        connections: [
          conn("conn_a", "app_a", { app: { displayName: "A" } }),
          conn("conn_b", "app_b", {}),
          conn("zerocred:x", "app_c", { app: { displayName: "C" }, builtIn: true }),
        ],
      });
    case "GET /apps?ids=app_b":
      return json({ apps: [appRow("app_b")], nextCursor: null });
    case "GET /connections/conn_a":
      return json({ connection: conn("conn_a", "app_a", {}) });
    case "GET /dashboard/stats?bucket=day":
      return json({
        range: { from: T1, to: T2, bucket: "day" },
        headline: { workflowRuns: 0, succeeded: 0, failed: 0 },
        series: [],
        recent: [],
      });
    case "GET /projects":
      return json({
        projects: [
          {
            id: "prj_other",
            account: "a",
            name: "o",
            isDefault: false,
            status: "active",
            createdAt: T1,
            updatedAt: T1,
          },
          {
            id: "prj_home",
            account: "a",
            name: "h",
            isDefault: true,
            status: "active",
            createdAt: T1,
            updatedAt: T1,
          },
        ],
      });
    case "GET /reliability/services/members?project=prj_home":
      return json({ appIds: memberIds });
    default:
      break;
  }
  if (line.startsWith("GET /reliability/services?")) return json({ services: [{}, {}] });
  if (line === "GET /workflows/wf_embed/versions" || line === "GET /functions/fn_embed/versions") {
    return json({ enabled: true, currentPublishedVersion: 1, versions: [version] });
  }
  if (line.endsWith("/versions/1")) return json({ version: { ...version, definition: {} } });
  if (line.endsWith("/publish")) {
    return json({
      version: { kind: "x", callableId: "c", versionNumber: 1, createdAt: T1, createdBy: null },
      currentPublishedVersion: 1,
    });
  }
  if (line.endsWith("/revert")) {
    return json({ reverted: { kind: "x", callableId: "c", versionNumber: 1 } });
  }
  return json({ ok: true });
}

async function drive<T>(
  flow: (client: W6WClient) => Promise<T>,
): Promise<{ result: T; calls: Recorded[]; lines: string[] }> {
  const calls: Recorded[] = [];
  const counts = new Map<string, number>();
  const fetch: FetchLike = (input, init) => {
    const url = new URL(input);
    const line = `${init?.method ?? "GET"} ${url.pathname}${url.search ? decodeURIComponent(url.search) : ""}`;
    const seen = counts.get(line) ?? 0;
    counts.set(line, seen + 1);
    calls.push({
      line,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
      headers: new Headers(init?.headers),
    });
    return Promise.resolve(respond(line, seen));
  };
  const client = new W6WClient({ baseUrl: BASE, token: "tok_1", fetch });
  const result = await flow(client);
  return { result, calls, lines: calls.map((c) => c.line) };
}

test("flow: workflow lifecycle issues the expected (method, path) sequence", async () => {
  const { result, calls, lines } = await drive(workflowLifecycle);
  assert.deepEqual(lines, [
    "POST /workflows",
    "GET /workflows/wf_embed",
    "POST /workflows",
    "POST /workflows/wf_embed/run?wait=true",
    "POST /workflows/wf_embed/publish",
    "GET /workflows/wf_embed/versions",
    "GET /workflows/wf_embed/versions/1",
    "POST /workflows/wf_embed/versions/1/run?wait=true",
    "POST /workflows/wf_embed/versions/1/revert",
    "GET /workflows/wf_embed",
    "POST /workflows/wf_embed/disable",
    "POST /workflows/wf_embed/enable",
    "POST /workflows/wf_embed/archive",
    "DELETE /workflows/wf_embed",
  ]);
  // The save carries the token read by the preceding get; the first create has none.
  assert.equal(calls[0]?.headers.get("x-w6w-if-unmodified-since"), null);
  assert.equal(calls[2]?.headers.get("x-w6w-if-unmodified-since"), T1);
  assert.equal((calls[2]?.body as { name: string }).name, "embed (edited)");
  // Draft run says so; the version run never does.
  assert.equal((calls[3]?.body as { allowUnpublished?: boolean }).allowUnpublished, true);
  assert.equal((calls[7]?.body as { allowUnpublished?: boolean }).allowUnpublished, undefined);
  // The token held after revert is the re-read one, not the save's.
  assert.equal(result, T3);
});

test("flow: function lifecycle issues the expected sequence, with no precondition header", async () => {
  const { calls, lines } = await drive(functionLifecycle);
  assert.deepEqual(lines, [
    "POST /functions",
    "GET /functions/fn_embed",
    "POST /functions",
    "POST /functions/fn_embed/invoke",
    "POST /functions/fn_embed/publish",
    "GET /functions/fn_embed/versions",
    "GET /functions/fn_embed/versions/1",
    "POST /functions/fn_embed/versions/1/invoke",
    "POST /functions/fn_embed/versions/1/revert",
    "POST /functions/fn_embed/disable",
    "POST /functions/fn_embed/enable",
    "POST /functions/fn_embed/archive",
    "DELETE /functions/fn_embed",
  ]);
  assert.equal((calls[3]?.body as { allowUnpublished?: boolean }).allowUnpublished, true);
  assert.equal((calls[7]?.body as { allowUnpublished?: boolean }).allowUnpublished, undefined);
  for (const call of calls) assert.equal(call.headers.get("x-w6w-if-unmodified-since"), null);
});

test("flow: integrations render inline app, look up only the missing one, never delete a built-in", async () => {
  const { result, lines } = await drive(integrations);
  assert.deepEqual(lines, [
    "GET /connections",
    "GET /apps?ids=app_b",
    "GET /connections/conn_a",
    "DELETE /connections/conn_a",
  ]);
  assert.deepEqual(result, [
    { id: "conn_a", label: "A", deletable: true },
    { id: "conn_b", label: "APP_B", deletable: true },
    { id: "zerocred:x", label: "C", deletable: false },
  ]);
});

test("flow: dashboard reads stats and the default project", async () => {
  const { result, lines } = await drive(dashboard);
  assert.deepEqual(lines, ["GET /dashboard/stats?bucket=day", "GET /projects"]);
  assert.equal(result, "prj_home");
});

test("flow: reliability batches member ids host-side, at most ten per request", async () => {
  const { result, lines } = await drive((c) => reliability(c, "prj_home"));
  assert.deepEqual(lines, [
    "GET /reliability/services/members?project=prj_home",
    "GET /reliability/services?project=prj_home&apps=app0,app1,app2,app3,app4,app5,app6,app7,app8,app9",
    "GET /reliability/services?project=prj_home&apps=app10,app11",
  ]);
  assert.equal(result, 4);
});

test("flow: the adapter is handed to the UI as-is — a function for every required member", () => {
  const client = new W6WClient({
    baseUrl: BASE,
    token: "tok_1",
    fetch: () => Promise.resolve(json({})),
  });
  const api = editorApi(client);
  for (const member of [
    "listFunctions",
    "getFunction",
    "invokeFunction",
    "listWorkflows",
    "getWorkflow",
    "runWorkflow",
    "listAppsByIds",
  ]) {
    assert.equal(typeof (api as unknown as Record<string, unknown>)[member], "function", member);
  }
});
