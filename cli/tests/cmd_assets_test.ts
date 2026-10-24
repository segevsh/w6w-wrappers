/**
 * `w6w assets …`, driven through the dispatcher against a fake server.
 *
 * Same rules as every wrapper suite: the **real** command line (`main()`, the real
 * registry, the real SDK) with only the environment and `fetch` substituted, and
 * real temporary directories on disk for the upload walk. No live server.
 *
 * What is pinned, beyond "it works":
 *
 * - **The declaration matches the bytes sent.** The fake server re-hashes every
 *   PUT body and compares it with the sha256 the reserve call declared, so a
 *   digest taken from a different read than the one sent fails here.
 * - **A symlink aborts before ANY request** — asserted on the recorded call list
 *   being empty, not on the message.
 * - **`--retry` resumes**: only the entries the status reports as pending are PUT.
 * - **A uniform 404 is exit 2 with one stderr line**, never a stack trace.
 * - **Bytes out are exact**, including a non-UTF-8 sequence.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import type { FetchLike } from "@w6w/sdk";
import { main } from "../mod.ts";
import type { EnvReader } from "../mod.ts";
import { COMMANDS } from "../src/commands/index.ts";
import { useStdoutBytes } from "../src/commands/assets.ts";

const BASE = "https://api.example.test";
const CONFIGURED: Record<string, string> = { W6W_BASE_URL: BASE, W6W_TOKEN: "t_cli" };
const ENV: EnvReader = (name) => CONFIGURED[name];

interface Recorded {
  url: string;
  method: string;
  contentType: string | null;
  /** The raw request body bytes, or `undefined` for a bodiless request. */
  bytes: Uint8Array | undefined;
}

type Reply = (call: Recorded) => Response;

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

function bodyBytes(body: unknown): Uint8Array | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") return new TextEncoder().encode(body);
  if (body instanceof Uint8Array) return body;
  throw new Error(`unexpected request body type: ${typeof body}`);
}

