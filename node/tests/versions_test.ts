/**
 * The version surface (`listVersions` … `runVersion`) on `client.workflows` and
 * `client.functions`, against an injected fake `fetch`.
 *
 * Every expectation below is a LITERAL wire value written here, never one
 * computed by the code under test — a path builder that is wrong for both kinds
 * would otherwise agree with itself.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { W6WClient } from "../src/client.ts";
import type { FetchLike } from "../src/config.ts";
import { ApiError } from "../src/errors.ts";

interface Call {
  url: string;
  method: string | undefined;
  body: string | null;
}

function client(
  respond: (call: Call) => Response,
): { client: W6WClient; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = (input, init) => {
    calls.push({
      url: input,
      method: init?.method,
      body: typeof init?.body === "string" ? init.body : null,
    });
    return Promise.resolve(respond(calls[calls.length - 1]));
  };
  return {
    client: new W6WClient({ baseUrl: "https://api.example.com", token: "tok_1", fetch }),
    calls,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const B = "https://api.example.com";
const LIST = {
  enabled: true,
  currentPublishedVersion: 2,
  versions: [
    {
      versionNumber: 2,
      createdAt: "2026-10-01T00:00:00Z",
      createdBy: null,
      isCurrentPublished: true,
    },
  ],
};
const DETAIL = {
  versionNumber: 2,
  createdAt: "2026-10-01T00:00:00Z",
  createdBy: "u_1",
  isCurrentPublished: true,
  definition: { id: "x" },
};
const PUBLISHED = {
  version: {
    kind: "workflow",
    callableId: "wf_1",
    versionNumber: 3,
    createdAt: "t",
    createdBy: null,
  },
  currentPublishedVersion: 3,
};
const REVERTED = { kind: "workflow", callableId: "wf_1", versionNumber: 1 };

Deno.test("workflows version ops: exact method + path, and each unwrap rule", async () => {
  const c = client((call) => {
    if (call.url.endsWith("/versions")) return json(LIST);
    if (call.url.endsWith("/versions/2")) return json({ version: DETAIL });
    if (call.url.endsWith("/publish")) return json(PUBLISHED);
    if (call.url.endsWith("/revert")) return json({ reverted: REVERTED });
    return json({ enabled: true });
  });
  const w = c.client.workflows;

  assertEquals(await w.listVersions("wf_1"), LIST, "whole body");
  assertEquals(await w.getVersion("wf_1", 2), DETAIL, "version unwrapped");
  assertEquals(await w.publish("wf_1"), PUBLISHED, "whole body");
  assertEquals(await w.revert("wf_1", 1), REVERTED, "reverted unwrapped");
  assertEquals(await w.enable("wf_1"), undefined);
  assertEquals(await w.disable("wf_1"), undefined);

  assertEquals(c.calls.map((x) => `${x.method} ${x.url}`), [
    `GET ${B}/workflows/wf_1/versions`,
    `GET ${B}/workflows/wf_1/versions/2`,
    `POST ${B}/workflows/wf_1/publish`,
    `POST ${B}/workflows/wf_1/versions/1/revert`,
    `POST ${B}/workflows/wf_1/enable`,
    `POST ${B}/workflows/wf_1/disable`,
  ]);
});

Deno.test("functions version ops: exact method + path, and each unwrap rule", async () => {
  const c = client((call) => {
    if (call.url.endsWith("/versions")) return json(LIST);
    if (call.url.endsWith("/versions/2")) return json({ version: DETAIL });
    if (call.url.endsWith("/publish")) return json(PUBLISHED);
    if (call.url.endsWith("/revert")) return json({ reverted: REVERTED });
    return json({ enabled: false });
  });
  const f = c.client.functions;

  assertEquals(await f.listVersions("fn_1"), LIST);
  assertEquals(await f.getVersion("fn_1", 2), DETAIL);
  assertEquals(await f.publish("fn_1"), PUBLISHED);
  assertEquals(await f.revert("fn_1", 1), REVERTED);
  assertEquals(await f.enable("fn_1"), undefined);
  assertEquals(await f.disable("fn_1"), undefined);

  assertEquals(c.calls.map((x) => `${x.method} ${x.url}`), [
    `GET ${B}/functions/fn_1/versions`,
    `GET ${B}/functions/fn_1/versions/2`,
    `POST ${B}/functions/fn_1/publish`,
    `POST ${B}/functions/fn_1/versions/1/revert`,
    `POST ${B}/functions/fn_1/enable`,
    `POST ${B}/functions/fn_1/disable`,
  ]);
});

Deno.test("workflows.runVersion: /run verb, wait query, body, and the run result", async () => {
  const c = client(() => json({ runId: "run_1", status: "succeeded", steps: {} }, 200));

  const run = await c.client.workflows.runVersion("wf_1", 3, {
    wait: true,
    variables: { a: 1 },
    trigger: "manual",
    input: { b: 2 },
  });

  assertEquals(c.calls[0].method, "POST");
  assertEquals(c.calls[0].url, `${B}/workflows/wf_1/versions/3/run?wait=true`);
  assertEquals(JSON.parse(c.calls[0].body ?? "null"), {
    variables: { a: 1 },
    trigger: "manual",
    input: { b: 2 },
  });
  assertEquals(run.runId, "run_1");
  assertEquals(run.terminal, true);
  assertEquals(run.httpStatus, 200);
});

Deno.test("workflows.runVersion: no wait means no query; 202 is success", async () => {
  const c = client(() => json({ runId: "run_1", status: "queued" }, 202));

  const run = await c.client.workflows.runVersion("wf_1", 3);

  assertEquals(c.calls[0].url, `${B}/workflows/wf_1/versions/3/run`);
  assertEquals(JSON.parse(c.calls[0].body ?? "null"), {});
  assertEquals(run.httpStatus, 202);
  assertEquals(run.terminal, false);
});

Deno.test("functions.runVersion: /invoke verb, payload becomes inputs, output unwrapped", async () => {
  const c = client(() => json({ kind: "function", output: { ok: 1 }, invocationId: "inv_1" }));

  const out = await c.client.functions.runVersion("fn_1", 2, { payload: { to: "a" } });

  assertEquals(c.calls[0].method, "POST");
  assertEquals(c.calls[0].url, `${B}/functions/fn_1/versions/2/invoke`);
  assertEquals(JSON.parse(c.calls[0].body ?? "null"), { inputs: { to: "a" } });
  assertEquals(out, { ok: 1 });
});

Deno.test("functions.runVersion: a null output is a successful run; a missing one is bad_response", async () => {
  const ok = client(() => json({ output: null }));
  assertEquals(await ok.client.functions.runVersion("fn_1", 1), null);
  assertEquals(JSON.parse(ok.calls[0].body ?? "null"), { inputs: {} });

  const bad = client(() => json({ kind: "function" }));
  const err = await assertRejects(() => bad.client.functions.runVersion("fn_1", 1), ApiError);
  assertEquals(err.code, "bad_response");
});

Deno.test("allowUnpublished is present only when true, for BOTH run methods", async () => {
  const w = client(() => json({ runId: "r", status: "queued" }, 202));
  await w.client.workflows.run("wf_1", { allowUnpublished: true });
  await w.client.workflows.run("wf_1", { allowUnpublished: false });
  await w.client.workflows.run("wf_1");
  assertEquals(JSON.parse(w.calls[0].body ?? "null"), { allowUnpublished: true });
  assertEquals(JSON.parse(w.calls[1].body ?? "null"), {});
  assertEquals(JSON.parse(w.calls[2].body ?? "null"), {});

  const f = client(() => json({ output: 1 }));
  await f.client.functions.run("send-email", { allowUnpublished: true, payload: { a: 1 } });
  await f.client.functions.run("send-email", { allowUnpublished: false });
  await f.client.functions.run("send-email");
  assertEquals(JSON.parse(f.calls[0].body ?? "null"), { inputs: { a: 1 }, allowUnpublished: true });
  assertEquals(JSON.parse(f.calls[1].body ?? "null"), { inputs: {} });
  assertEquals(JSON.parse(f.calls[2].body ?? "null"), { inputs: {} });
  assertEquals(f.calls[0].url, `${B}/functions/send-email/invoke`, "body, not query");
});

Deno.test("runVersion never sends allowUnpublished, even if a JS caller passes it", async () => {
  const w = client(() => json({ runId: "r", status: "queued" }, 202));
  // deno-lint-ignore no-explicit-any
  await w.client.workflows.runVersion("wf_1", 1, { allowUnpublished: true } as any);
  assertEquals(JSON.parse(w.calls[0].body ?? "null"), {});

  const f = client(() => json({ output: 1 }));
  // deno-lint-ignore no-explicit-any
  await f.client.functions.runVersion("fn_1", 1, { allowUnpublished: true } as any);
  assertEquals(JSON.parse(f.calls[0].body ?? "null"), { inputs: {} });
});

Deno.test("an id containing a slash is percent-encoded in every version path", async () => {
  const c = client((call) => {
    if (call.url.endsWith("/versions/1")) return json({ version: DETAIL });
    if (call.url.endsWith("/revert")) return json({ reverted: REVERTED });
    if (call.url.endsWith("/run") || call.url.endsWith("/invoke")) {
      return json({ runId: "r", status: "queued", output: 1 }, 202);
    }
    return json({});
  });
  await c.client.workflows.getVersion("a/b", 1);
  await c.client.workflows.revert("a/b", 1);
  await c.client.workflows.runVersion("a/b", 1);
  await c.client.functions.runVersion("a/b", 1);
  await c.client.functions.enable("a/b");

  assertEquals(c.calls.map((x) => x.url), [
    `${B}/workflows/a%2Fb/versions/1`,
    `${B}/workflows/a%2Fb/versions/1/revert`,
    `${B}/workflows/a%2Fb/versions/1/run`,
    `${B}/functions/a%2Fb/versions/1/invoke`,
    `${B}/functions/a%2Fb/enable`,
  ]);
});

Deno.test("a 4xx on a version op surfaces as ApiError with status, code and body intact", async () => {
  const body = { error: { code: "unknown_version", message: "No version 9." } };
  const w = client(() => json(body, 404));
  const e1 = await assertRejects(() => w.client.workflows.getVersion("wf_1", 9), ApiError);
  assertEquals([e1.status, e1.code], [404, "unknown_version"]);
  assertEquals(e1.raw, body);
  assertEquals(w.calls.length, 1, "no retry");

  const fbody = { error: { code: "function_not_published", message: "Publish it." } };
  const f = client(() => json(fbody, 422));
  const e2 = await assertRejects(() => f.client.functions.runVersion("fn_1", 1), ApiError);
  assertEquals([e2.status, e2.code], [422, "function_not_published"]);
  assertEquals(e2.raw, fbody);

  const p = client(() => json({ error: { code: "unknown_workflow", message: "x" } }, 404));
  const e3 = await assertRejects(() => p.client.workflows.publish("wf_1"), ApiError);
  assertEquals(e3.code, "unknown_workflow");
});

Deno.test("getVersion / revert reject an envelope without its key as bad_response", async () => {
  const c = client(() => json({}));
  const e1 = await assertRejects(() => c.client.functions.getVersion("fn_1", 1), ApiError);
  assertEquals(e1.code, "bad_response");
  const e2 = await assertRejects(() => c.client.workflows.revert("wf_1", 1), ApiError);
  assertEquals(e2.code, "bad_response");
});
