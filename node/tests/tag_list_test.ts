/**
 * `tag` on `workflows.list` / `functions.list` and the `endpoints.list` op, against an injected
 * fake `fetch` (`docs/implementation.md` §9; no live server).
 *
 * Each case asserts the OUTGOING URL: `?tag=` is on the wire only when a tag was given, an
 * absent or blank tag sends the bare list path, and `endpoints.list` unwraps the `endpoints`
 * envelope. Measured against plan P1 — the server's `?tag=` filter itself is not exercised here.
 */

import { assertEquals } from "@std/assert";
import { W6WClient } from "../src/client.ts";
import type { FetchLike } from "../src/config.ts";

function setup(envelope: string): { client: W6WClient; urls: string[] } {
  const urls: string[] = [];
  const fetch: FetchLike = (input) => {
    urls.push(input);
    return Promise.resolve(
      new Response(JSON.stringify({ [envelope]: [{ id: "x", tags: ["action.order"] }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  };
  return {
    client: new W6WClient({ baseUrl: "https://api.example.com", token: "tok_1", fetch }),
    urls,
  };
}

Deno.test("functions.list sends ?tag= only when a tag is given", async () => {
  const c = setup("functions");

  await c.client.functions.list({ tag: "action.order" });
  await c.client.functions.list();
  await c.client.functions.list({ tag: "  " });

  assertEquals(c.urls, [
    "https://api.example.com/functions?tag=action.order",
    "https://api.example.com/functions",
    "https://api.example.com/functions",
  ]);
});

Deno.test("endpoints.list sends ?tag= only when a tag is given, and unwraps the envelope", async () => {
  const c = setup("endpoints");

  const rows = await c.client.endpoints.list({ tag: "action.order" });
  await c.client.endpoints.list();

  assertEquals(c.urls, [
    "https://api.example.com/endpoints?tag=action.order",
    "https://api.example.com/endpoints",
  ]);
  assertEquals(rows.map((r) => r.id), ["x"]);
  assertEquals(rows[0].tags, ["action.order"]);
});

Deno.test("workflows.list sends ?tag= beside ?project=, and nothing when unset", async () => {
  const c = setup("workflows");

  await c.client.workflows.list({ tag: "action.order" });
  await c.client.workflows.list({ project: "prj_1", tag: "action.order" });
  await c.client.workflows.list();

  assertEquals(c.urls, [
    "https://api.example.com/workflows?tag=action.order",
    "https://api.example.com/workflows?project=prj_1&tag=action.order",
    "https://api.example.com/workflows",
  ]);
});
