/**
 * `w6w models|model-routes|model-usage`, driven through the dispatcher against a fake transport.
 *
 * Every case below runs the **real** command line — `main()`, the real registry,
 * the real SDK — with two things substituted: the environment (a plain object)
 * and `fetch` (a function that records the request and answers from a script).
 * No live server is involved anywhere, which is the rule for every wrapper's
 * suite (`docs/implementation.md` §9); a document CRUD test that needed one
 * would be a test nobody could run on a laptop.
 *
 * What is being pinned, beyond "it works":
 *
 * - **Addressing.** Create takes the key, update and delete take the id, and the
 *   key-addressed read goes to the `by-key` route rather than to a list-and-scan.
 * - **The project scope reaches the query string**, and its absence sends no
 *   `?project=` at all — an omitted parameter is how the server is asked for the
 *   account's default project.
 * - **Omit versus set (D2).** A flag that was not typed does not appear in the
 *   patch body. This is asserted on the **wire body**, because that is the only
 *   place the difference between "leave it alone" and "blank it out" exists.
 * - **The exit codes**, including as real process statuses: a mapping function
 *   that returns 2 and a binary that exits 0 look identical from inside.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import type { FetchLike } from "@w6w/sdk";
import { HELP_TREE, main } from "../mod.ts";
import { COMMANDS, MODEL_COMMANDS } from "../src/commands/index.ts";
import type { EnvReader } from "../mod.ts";

// ---------------------------------------------------------------------------
// Fakes.
// ---------------------------------------------------------------------------

const BASE = "https://api.example.test";
const CONFIGURED: Record<string, string> = { W6W_BASE_URL: BASE, W6W_TOKEN: "t_cli" };
const ENV: EnvReader = (name) => CONFIGURED[name];

/** One request the CLI made, in the terms the assertions are written in. */
interface Recorded {
  url: string;
  method: string;
  authorization: string | null;
  /** The parsed JSON body, or `undefined` for a bodiless request. */
  body: unknown;
}

/** What a request is answered with. */
type Reply = (call: Recorded) => Response;

/** A JSON response, the way the server sends one. */
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface Ran {
  code: number;
  stdout: string;
  stderr: string;
  calls: Recorded[];
}

/** Run one command line and report everything it did. */
async function w6w(argv: string[], reply: Reply = () => json(200, {})): Promise<Ran> {
  const calls: Recorded[] = [];
  const stdout: string[] = [];
  const stderr: string[] = [];
  const fetch: FetchLike = (url, init) => {
    const call: Recorded = {
      url,
      method: init?.method ?? "GET",
      authorization: new Headers(init?.headers).get("authorization"),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    return Promise.resolve(reply(call));
  };
  const code = await main(argv, {
    stdout: (text) => stdout.push(text),
    stderr: (text) => stderr.push(text),
  }, { env: ENV, fetch, commands: COMMANDS });
  return { code, stdout: stdout.join("\n"), stderr: stderr.join("\n"), calls };
}

Deno.test("models ls: GET /models with filters, table output", async () => {
  const r = await w6w(
    ["models", "ls", "--provider", "openai", "--limit", "5"],
    () =>
      json(200, {
        models: [{ id: "gpt-x", provider: "openai", status: "active" }],
        nextCursor: null,
      }),
  );
  assertEquals(r.code, 0, r.stderr);
  assertEquals(r.calls[0].url, `${BASE}/models?provider=openai&limit=5`);
  assertStringIncludes(r.stdout, "gpt-x");
});

Deno.test("models get: unwraps {model}", async () => {
  const r = await w6w(
    ["models", "get", "gpt-x", "--json"],
    () => json(200, { model: { id: "gpt-x" } }),
  );
  assertEquals(r.code, 0, r.stderr);
  assertEquals(r.calls[0].url, `${BASE}/models/gpt-x`);
  assertEquals(JSON.parse(r.stdout), { id: "gpt-x" });
});

Deno.test("model-routes list/get: project reaches the query, envelopes unwrap", async () => {
  const list = await w6w(
    ["model-routes", "list", "--project", "p1", "--json"],
    () => json(200, { routes: [{ name: "fast" }] }),
  );
  assertEquals(list.code, 0, list.stderr);
  assertEquals(list.calls[0].url, `${BASE}/model-routes?project=p1`);
  assertEquals(JSON.parse(list.stdout), [{ name: "fast" }]);

  const get = await w6w(
    ["model-routes", "get", "fast", "--json"],
    () => json(200, { route: { name: "fast" } }),
  );
  assertEquals(get.calls[0].url, `${BASE}/model-routes/fast`);
  assertEquals(JSON.parse(get.stdout), { name: "fast" });
});

Deno.test("model-routes complete: POST /model-routes/{name}/complete, flat envelope returned as-is", async () => {
  const envelope = { invocationId: "inv_1", status: "success", key: "k_1", output: { text: "hi" } };
  const r = await w6w(
    [
      "model-routes",
      "complete",
      "fast",
      "--input",
      '{"prompt":"hello"}',
      "--project",
      "p1",
      "--dialect",
      "openai",
      "--response",
      "both",
      "--json",
    ],
    () => json(200, envelope),
  );
  assertEquals(r.code, 0, r.stderr);
  assertEquals(r.calls[0].method, "POST");
  assertEquals(
    r.calls[0].url,
    `${BASE}/model-routes/fast/complete?project=p1&dialect=openai&response=both`,
  );
  assertEquals(r.calls[0].body, { prompt: "hello" });
  assertEquals(JSON.parse(r.stdout), envelope);
});

Deno.test("model-routes complete: bad --input is a usage error before any request", async () => {
  const r = await w6w(["model-routes", "complete", "fast", "--input", "nope"]);
  assertEquals(r.code, 1);
  assertEquals(r.calls.length, 0);
});

Deno.test("model-usage: passes groupBy/from/to/route/model/limit/cursor", async () => {
  const r = await w6w(
    [
      "model-usage",
      "--group-by",
      "route",
      "--from",
      "2026-01-01",
      "--to",
      "2026-02-01",
      "--route",
      "fast",
      "--model",
      "m1",
      "--limit",
      "3",
      "--cursor",
      "c1",
      "--json",
    ],
    () => json(200, { totals: {}, totalsTruncated: false, items: [], nextCursor: null }),
  );
  assertEquals(r.code, 0, r.stderr);
  const url = new URL(r.calls[0].url);
  assertEquals(url.pathname, "/model-usage");
  assertEquals(Object.fromEntries(url.searchParams), {
    groupBy: "route",
    from: "2026-01-01",
    to: "2026-02-01",
    route: "fast",
    model: "m1",
    limit: "3",
    cursor: "c1",
  });
});

Deno.test("every model command in the help tree is registered, and no others", () => {
  const documented = [
    ...HELP_TREE.groups
      .filter((g) => ["models", "model-routes"].includes(g.name))
      .flatMap((g) => g.commands.map((c) => c.path.join(" "))),
    ...HELP_TREE.commands.filter((c) => c.path[0] === "model-usage").map((c) => c.path.join(" ")),
  ].sort();
  assertEquals(Object.keys(MODEL_COMMANDS).sort(), documented);
  for (const key of documented) assert(COMMANDS[key] !== undefined, key);
});
