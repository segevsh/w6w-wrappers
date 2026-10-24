/**
 * `w6w skills|context|agents …`, driven through the dispatcher against a fake server.
 *
 * The real command line (`main()`, the real registry, the real SDK) with only the
 * environment and `fetch` substituted. Pinned: list/get/archive tables, the
 * registry matching the help tree, 409 → conflict message naming the current
 * revision (exit 2), 428 → precondition message, the precondition header and body
 * `revision` on the wire, only typed flags reaching a patch, and a uniform 404
 * printing one line and no stack.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import type { FetchLike } from "@w6w/sdk";
import { main } from "../mod.ts";
import type { EnvReader } from "../mod.ts";
import { COMMANDS } from "../src/commands/index.ts";
import { AGENT_STUDIO_COMMANDS } from "../src/commands/agents-studio.ts";
import { HELP_TREE } from "../src/help.generated.ts";

const CONFIGURED: Record<string, string> = {
  W6W_BASE_URL: "https://api.example.test",
  W6W_TOKEN: "t_cli",
};
const ENV: EnvReader = (name) => CONFIGURED[name];

interface Call {
  url: string;
  method: string;
  headers: Headers;
  body: unknown;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

async function w6w(argv: string[], reply: (call: Call) => Response) {
  const calls: Call[] = [];
  const stdout: string[] = [];
  const stderr: string[] = [];
  const fetch: FetchLike = (url, init) => {
    const raw = init?.body;
    const call: Call = {
      url,
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: typeof raw === "string" ? JSON.parse(raw) : undefined,
    };
    calls.push(call);
    return Promise.resolve(reply(call));
  };
  const code = await main(argv, {
    stdout: (t) => stdout.push(t),
    stderr: (t) => stderr.push(t),
  }, { env: ENV, fetch, commands: COMMANDS });
  return { code, stdout: stdout.join("\n"), stderr: stderr.join("\n"), calls };
}

const SKILL = {
  id: "sk_1",
  name: "triage",
  description: null,
  visibility: "private",
  activeVersionId: "skv_1",
  archivedAt: null,
};
const COLLECTION = {
  id: "cc_1",
  name: "handbook",
  description: null,
  tags: ["docs", "hr"],
  visibility: "private",
  archivedAt: null,
};
const ENTRY = {
  id: "ent_1",
  collectionId: "cc_1",
  name: "welcome",
  mediaType: "text/plain",
  revision: 4,
  archivedAt: null,
};
const AGENT = {
  id: "ag_1",
  name: "triage",
  instructions: "Route mail",
  modelRouteId: "mr_1",
  skills: [],
  context: [],
  revision: 3,
  archived: false,
  validation: [],
  runnable: false,
};

Deno.test("the registry holds exactly the help tree's skills/context/agents commands", () => {
  const documented = HELP_TREE.groups
    .filter((g) => ["skills", "context", "agents"].includes(g.name))
    .flatMap((g) => g.commands.map((c) => c.path.join(" ")))
    .sort();
  assertEquals(Object.keys(AGENT_STUDIO_COMMANDS).sort(), documented);
  assertEquals(documented.length, 17);
});

Deno.test("skills list/get/archive print tables", async () => {
  const list = await w6w(
    ["skills", "list", "--include-archived", "--limit", "5"],
    () => json(200, { skills: [SKILL] }),
  );
  assertEquals(list.code, 0);
  assertStringIncludes(list.stdout, "ACTIVE VERSION");
  assertStringIncludes(list.stdout, "sk_1");
  assertStringIncludes(list.calls[0].url, "includeArchived=true");
  assertStringIncludes(list.calls[0].url, "limit=5");

  const get = await w6w(["skills", "get", "sk_1"], () => json(200, { skill: SKILL }));
  assertStringIncludes(get.stdout, "triage");

  const archive = await w6w(["skills", "archive", "sk_1"], () => json(200, { skill: SKILL }));
  assertEquals(archive.calls[0].method, "POST");
  assertStringIncludes(archive.stdout, "Archived");
});

Deno.test("context list/get/archive and entries list print tables", async () => {
  const list = await w6w(["context", "list"], () => json(200, { collections: [COLLECTION] }));
  assertStringIncludes(list.stdout, "docs,hr");
  const get = await w6w(["context", "get", "cc_1"], () => json(200, { collection: COLLECTION }));
  assertStringIncludes(get.stdout, "handbook");
  const entries = await w6w(
    ["context", "entries-list", "cc_1"],
    () => json(200, { entries: [ENTRY] }),
  );
  assertStringIncludes(entries.stdout, "text/plain");
  const archive = await w6w(
    ["context", "archive", "cc_1"],
    () => json(200, { collection: COLLECTION }),
  );
  assertStringIncludes(archive.stdout, "Archived");
});

Deno.test("context update sends only typed flags", async () => {
  const ran = await w6w(
    ["context", "update", "cc_1", "--description", "", "--tags", "a, b"],
    () => json(200, { collection: COLLECTION }),
  );
  assertEquals(ran.code, 0);
  assertEquals(ran.calls[0].method, "PATCH");
  assertEquals(ran.calls[0].body, { description: "", tags: ["a", "b"] });
});

Deno.test("agents list/get/archive print tables; runnable is never claimed", async () => {
  const list = await w6w(["agents", "list"], () => json(200, { agents: [AGENT] }));
  assertStringIncludes(list.stdout, "RUNNABLE");
  assertStringIncludes(list.stdout, "ag_1");
  const get = await w6w(["agents", "get", "ag_1"], () => json(200, { agent: AGENT }));
  assertStringIncludes(get.stdout, "Route mail");
  const archive = await w6w(["agents", "archive", "ag_1"], () => json(200, { agent: AGENT }));
  assertStringIncludes(archive.stdout, "Archived");
});

Deno.test("agents update sends revision, the precondition header and only typed fields", async () => {
  const ran = await w6w(
    [
      "agents",
      "update",
      "ag_1",
      "--revision",
      "3",
      "--instructions",
      "Be brief",
      "--if-unmodified-since",
      "2026-10-24T09:00:00.000Z",
    ],
    () => json(200, { agent: { ...AGENT, revision: 4 } }),
  );
  assertEquals(ran.code, 0);
  assertEquals(ran.calls[0].method, "PATCH");
  assertEquals(ran.calls[0].body, { instructions: "Be brief", revision: 3 });
  assertEquals(ran.calls[0].headers.get("x-w6w-if-unmodified-since"), "2026-10-24T09:00:00.000Z");
  assertStringIncludes(ran.stdout, "revision 4");

  const bare = await w6w(
    ["agents", "update", "ag_1", "--revision", "0"],
    () => json(200, { agent: AGENT }),
  );
  assertEquals(bare.calls[0].headers.get("x-w6w-if-unmodified-since"), null);
  assertEquals(bare.calls[0].body, { revision: 0 });

  const missing = await w6w(["agents", "update", "ag_1"], () => json(200, { agent: AGENT }));
  assertEquals(missing.code, 1);
  assertEquals(missing.calls.length, 0);
});

Deno.test("agents update: 409 prints the conflict message with the current revision, exits non-zero", async () => {
  const ran = await w6w(
    ["agents", "update", "ag_1", "--revision", "3"],
    () => json(409, { error: { code: "conflict", message: "stale", currentRevision: 9 } }),
  );
  assertEquals(ran.code, 2);
  assertStringIncludes(ran.stderr, "Conflict");
  assertStringIncludes(ran.stderr, "current revision: 9");
  assertStringIncludes(ran.stderr, "w6w agents get ag_1");
  assert(!ran.stderr.includes("    at "), "no stack trace");
});

Deno.test("agents update: 428 prints the precondition message", async () => {
  const ran = await w6w(
    ["agents", "update", "ag_1", "--revision", "3"],
    () => json(428, { error: { code: "precondition_required", message: "need it" } }),
  );
  assertEquals(ran.code, 2);
  assertStringIncludes(ran.stderr, "Precondition required");
  assertStringIncludes(ran.stderr, "--if-unmodified-since");
});

Deno.test("context entries-update sends revision + header; 409 names the current revision", async () => {
  const ok = await w6w(
    [
      "context",
      "entries-update",
      "cc_1",
      "ent_1",
      "--text",
      "hi",
      "--revision",
      "4",
      "--if-unmodified-since",
      "2026-10-24T09:00:00.000Z",
    ],
    () => json(200, { entry: { ...ENTRY, revision: 5 } }),
  );
  assertEquals(ok.code, 0);
  assertEquals(ok.calls[0].method, "PUT");
  assertEquals(ok.calls[0].body, { text: "hi", revision: 4 });
  assertEquals(ok.calls[0].headers.get("x-w6w-if-unmodified-since"), "2026-10-24T09:00:00.000Z");

  const stale = await w6w(
    ["context", "entries-update", "cc_1", "ent_1", "--text", "hi", "--revision", "4"],
    () => json(409, { error: { code: "conflict", message: "stale", currentRevision: 7 } }),
  );
  assertEquals(stale.code, 2);
  assertStringIncludes(stale.stderr, "current revision: 7");
});

Deno.test("a uniform 404 prints one not-found line, never a stack trace", async () => {
  for (const argv of [["skills", "get", "x"], ["context", "get", "x"], ["agents", "get", "x"]]) {
    const ran = await w6w(
      argv,
      () => json(404, { error: { code: "not_found", message: "Not found" } }),
    );
    assertEquals(ran.code, 2);
    assertStringIncludes(ran.stderr, "Not found");
    assertEquals(ran.stderr.split("\n").length, 1);
    assert(!ran.stderr.includes("    at "));
  }
});
