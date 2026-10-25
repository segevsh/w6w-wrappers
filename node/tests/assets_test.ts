/** `client.assets.*` against an injected fake `fetch`: byte bodies in and out. */

import { assertEquals, assertRejects } from "@std/assert";
import { W6WClient } from "../src/client.ts";
import type { FetchLike } from "../src/config.ts";
import { ApiError } from "../src/errors.ts";

interface Call {
  url: string;
  method: string | undefined;
  headers: Headers;
  body: unknown;
}

function fake(respond: (call: Call) => Response): { client: W6WClient; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = (input, init) => {
    const call: Call = {
      url: input,
      method: init?.method,
      headers: new Headers(init?.headers),
      body: init?.body ?? null,
    };
    calls.push(call);
    return Promise.resolve(respond(call));
  };
  const client = new W6WClient({ baseUrl: "https://api.test", token: "tok", fetch });
  return { client, calls };
}

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

const BYTES = new Uint8Array([0xff, 0xfe, 0x00, 0x41, 0x80]);

async function sha256Hex(b: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", b as Uint8Array<ArrayBuffer>));
  return [...d].map((x) => x.toString(16).padStart(2, "0")).join("");
}

Deno.test("assets.uploads.putEntry sends the exact bytes as octet-stream and unwraps entry", async () => {
  const { client, calls } = fake(() => json({ entry: { index: 2, state: "received" } }));
  const out = await client.assets.uploads.putEntry("up_1", 2, BYTES);
  assertEquals(out, { index: 2, state: "received" } as unknown as typeof out);
  const c = calls[0];
  assertEquals(c.method, "PUT");
  assertEquals(c.url, "https://api.test/asset-uploads/up_1/entries/2");
  assertEquals(c.headers.get("content-type"), "application/octet-stream");
  const sent = new Uint8Array(await new Response(c.body as BodyInit).arrayBuffer());
  assertEquals(await sha256Hex(sent), await sha256Hex(BYTES));
  assertEquals([...sent], [...BYTES]);
});

Deno.test("assets.content and archiveDownload return exact non-UTF-8 bytes", async () => {
  const { client, calls } = fake(() =>
    new Response(BYTES, { headers: { "content-type": "application/octet-stream" } })
  );
  assertEquals([...await client.assets.content("a 1", "v1", "f1")], [...BYTES]);
  assertEquals(calls[0].url, "https://api.test/assets/a%201/versions/v1/files/f1/content");
  assertEquals([...await client.assets.archiveDownload("a1", "v1")], [...BYTES]);
  assertEquals(calls[1].url, "https://api.test/assets/a1/versions/v1/archive");
});

Deno.test("byte mode non-2xx raises the typed error with the envelope code", async () => {
  const { client } = fake(() => json({ error: { code: "not_found", message: "nope" } }, 404));
  const e = await assertRejects(() => client.assets.content("a", "v", "f"), ApiError);
  assertEquals((e as ApiError).code, "not_found");
  assertEquals((e as ApiError).status, 404);
  const { client: c2 } = fake(() =>
    json({ error: { code: "payload_too_large", message: "x" } }, 413)
  );
  const e2 = await assertRejects(() => c2.assets.uploads.putEntry("u", 0, BYTES), ApiError);
  assertEquals((e2 as ApiError).code, "payload_too_large");
});

