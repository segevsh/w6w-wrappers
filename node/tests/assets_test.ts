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
