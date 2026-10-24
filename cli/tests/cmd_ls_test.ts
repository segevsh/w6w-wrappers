/**
 * `w6w ls <integrations|workflows|functions|endpoints>`.
 *
 * `ls` is a pure re-dispatch for the first three: the request and the bytes on
 * stdout must equal the delegate's, which these tests assert by running both.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import type { FetchLike } from "@w6w/sdk";
import { main } from "../mod.ts";
import { COMMANDS } from "../src/commands/index.ts";

const BODIES: Record<string, unknown> = {
  "/workflows": {
    workflows: [{ id: "wf_1", name: "Flow", status: "active", runCount: 3 }],
  },
  "/functions": { functions: [{ id: "fn_1", key: "send", valid: true, updatedAt: "2026-01-01" }] },
  "/connections": {
    connections: [{ id: "conn_1", appId: "slack", state: "connected", displayName: "Slack" }],
  },
  "/endpoints": {
    endpoints: [{
      id: "ep_1",
      key: "hello",
      displayName: "Hello",
      status: "ready",
      incomplete: false,
      invokeUrl: "https://x/ep",
      updatedAt: "2026-01-01",
      description: "",
      archivedAt: null,
    }],
  },
};

function run(argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const calls: string[] = [];
  const transport: FetchLike = (url) => {
    const u = new URL(url);
    calls.push(`${u.pathname}${u.search}`);
    return Promise.resolve(
      new Response(JSON.stringify(BODIES[u.pathname] ?? {}), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  };
  return main(argv, { stdout: (t) => out.push(t), stderr: (t) => err.push(t) }, {
    env: (name) => ({ W6W_TOKEN: "tok_test_1234", W6W_BASE_URL: "https://t.example" })[name],
    fetch: transport,
    commands: COMMANDS,
  }).then((code) => ({ code, stdout: out.join("\n"), stderr: err.join("\n"), calls }));
}

Deno.test("ls <kind> issues the delegate's request and prints the delegate's bytes", async () => {
  const pairs: [string, string[]][] = [
    ["workflows", ["workflows", "list"]],
    ["functions", ["functions", "list"]],
    ["integrations", ["connections", "list"]],
  ];
  for (const [kind, delegate] of pairs) {
    for (const extra of [[], ["--json"]]) {
      const a = await run(["ls", kind, ...extra]);
      const b = await run([...delegate, ...extra]);
      assertEquals(a.code, 0, a.stderr);
      assertEquals(a.stdout, b.stdout, `${kind} ${extra}`);
      assertEquals(a.calls, b.calls);
      assertEquals(a.calls.length, 1);
    }
  }
});

Deno.test("ls workflows --project forwards the scope", async () => {
  const a = await run(["ls", "workflows", "--project", "prj_9"]);
  const b = await run(["workflows", "list", "--project", "prj_9"]);
  assertEquals(a.code, 0, a.stderr);
  assertEquals(a.calls, b.calls);
  assertStringIncludes(a.calls[0], "prj_9");
});

Deno.test("ls endpoints hits the console endpoints list and labels it unstable", async () => {
  const human = await run(["ls", "endpoints"]);
  assertEquals(human.code, 0, human.stderr);
  assertEquals(human.calls, ["/endpoints"]);
  assertStringIncludes(human.stdout, "unstable");
  assertStringIncludes(human.stdout, "ep_1");
  const json = await run(["ls", "endpoints", "--json"]);
  assertEquals(JSON.parse(json.stdout)[0].key, "hello");
});

Deno.test("ls with a missing or unknown kind is exit 1, lists the kinds, sends nothing", async () => {
  for (const argv of [["ls"], ["ls", "widgets"], ["ls", "workflows", "extra"]]) {
    const r = await run(argv);
    assertEquals(r.code, 1, argv.join(" "));
    assertEquals(r.calls.length, 0);
  }
  const r = await run(["ls", "widgets"]);
  for (const kind of ["integrations", "workflows", "functions", "endpoints"]) {
    assertStringIncludes(r.stderr, kind);
  }
});

Deno.test("w6w run ls still treats ls as a positional, not the list command", async () => {
  const r = await run(["run", "ls"]);
  assertEquals(r.calls.filter((c) => c.startsWith("/workflows")).length, 0);
  assertEquals(r.stdout.includes("wf_1"), false);
});