async function w6w(argv: string[], reply: Reply): Promise<Ran> {
  const calls: Recorded[] = [];
  const stdout: string[] = [];
  const stderr: string[] = [];
  const fetch: FetchLike = (url, init) => {
    const call: Recorded = {
      url,
      method: init?.method ?? "GET",
      contentType: new Headers(init?.headers).get("content-type"),
      bytes: bodyBytes(init?.body),
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

const text = (bytes: Uint8Array | undefined) => new TextDecoder().decode(bytes);

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A scratch directory, removed afterwards. */
async function withDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "w6w-assets-test-" });
  try {
    await run(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

const UPLOAD = {
  id: "up_1",
  purpose: "skill",
  status: "open",
};

/**
 * A stateful fake `/asset-uploads` server. Records what `create` declared, and on
 * every PUT checks the body's sha256 against that declaration.
 */
function fakeServer(options: { received?: number[]; createStatus?: number } = {}) {
  let declared: { path: string; sizeBytes: number; sha256: string }[] = [];
  const received = new Set<number>(options.received ?? []);
  const mismatches: string[] = [];
  const reply: Reply = (call) => {
    const url = new URL(call.url);
    const entriesView = () => ({
      upload: UPLOAD,
      entries: declared.map((e, index) => ({
        index,
        ...e,
        state: received.has(index) ? "received" : "pending",
        receivedAt: null,
      })),
    });
    if (call.method === "POST" && url.pathname === "/asset-uploads") {
      declared = JSON.parse(text(call.bytes)).entries;
      return json(options.createStatus ?? 201, entriesView());
    }
    if (call.method === "GET" && url.pathname === "/asset-uploads/up_1") {
      return json(200, entriesView());
    }
    const put = url.pathname.match(/^\/asset-uploads\/up_1\/entries\/(\d+)$/);
    if (call.method === "PUT" && put) {
      const index = Number(put[1]);
      // The digest is checked after the run (`verify`): a reply must be synchronous.
      pending.push({ index, sent: call.bytes ?? new Uint8Array(), want: declared[index] });
      received.add(index);
      return json(200, { entry: { index } });
    }
    if (call.method === "POST" && url.pathname === "/asset-uploads/up_1/finalize") {
      return json(200, {
        uploadId: "up_1",
        assetId: "ast_1",
        versionId: "ver_1",
        version: 1,
        readiness: "ready",
        derived: null,
        created: true,
      });
    }
    return json(404, { error: { code: "not_found", message: "not found" } });
  };
  const pending: { index: number; sent: Uint8Array; want: { sha256: string } }[] = [];
  return {
    reply,
    pending,
    async verify() {
      for (const { index, sent, want } of pending) {
        if ((await sha256Hex(sent)) !== want.sha256) mismatches.push(`entry ${index}`);
      }
      return mismatches;
    },
    get declared() {
      return declared;
    },
  };
}

async function writeTree(dir: string): Promise<void> {
  await Deno.mkdir(`${dir}/refs`, { recursive: true });
  await Deno.writeTextFile(`${dir}/SKILL.md`, "# skill\n");
  await Deno.writeFile(`${dir}/refs/data.bin`, new Uint8Array([0xff, 0xfe, 0x00, 0x01]));
}

Deno.test("assets upload <dir>: declares relative paths + sha256 of the bytes sent, then finalizes", async () => {
  await withDir(async (dir) => {
    await writeTree(dir);
    const server = fakeServer();
    const r = await w6w(
      ["assets", "upload", dir, "--purpose", "skill", "--skill", "sk_1", "--json"],
      server.reply,
    );
    assertEquals(r.code, 0, r.stderr);
    assertEquals(
      r.calls.map((c) => `${c.method} ${new URL(c.url).pathname}`),
      [
        "POST /asset-uploads",
        "PUT /asset-uploads/up_1/entries/0",
        "PUT /asset-uploads/up_1/entries/1",
        "POST /asset-uploads/up_1/finalize",
      ],
    );
    const create = JSON.parse(text(r.calls[0].bytes));
    assertEquals(create.purpose, "skill");
    assertEquals(create.target, { skillId: "sk_1" });
    assertEquals(
      create.entries.map((e: { path: string }) => e.path),
      ["SKILL.md", "refs/data.bin"],
    );
    assertEquals(create.entries[0].sha256, await sha256Hex(new TextEncoder().encode("# skill\n")));
    assertEquals(create.entries[1].sizeBytes, 4);
    // The PUTs carry the exact bytes, raw, as octet-stream — and they hash to the declaration.
    assertEquals(r.calls[1].contentType, "application/octet-stream");
    assertEquals(text(r.calls[1].bytes), "# skill\n");
    assertEquals(Array.from(r.calls[2].bytes!), [0xff, 0xfe, 0x00, 0x01]);
    assertEquals(await server.verify(), []);
    assertEquals(JSON.parse(r.stdout).assetId, "ast_1");
  });
});

Deno.test("assets upload: progress goes to stderr, stdout stays the result", async () => {
  await withDir(async (dir) => {
    await writeTree(dir);
    const r = await w6w(
      ["assets", "upload", dir, "--purpose", "context", "--collection", "col_1", "--json"],
      fakeServer().reply,
    );
    assertEquals(r.code, 0, r.stderr);
    assertStringIncludes(r.stderr, "[1/2] SKILL.md");
    assertStringIncludes(r.stderr, "[2/2] refs/data.bin");
    assertEquals(r.stdout.includes("SKILL.md"), false);
    assertEquals(JSON.parse(r.calls[0].bytes ? text(r.calls[0].bytes) : "{}").target, {
      collectionId: "col_1",
    });
  });
});

Deno.test("assets upload: a symlink aborts before ANY request", async () => {
  await withDir(async (dir) => {
    await writeTree(dir);
    await Deno.writeTextFile(`${dir}/outside.txt`, "secret");
    await Deno.mkdir(`${dir}/sub`);
    await Deno.symlink(`${dir}/outside.txt`, `${dir}/sub/link.txt`);
    const r = await w6w(["assets", "upload", dir, "--purpose", "skill"], fakeServer().reply);
    assertEquals(r.calls.length, 0);
    assertEquals(r.code, 1);
    assertStringIncludes(r.stderr, "sub/link.txt");
    assertStringIncludes(r.stderr, "No request was made");
  });
});

Deno.test("assets upload: a symlinked root is refused before any request", async () => {
  await withDir(async (dir) => {
    await writeTree(dir);
    const link = `${dir}-link`;
    await Deno.symlink(dir, link);
    try {
      const r = await w6w(["assets", "upload", link, "--purpose", "skill"], fakeServer().reply);
      assertEquals(r.calls.length, 0);
      assertEquals(r.code, 1);
    } finally {
      await Deno.remove(link);
    }
  });
});

Deno.test("assets upload --retry: skips entries the status reports received", async () => {
  await withDir(async (dir) => {
    await writeTree(dir);
    const server = fakeServer({ received: [0], createStatus: 200 });
    const r = await w6w(
      ["assets", "upload", dir, "--purpose", "skill", "--retry", "--json"],
      server.reply,
    );
    assertEquals(r.code, 0, r.stderr);
    assertEquals(
      r.calls.map((c) => `${c.method} ${new URL(c.url).pathname}`),
      [
        "POST /asset-uploads",
        "GET /asset-uploads/up_1",
        "PUT /asset-uploads/up_1/entries/1",
        "POST /asset-uploads/up_1/finalize",
      ],
    );
    assertStringIncludes(r.stderr, "1 already received");
  });
});

Deno.test("assets upload --retry: the idempotency key is stable for the same tree; without it, it is not", async () => {
  await withDir(async (dir) => {
    await writeTree(dir);
    const key = async (extra: string[]) => {
      const r = await w6w(
        ["assets", "upload", dir, "--purpose", "skill", ...extra],
        fakeServer().reply,
      );
      return JSON.parse(text(r.calls[0].bytes)).idempotencyKey as string;
    };
    assertEquals(await key(["--retry"]), await key(["--retry"]));
    assert((await key([])) !== (await key([])));
  });
});

Deno.test("assets upload <zip>: one archive entry, sent as archive: true", async () => {
  await withDir(async (dir) => {
    const zip = `${dir}/pkg.zip`;
    await Deno.writeFile(zip, new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff]));
    const server = fakeServer();
    const r = await w6w(["assets", "upload", zip, "--purpose", "skill", "--json"], server.reply);
    assertEquals(r.code, 0, r.stderr);
    const create = JSON.parse(text(r.calls[0].bytes));
    assertEquals(create.archive, true);
    assertEquals(create.entries.length, 1);
    assertEquals(create.entries[0].path, "pkg.zip");
    assertEquals(Array.from(r.calls[1].bytes!), [0x50, 0x4b, 0x03, 0x04, 0xff]);
    assertEquals(await server.verify(), []);
  });
});

Deno.test("assets upload: flag combinations that make no sense are usage errors with no request", async () => {
  await withDir(async (dir) => {
    await writeTree(dir);
    for (
      const argv of [
        ["--purpose", "bogus"],
        ["--purpose", "skill", "--collection", "c"],
        ["--purpose", "context", "--skill", "s"],
        ["--purpose", "skill", "--skill", "s", "--collection", "c"],
        [],
      ]
    ) {
      const r = await w6w(["assets", "upload", dir, ...argv], fakeServer().reply);
      assertEquals(r.code, 1, argv.join(" "));
      assertEquals(r.calls.length, 0);
    }
  });
});

Deno.test("assets upload --retry: a uniform 404 from the status read is exit 2, one line, no stack", async () => {
  await withDir(async (dir) => {
    await writeTree(dir);
    const r = await w6w(
      ["assets", "upload", dir, "--purpose", "skill", "--retry"],
      (call) =>
        call.method === "POST"
          ? json(200, { upload: UPLOAD, entries: [] })
          : json(404, { error: { code: "not_found", message: "not found" } }),
    );
    assertEquals(r.code, 2);
    assertEquals(r.stderr.trim(), "w6w: not found");
  });
});

Deno.test("assets upload-status: a uniform 404 is a not-found API error, not a stack trace", async () => {
  const r = await w6w(
    ["assets", "upload-status", "up_gone"],
    () => json(404, { error: { code: "not_found", message: "not found" } }),
  );
  assertEquals(r.code, 2);
  assertEquals(r.stderr.trim(), "w6w: not found");
});

Deno.test("assets content: exact bytes (non-UTF-8) to --out and to stdout; a 404 raises the typed error", async () => {
  const payload = new Uint8Array([0xff, 0xfe, 0x00, 0x41]);
  const bytesReply: Reply = () =>
    new Response(payload, { status: 200, headers: { "content-type": "application/octet-stream" } });
  await withDir(async (dir) => {
    const out = `${dir}/file.bin`;
    const r = await w6w(["assets", "content", "a1", "v1", "f1", "--out", out], bytesReply);
    assertEquals(r.code, 0, r.stderr);
    assertEquals(r.calls[0].url, `${BASE}/assets/a1/versions/v1/files/f1/content`);
    assertEquals(Array.from(await Deno.readFile(out)), Array.from(payload));
  });
  const chunks: Uint8Array[] = [];
  const restore = useStdoutBytes((b) => {
    chunks.push(b);
    return Promise.resolve();
  });
  try {
    const r = await w6w(["assets", "content", "a1", "v1", "f1"], bytesReply);
    assertEquals(r.code, 0, r.stderr);
    assertEquals(chunks.map((c) => Array.from(c)), [Array.from(payload)]);
    assertEquals(r.stdout, "");
  } finally {
    restore();
  }
  const missing = await w6w(
    ["assets", "content", "a1", "v1", "f1", "--out", "/nonexistent-dir/x"],
    () => json(404, { error: { code: "not_found", message: "no" } }),
  );
  assertEquals(missing.code, 2);
  assertEquals(missing.stderr.trim(), "w6w: no");
});

Deno.test("assets get/versions/files/archive/purge: paths and unwrapping", async () => {
  const get = await w6w(
    ["assets", "get", "a1", "--json"],
    () => json(200, { asset: { id: "a1" } }),
  );
  assertEquals(get.calls[0].url, `${BASE}/assets/a1`);
  assertEquals(JSON.parse(get.stdout), { id: "a1" });

  const versions = await w6w(
    ["assets", "versions", "a1", "--json"],
    () => json(200, { versions: [{ id: "v1", version: 1, readiness: "ready" }] }),
  );
  assertEquals(versions.calls[0].url, `${BASE}/assets/a1/versions`);
  assertEquals(JSON.parse(versions.stdout)[0].id, "v1");

  const files = await w6w(
    ["assets", "files", "a1", "v1"],
    () => json(200, { version: { id: "v1" }, files: [{ id: "f1", path: "x", sizeBytes: 3 }] }),
  );
  assertEquals(files.calls[0].url, `${BASE}/assets/a1/versions/v1/files`);
  assertStringIncludes(files.stdout, "f1");

  const archive = await w6w(
    ["assets", "archive", "a1", "--json"],
    () => json(200, { asset: { id: "a1", archivedAt: "t" } }),
  );
  assertEquals(archive.calls[0].method, "POST");
  assertEquals(archive.calls[0].url, `${BASE}/assets/a1/archive`);

  const purge = await w6w(
    ["assets", "purge", "a1", "--json"],
    () => json(200, { assetId: "a1", versionsDeleted: 1, objectsDeleted: 2 }),
  );
  assertEquals(purge.calls[0].method, "DELETE");
  assertEquals(JSON.parse(purge.stdout).objectsDeleted, 2);
});

Deno.test("assets upload-put: sends the file's exact bytes as octet-stream", async () => {
  await withDir(async (dir) => {
    const file = `${dir}/e.bin`;
    await Deno.writeFile(file, new Uint8Array([0xff, 0xfe, 0x00]));
    const r = await w6w(
      ["assets", "upload-put", "up_1", "3", "--file", file, "--json"],
      () => json(200, { entry: { index: 3 } }),
    );
    assertEquals(r.code, 0, r.stderr);
    assertEquals(r.calls[0].method, "PUT");
    assertEquals(r.calls[0].url, `${BASE}/asset-uploads/up_1/entries/3`);
    assertEquals(r.calls[0].contentType, "application/octet-stream");
    assertEquals(Array.from(r.calls[0].bytes!), [0xff, 0xfe, 0x00]);
  });
});

Deno.test("assets upload-create: one flag per parameter; absent flags send nothing", async () => {
  const entries = [{ path: "a.txt", sizeBytes: 1, sha256: "ab" }];
  const r = await w6w(
    [
      "assets",
      "upload-create",
      "--purpose",
      "asset",
      "--idempotency-key",
      "k1",
      "--entries",
      JSON.stringify(entries),
      "--target",
      '{"skillId":"s1"}',
      "--json",
    ],
    () => json(201, { upload: UPLOAD, entries: [] }),
  );
  assertEquals(r.code, 0, r.stderr);
  assertEquals(r.calls[0].url, `${BASE}/asset-uploads`);
  assertEquals(JSON.parse(text(r.calls[0].bytes)), {
    purpose: "asset",
    idempotencyKey: "k1",
    entries,
    target: { skillId: "s1" },
  });
});
