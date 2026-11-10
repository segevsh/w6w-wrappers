/**
 * `--tag` on `w6w workflows list` / `w6w functions list`, and `w6w endpoints list`.
 *
 * Each case asserts the request the CLI MADE: `?tag=` is on the wire only when the flag was
 * given. Measured against plan P1 — the server's `?tag=` filter is not exercised here.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import type { FetchLike } from "@w6w/sdk";
import { main } from "../mod.ts";
import { COMMANDS } from "../src/commands/index.ts";

const BODIES: Record<string, unknown> = {
  "/workflows": { workflows: [] },
  "/functions": { functions: [] },
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
      tags: ["action.order"],
    }],
  },
};

async function run(argv: string[]) {
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
  const code = await main(argv, { stdout: (t) => out.push(t), stderr: (t) => err.push(t) }, {
    env: (name) => ({ W6W_TOKEN: "tok_test_1234", W6W_BASE_URL: "https://t.example" })[name],
    fetch: transport,
    commands: COMMANDS,
  });
  return { code, stdout: out.join("\n"), stderr: err.join("\n"), calls };
}

Deno.test("list --tag puts ?tag= on the wire for workflows, functions and endpoints", async () => {
  for (const kind of ["workflows", "functions", "endpoints"]) {
    const tagged = await run([kind, "list", "--tag", "action.order"]);
    const plain = await run([kind, "list"]);

    assertEquals(tagged.code, 0, tagged.stderr);
    assertEquals(tagged.calls, [`/${kind}?tag=action.order`], kind);
    assertEquals(plain.calls, [`/${kind}`], kind);
  }
});

Deno.test("workflows list --tag composes with --project", async () => {
  const a = await run(["workflows", "list", "--project", "prj_1", "--tag", "action.order"]);

  assertEquals(a.calls, ["/workflows?project=prj_1&tag=action.order"]);
});

Deno.test("endpoints list prints one row per endpoint", async () => {
  const a = await run(["endpoints", "list"]);

  assertEquals(a.code, 0, a.stderr);
  assertStringIncludes(a.stdout, "ep_1");
  assertStringIncludes(a.stdout, "hello");
});
