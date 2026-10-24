/**
 * `client.console.models.*`, against an injected fake `fetch`. Every method:
 * method, URL (incl. `project` query), body, and envelope unwrapping. There is
 * no `console.models.complete` — `client.modelRoutes.complete` is the one way.
 */

import { assertEquals } from "@std/assert";
import { W6WClient } from "../../src/client.ts";
import type { FetchLike } from "../../src/config.ts";

interface Call {
  url: string;
  method: string | undefined;
  body: string | null;
}

function setup(respond: (call: Call) => unknown, status = 200) {
  const calls: Call[] = [];
  const fetch: FetchLike = (input, init) => {
    calls.push({
      url: input,
      method: init?.method,
      body: typeof init?.body === "string" ? init.body : null,
    });
    return Promise.resolve(
      new Response(JSON.stringify(respond(calls[calls.length - 1])), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
  };
  const client = new W6WClient({ baseUrl: "https://api.example.com", token: "tok", fetch });
  return { m: client.console.models, calls, client };
}

Deno.test("updateModel PATCHes and unwraps `model`", async () => {
  const { m, calls } = setup(() => ({ model: { id: "mdl_1", status: "blocked" } }));
  const r = await m.updateModel("mdl_1", { status: "blocked" });
  assertEquals(r.id, "mdl_1");
  assertEquals(calls[0].method, "PATCH");
  assertEquals(calls[0].url, "https://api.example.com/models/mdl_1");
  assertEquals(JSON.parse(calls[0].body!), { status: "blocked" });
});

Deno.test("putRates PUTs and unwraps `rate`", async () => {
  const { m, calls } = setup(() => ({ rate: { id: "r1", source: "tenant" } }), 201);
  const r = await m.putRates("mdl_1", { effectiveFrom: "2026-01-01", rates: { input: 1 } });
  assertEquals(r.id, "r1");
  assertEquals(calls[0].method, "PUT");
  assertEquals(calls[0].url, "https://api.example.com/models/mdl_1/rates");
  assertEquals(JSON.parse(calls[0].body!), { effectiveFrom: "2026-01-01", rates: { input: 1 } });
});

Deno.test("discover POSTs {connection} and returns the body", async () => {
  const body = { added: ["a"], updated: [], deprecated: ["b"] };
  const { m, calls } = setup(() => body);
  assertEquals(await m.discover("conn_1"), body);
  assertEquals(calls[0].method, "POST");
  assertEquals(calls[0].url, "https://api.example.com/models/discover");
  assertEquals(JSON.parse(calls[0].body!), { connection: "conn_1" });
});

Deno.test("providers unwraps `providers`", async () => {
  const { m, calls } = setup(() => ({
    providers: [{ appId: "io.w6w.openai", provider: "openai", installed: true }],
  }));
  assertEquals((await m.providers())[0].provider, "openai");
  assertEquals(calls[0].url, "https://api.example.com/models/providers");
});

Deno.test("budgets: list, create, update, delete, usage", async () => {
  const { m, calls } = setup((c) => {
    if (c.method === "DELETE") return { ok: true };
    if (c.url.endsWith("/usage")) return { budgetId: "b1", used: { requests: 2 } };
    if (c.method === "GET") return { budgets: [{ id: "b1" }] };
    return { budget: { id: "b1" } };
  });
  assertEquals((await m.listBudgets({ project: "p1" }))[0].id, "b1");
  assertEquals(calls[0].url, "https://api.example.com/model-budgets?project=p1");
  const input = {
    scopeKind: "project",
    window: "month",
    limits: { costMinor: 500, currency: "USD" },
    onBreach: "block",
  };
  assertEquals((await m.createBudget(input, { project: "p1" })).id, "b1");
  assertEquals(calls[1].method, "POST");
  assertEquals(calls[1].url, "https://api.example.com/model-budgets?project=p1");
  assertEquals(JSON.parse(calls[1].body!), input);
  assertEquals((await m.updateBudget("b1", { onBreach: "warn" })).id, "b1");
  assertEquals(calls[2].method, "PATCH");
  assertEquals(calls[2].url, "https://api.example.com/model-budgets/b1");
  assertEquals(await m.deleteBudget("b1"), undefined);
  assertEquals(calls[3].method, "DELETE");
  const u = await m.budgetUsage("b1");
  assertEquals(u.budgetId, "b1");
  assertEquals(calls[4].url, "https://api.example.com/model-budgets/b1/usage");
});

Deno.test("routes: create, update, delete take project and encode the name", async () => {
  const { m, calls } = setup((c) =>
    c.method === "DELETE" ? { ok: true } : { route: { name: "a b" } }
  );
  await m.createRoute({ name: "chat", model: "mdl_1", connection: "c1" }, { project: "p1" });
  assertEquals(calls[0].method, "POST");
  assertEquals(calls[0].url, "https://api.example.com/model-routes?project=p1");
  const r = await m.updateRoute("a b", { model: "mdl_2" }, { project: "p1" });
  assertEquals(r.name, "a b");
  assertEquals(calls[1].method, "PATCH");
  assertEquals(calls[1].url, "https://api.example.com/model-routes/a%20b?project=p1");
  assertEquals(await m.deleteRoute("a b", { project: "p1" }), undefined);
  assertEquals(calls[2].method, "DELETE");
  assertEquals(calls[2].url, "https://api.example.com/model-routes/a%20b?project=p1");
});

Deno.test("there is no console.models.complete", () => {
  const { m } = setup(() => ({}));
  assertEquals("complete" in m, false);
});