Deno.test("JSON ops hit the right paths and unwrap envelopes", async () => {
  const { client, calls } = fake((c) => {
    if (c.url.endsWith("/versions")) return json({ versions: [{ id: "v1" }] });
    if (c.method === "POST" && c.url.endsWith("/archive")) return json({ asset: { id: "a1" } });
    if (c.url.endsWith("/asset-uploads")) return json({ upload: { id: "u1" }, entries: [] }, 201);
    if (c.url.endsWith("/files")) return json({ version: { id: "v1" }, files: [] });
    if (c.method === "DELETE" && c.url.includes("/assets/")) {
      return json({ assetId: "a1", versionsDeleted: 1, objectsDeleted: 2 });
    }
    return json({ asset: { id: "a1" } });
  });
  assertEquals((await client.assets.get("a1")).id, "a1");
  assertEquals((await client.assets.versions("a1")).length, 1);
  assertEquals((await client.assets.archive("a1")).id, "a1");
  assertEquals((await client.assets.files("a1", "v1")).files, []);
  await client.assets.purge("a1");
  const created = await client.assets.uploads.create({
    purpose: "skill",
    idempotencyKey: "k",
    entries: [],
  });
  assertEquals(created.upload.id, "u1");
  assertEquals(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`), [
    "GET /assets/a1",
    "GET /assets/a1/versions",
    "POST /assets/a1/archive",
    "GET /assets/a1/versions/v1/files",
    "DELETE /assets/a1",
    "POST /asset-uploads",
  ]);
});

// ---------------------------------------------------------------------------
// `console.storage` — the account's storage bindings and agent-limit settings.
// Console-only (P-D5): these routes are deliberately absent from
// `endpoints.json`, so the last case below pins that absence as the contract.
// ---------------------------------------------------------------------------

/** A binding as the server's allowlist sends it: identity and status, never a destination. */
const BINDING = {
  id: "b1",
  name: "primary",
  provider: "s3",
  connectionId: "conn_1",
  serverDefault: false,
  status: "active",
  health: { ok: true, checkedAt: "2026-01-01T00:00:00Z" },
  activeRevisionId: "rev_1",
  revision: { id: "rev_1", revision: 1, createdAt: "2026-01-01T00:00:00Z" },
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  retiredAt: null,
};

/** The settings wire shape: effective limits, the stored values behind them, a timestamp. */
const SETTINGS = {
  limits: { maxFileBytes: 26214400, maxPackageBytes: 104857600, maxFiles: 1000 },
  settings: {
    maxFileBytes: null,
    maxPackageBytes: 104857600,
    maxFiles: null,
    retentionDays: 30,
    storageBindingId: "b1",
  },
  updatedAt: "2026-01-01T00:00:00Z",
};

Deno.test("console.storage.bindings calls the §P6 storage-binding paths", async () => {
  const { client, calls } = fake((c) => {
    if (c.url.endsWith("/migrate")) {
      return json({ bindingId: "b1", toRevisionId: "rev_2", enqueued: 3 }, 202);
    }
    if (c.method === "DELETE") return json({ ok: true });
    if (c.method === "POST") return json(BINDING, 201);
    if (new URL(c.url).pathname === "/storage-bindings") {
      return json({ bindings: c.url.includes("includeRetired=true") ? [BINDING] : [] });
    }
    return json(BINDING);
  });
  const b = client.console.storage.bindings;

  assertEquals(await b.list(), []);
  assertEquals((await b.list({ includeRetired: true })).length, 1);
  assertEquals((await b.get("b 1")).id, "b1");
  const created = await b.create({ connectionId: "conn_1", bucket: "bkt", region: "eu-west-1" });
  assertEquals(created.id, "b1");
  await b.delete("b1");
  const migration = await b.migrate("b1");
  assertEquals(migration.enqueued, 3);
  assertEquals(migration.toRevisionId, "rev_2");

  assertEquals(
    calls.map((c) => `${c.method} ${new URL(c.url).pathname}${new URL(c.url).search}`),
    [
      "GET /storage-bindings",
      "GET /storage-bindings?includeRetired=true",
      "GET /storage-bindings/b%201",
      "POST /storage-bindings",
      "DELETE /storage-bindings/b1",
      "POST /storage-bindings/b1/migrate",
    ],
  );
  // The destination goes UP only and is never faked: the create body is exactly the input.
  assertEquals(JSON.parse(calls[3].body as string), {
    connectionId: "conn_1",
    bucket: "bkt",
    region: "eu-west-1",
  });
});

Deno.test("console.storage.settings reads and patches /agent-settings", async () => {
  const { client, calls } = fake(() => json(SETTINGS));
  const s = client.console.storage.settings;

  assertEquals((await s.get()).limits.maxFiles, 1000);
  const patched = await s.patch({ maxFileBytes: 1048576, retentionDays: null });
  assertEquals(patched.settings.retentionDays, 30);

  assertEquals(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`), [
    "GET /agent-settings",
    "PATCH /agent-settings",
  ]);
  // `null` is a value ("clear back to the default"), so it must survive as `null`.
  assertEquals(JSON.parse(calls[1].body as string), { maxFileBytes: 1048576, retentionDays: null });
});

Deno.test("console.storage is console-only: endpoints.json lists none of it", async () => {
  const text = await Deno.readTextFile(new URL("../../endpoints.json", import.meta.url));
  const contract = JSON.parse(text) as {
    operations: { name: string; path?: string; naming?: { ts?: string } }[];
  };
  const listed = contract.operations.filter((op) =>
    (op.path ?? "").includes("/storage-bindings") ||
    (op.path ?? "").includes("/agent-settings") ||
    op.name.startsWith("storage.") ||
    op.name.startsWith("agentSettings.") ||
    (op.naming?.ts ?? "").includes("console.storage")
  );
  assertEquals(listed, []);

  // …and every method DOES resolve on a client, so the absence is a decision, not a hole.
  const { client } = fake(() => json({}));
  for (const name of ["list", "create", "get", "delete", "migrate"]) {
    assertEquals(
      typeof (client.console.storage.bindings as unknown as Record<string, unknown>)[name],
      "function",
    );
  }
  for (const name of ["get", "patch"]) {
    assertEquals(
      typeof (client.console.storage.settings as unknown as Record<string, unknown>)[name],
      "function",
    );
  }
});

Deno.test("assets.uploads.create/finalize pass the server's index and the linked skill/entry through untouched", async () => {
  // The server, not the caller, assigns each entry's `index`: a response may list entries
  // in an order unlike the request's, and finalize may carry the linked skill or entry.
  const created = {
    upload: { id: "up_1", status: "open" },
    entries: [
      { index: 0, path: "a.txt", sizeBytes: 1, sha256: "aa", state: "pending", receivedAt: null },
      {
        index: 1,
        path: "SKILL.md",
        sizeBytes: 2,
        sha256: "bb",
        state: "pending",
        receivedAt: null,
      },
    ],
  };
  const finalized = {
    uploadId: "up_1",
    assetId: "as_1",
    versionId: "av_1",
    version: 1,
    readiness: "ready",
    derived: null,
    created: true,
    skill: { id: "sk_1", name: "demo" },
    skillVersion: { id: "sv_1", skillId: "sk_1", version: 1 },
  };
  const { client, calls } = fake((call) =>
    call.url.endsWith("/finalize") ? json(finalized) : json(created)
  );
  const st = await client.assets.uploads.create({
    purpose: "skill",
    idempotencyKey: "k",
    entries: [
      { path: "SKILL.md", sizeBytes: 2, sha256: "bb" },
      { path: "a.txt", sizeBytes: 1, sha256: "aa" },
    ],
  });
  // Request order is SKILL.md, a.txt; the server's indexes are the reverse.
  assertEquals(JSON.parse(calls[0].body as string).entries[0].path, "SKILL.md");
  assertEquals(st.entries.map((e) => [e.path, e.index]), [["a.txt", 0], ["SKILL.md", 1]]);
  const fin = await client.assets.uploads.finalize("up_1");
  assertEquals(fin.skill?.id, "sk_1");
  assertEquals(fin.skillVersion?.id, "sv_1");
  assertEquals(fin.entry, undefined);
});
