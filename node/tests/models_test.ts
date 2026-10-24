/** `client.models.*`, `client.modelRoutes.*`, `client.modelUsage.*` against a fake `fetch`. */

import { assertEquals } from "@std/assert";
import { W6WClient } from "../src/client.ts";
import type { FetchLike } from "../src/config.ts";
import type { ModelCompletion } from "../src/models.ts";

function setup(body: unknown) {
  const calls: { url: string; method?: string; body: string | null }[] = [];
  const fetch: FetchLike = (input, init) => {
    calls.push({
      url: input,
      method: init?.method,
      body: typeof init?.body === "string" ? init.body : null,
    });
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  };
  const client = new W6WClient({ token: "k", baseUrl: "https://x.test", fetch });
  return { client, calls };
}

Deno.test("models.list returns the page as-is and passes filters", async () => {
  const page = { models: [{ id: "m1" }], nextCursor: "c2" };
  const { client, calls } = setup(page);
  const out = await client.models.list({ provider: "openai", limit: 5, cursor: "c1" });
  assertEquals(out, page);
  assertEquals(calls[0].method, "GET");
  const u = new URL(calls[0].url);
  assertEquals(u.searchParams.get("provider"), "openai");
  assertEquals(u.searchParams.get("limit"), "5");
  assertEquals(u.searchParams.get("cursor"), "c1");
});

Deno.test("models.get encodes the id", async () => {
  const { client, calls } = setup({ id: "a/b" });
  assertEquals((await client.models.get("a/b")).id, "a/b");
  assertEquals(new URL(calls[0].url).pathname.endsWith("/models/a%2Fb"), true);
});

Deno.test("modelRoutes.list/get carry project", async () => {
  const { client, calls } = setup([{ name: "r" }]);
  assertEquals((await client.modelRoutes.list({ project: "p1" })).length, 1);
  await client.modelRoutes.get("r", { project: "p1" });
  assertEquals(new URL(calls[0].url).searchParams.get("project"), "p1");
  assertEquals(new URL(calls[1].url).pathname.endsWith("/model-routes/r"), true);
});

Deno.test("modelRoutes.complete POSTs the input and returns the flat envelope", async () => {
  const env = { invocationId: "inv_1", status: "ok", key: "k1", output: "hi" };
  const { client, calls } = setup(env);
  const out: ModelCompletion = await client.modelRoutes.complete(
    "chat",
    { messages: [{ role: "user", content: "yo" }] },
    { project: "p1", dialect: "anthropic", response: "both" },
  );
  assertEquals(out, env);
  assertEquals(calls[0].method, "POST");
  const u = new URL(calls[0].url);
  assertEquals(u.pathname.endsWith("/model-routes/chat/complete"), true);
  assertEquals(u.searchParams.get("dialect"), "anthropic");
  assertEquals(u.searchParams.get("response"), "both");
  assertEquals(u.searchParams.get("project"), "p1");
  assertEquals(JSON.parse(calls[0].body!), { messages: [{ role: "user", content: "yo" }] });
});

Deno.test("modelRoutes.complete rejects bad unions at type level", async () => {
  const { client } = setup({ invocationId: "i", status: "ok" });
  // @ts-expect-error response must be "both" | "output" | "raw"
  await client.modelRoutes.complete("r", {}, { response: "bogus" });
  // @ts-expect-error dialect must be one of the four dialects
  await client.modelRoutes.complete("r", {}, { dialect: "bogus" });
});

Deno.test("modelUsage.query passes every filter", async () => {
  const rep = { totals: {}, items: [], nextCursor: null };
  const { client, calls } = setup(rep);
  assertEquals(
    await client.modelUsage.query({
      groupBy: "route",
      from: "2026-01-01",
      to: "2026-02-01",
      route: "chat",
      model: "m1",
      limit: 10,
      cursor: "c",
    }),
    rep,
  );
  const q = new URL(calls[0].url).searchParams;
  for (
    const [k, v] of Object.entries({
      groupBy: "route",
      from: "2026-01-01",
      to: "2026-02-01",
      route: "chat",
      model: "m1",
      limit: "10",
      cursor: "c",
    })
  ) assertEquals(q.get(k), v);
});
