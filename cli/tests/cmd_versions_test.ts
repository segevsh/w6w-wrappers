/**
 * The version lifecycle commands of `w6w workflows` and `w6w functions`, driven
 * through the dispatcher against a stub fetch. Wire requests are pinned as
 * literals (method, URL, body), so a command that drifts from the contract's
 * path or verb fails here.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import type { FetchLike } from "@w6w/sdk";
import { main } from "../mod.ts";
import type { EnvReader } from "../mod.ts";
import { COMMANDS } from "../src/commands/index.ts";

const BASE = "https://api.example.test";
const ENV: EnvReader = (name) => ({ W6W_BASE_URL: BASE, W6W_TOKEN: "t_cli" })[name];

interface Recorded {
  url: string;
  method: string;
  body: unknown;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function w6w(argv: string[], reply: (call: Recorded) => Response = () => json(200, {})) {
  const calls: Recorded[] = [];
  const stdout: string[] = [];
  const stderr: string[] = [];
  const fetch: FetchLike = (url, init) => {
    const call: Recorded = {
      url,
      method: init?.method ?? "GET",
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

const LIST = {
  enabled: true,
  currentPublishedVersion: 2,
  versions: [
    {
      versionNumber: 2,
      createdAt: "2026-10-02T00:00:00Z",
      createdBy: null,
      isCurrentPublished: true,
    },
    {
      versionNumber: 1,
      createdAt: "2026-10-01T00:00:00Z",
      createdBy: "alice",
      isCurrentPublished: false,
    },
  ],
};

for (
  const [group, id, path] of [
    ["workflows", "wf_01HQ8N", "workflows"],
    ["functions", "fn_01HQ8N", "functions"],
  ] as const
) {
  Deno.test(`${group} versions: GET /${path}/<id>/versions, listed and --json unwrapped`, async () => {
    const human = await w6w([group, "versions", id], (call) => {
      assertEquals(call.method, "GET");
      assertEquals(call.url, `${BASE}/${path}/${id}/versions`);
      return json(200, LIST);
    });
    assertEquals(human.code, 0, human.stderr);
    assertStringIncludes(human.stdout, "published");
    assertStringIncludes(human.stdout, "alice");
    const machine = await w6w([group, "versions", id, "--json"], () => json(200, LIST));
    assertEquals(JSON.parse(machine.stdout), LIST);
  });

  Deno.test(`${group} version: GET /${path}/<id>/versions/<n>`, async () => {
    const detail = { ...LIST.versions[0], definition: { key: "x" } };
    const r = await w6w([group, "version", id, "2", "--json"], (call) => {
      assertEquals(call.method, "GET");
      assertEquals(call.url, `${BASE}/${path}/${id}/versions/2`);
      return json(200, { version: detail });
    });
    assertEquals(r.code, 0, r.stderr);
    assertEquals(JSON.parse(r.stdout), detail);
  });

  Deno.test(`${group} version: a non-integer version is a usage error, no request`, async () => {
    const r = await w6w([group, "version", id, "two"]);
    assertEquals(r.code, 1, r.stderr);
    assertEquals(r.calls.length, 0);
  });

  Deno.test(`${group} publish: POST /${path}/<id>/publish`, async () => {
    const result = {
      version: { kind: group, callableId: id, versionNumber: 3, createdAt: "t", createdBy: null },
      currentPublishedVersion: 3,
    };
    const r = await w6w([group, "publish", id], (call) => {
      assertEquals(call.method, "POST");
      assertEquals(call.url, `${BASE}/${path}/${id}/publish`);
      return json(200, result);
    });
    assertEquals(r.code, 0, r.stderr);
    assertStringIncludes(r.stdout, "version 3");
  });

  Deno.test(`${group} revert: POST /${path}/<id>/versions/<n>/revert`, async () => {
    const result = { kind: group, callableId: id, versionNumber: 1 };
    const r = await w6w([group, "revert", id, "1", "--json"], (call) => {
      assertEquals(call.method, "POST");
      assertEquals(call.url, `${BASE}/${path}/${id}/versions/1/revert`);
      return json(200, { reverted: result });
    });
    assertEquals(r.code, 0, r.stderr);
    assertEquals(JSON.parse(r.stdout), result);
  });

  for (const verb of ["enable", "disable"]) {
    Deno.test(`${group} ${verb}: POST /${path}/<id>/${verb}; --json is null`, async () => {
      const r = await w6w([group, verb, id, "--json"], (call) => {
        assertEquals(call.method, "POST");
        assertEquals(call.url, `${BASE}/${path}/${id}/${verb}`);
        return json(200, { ok: true });
      });
      assertEquals(r.code, 0, r.stderr);
      assertEquals(JSON.parse(r.stdout), null);
    });
  }

  Deno.test(`${group} publish: a 404 is an API error, exit 2, server message on stderr`, async () => {
    const r = await w6w(
      [group, "publish", id],
      () => json(404, { error: { code: "not_found", message: "No such thing." } }),
    );
    assertEquals(r.code, 2, r.stdout);
    assertStringIncludes(r.stderr, "No such thing.");
  });
}

Deno.test("workflows run-version: POST /versions/<n>/run, --wait in the query, exit 3 on a failed run", async () => {
  const r = await w6w([
    "workflows",
    "run-version",
    "wf_01HQ8N",
    "3",
    "--wait",
    "--input",
    '{"a":1}',
  ], (call) => {
    assertEquals(call.method, "POST");
    assertEquals(call.url, `${BASE}/workflows/wf_01HQ8N/versions/3/run?wait=true`);
    assertEquals(call.body, { input: { a: 1 } });
    return json(200, { runId: "run_1", status: "failed", error: { message: "boom" } });
  });
  assertEquals(r.code, 3, r.stderr);
  assertStringIncludes(r.stdout, "run_1");
});

Deno.test("workflows run-version: has no --allow-unpublished", async () => {
  const r = await w6w(["workflows", "run-version", "wf_01HQ8N", "3", "--allow-unpublished"]);
  assertEquals(r.code, 1, r.stderr);
  assertEquals(r.calls.length, 0);
});

Deno.test("functions run-version: POST /versions/<n>/invoke with inputs; prints the output", async () => {
  const r = await w6w([
    "functions",
    "run-version",
    "fn_01HQ8N",
    "3",
    "--payload",
    '{"to":"a@b.com"}',
    "--json",
  ], (call) => {
    assertEquals(call.method, "POST");
    assertEquals(call.url, `${BASE}/functions/fn_01HQ8N/versions/3/invoke`);
    assertEquals(call.body, { inputs: { to: "a@b.com" } });
    return json(200, { output: { sent: true } });
  });
  assertEquals(r.code, 0, r.stderr);
  assertEquals(JSON.parse(r.stdout), { sent: true });
});

Deno.test("functions run-version: a non-object --payload is a usage error, no request", async () => {
  const r = await w6w(["functions", "run-version", "fn_01HQ8N", "3", "--payload", "[1]"]);
  assertEquals(r.code, 1, r.stderr);
  assertEquals(r.calls.length, 0);
});

Deno.test("functions archive: POST /functions/<id>/archive", async () => {
  const r = await w6w(["functions", "archive", "fn_01HQ8N", "--json"], (call) => {
    assertEquals(call.method, "POST");
    assertEquals(call.url, `${BASE}/functions/fn_01HQ8N/archive`);
    return json(200, { function: { id: "fn_01HQ8N", key: "k" } });
  });
  assertEquals(r.code, 0, r.stderr);
  assertEquals(JSON.parse(r.stdout), { id: "fn_01HQ8N", key: "k" });
});

Deno.test("--allow-unpublished: allowUnpublished:true in the body only when passed (both run commands)", async () => {
  const wf = await w6w(["workflows", "run", "wf_01HQ8N", "--allow-unpublished"], (call) => {
    assertEquals(call.url, `${BASE}/workflows/wf_01HQ8N/run`);
    assertEquals(call.body, { allowUnpublished: true });
    return json(202, { runId: "run_1", status: "queued" });
  });
  assertEquals(wf.code, 0, wf.stderr);
  const wfPlain = await w6w(["workflows", "run", "wf_01HQ8N"], (call) => {
    assertEquals(Object.hasOwn((call.body ?? {}) as object, "allowUnpublished"), false);
    return json(202, { runId: "run_1", status: "queued" });
  });
  assertEquals(wfPlain.code, 0, wfPlain.stderr);

  const fn = await w6w(["functions", "run", "send-email", "--allow-unpublished"], (call) => {
    assertEquals(call.url, `${BASE}/functions/send-email/invoke`);
    assertEquals(call.body, { inputs: {}, allowUnpublished: true });
    return json(200, { output: null });
  });
  assertEquals(fn.code, 0, fn.stderr);
  const fnPlain = await w6w(["functions", "run", "send-email"], (call) => {
    assertEquals(call.body, { inputs: {} });
    return json(200, { output: null });
  });
  assertEquals(fnPlain.code, 0, fnPlain.stderr);
});
