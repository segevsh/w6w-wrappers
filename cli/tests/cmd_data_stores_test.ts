/**
 * `w6w data-stores …`, driven through the dispatcher against a fake transport.
 *
 * The real command line (`main()`, the real registry, the real SDK) with the
 * environment, `fetch` and stdin substituted. Assertions are against
 * independent literals: the request recorded by the fake and a canned body.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import type { FetchLike } from "@w6w/sdk";
import { HELP_TREE, main } from "../mod.ts";
import type { EnvReader, StdinSource } from "../mod.ts";
import { COMMANDS, DATA_STORE_COMMANDS } from "../src/commands/index.ts";
import { useStdoutBytes } from "../src/commands/assets.ts";

const BASE = "https://api.example.test";
const CONFIGURED: Record<string, string> = { W6W_BASE_URL: BASE, W6W_TOKEN: "t_cli" };
const ENV: EnvReader = (name) => CONFIGURED[name];

interface Recorded {
  url: string;
  method: string;
  /** The body as sent: parsed when it is JSON, the raw text otherwise. */
  body: unknown;
  rawBody: string | undefined;
  contentType: string | null;
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

async function w6w(
  argv: string[],
  reply: Reply = () => json(200, {}),
  stdin?: StdinSource,
): Promise<Ran> {
  const calls: Recorded[] = [];
  const stdout: string[] = [];
  const stderr: string[] = [];
  const fetch: FetchLike = (url, init) => {
    const rawBody = typeof init?.body === "string" ? init.body : undefined;
    const contentType = new Headers(init?.headers).get("content-type");
    let body: unknown = rawBody;
    if (rawBody !== undefined && contentType?.includes("json")) body = JSON.parse(rawBody);
    const call: Recorded = { url, method: init?.method ?? "GET", body, rawBody, contentType };
    calls.push(call);
    return Promise.resolve(reply(call));
  };
  const code = await main(argv, {
    stdout: (text) => stdout.push(text),
    stderr: (text) => stderr.push(text),
  }, { env: ENV, fetch, commands: COMMANDS, stdin });
  return { code, stdout: stdout.join("\n"), stderr: stderr.join("\n"), calls };
}

function stdinOf(text: string): StdinSource & { reads: number } {
  const source = {
    reads: 0,
    isTerminal: () => false,
    read: () => (source.reads++, Promise.resolve(text)),
  };
  return source;
}

const URL_DS = `${BASE}/data-stores`;

Deno.test("data-stores list: GET with only the given flags; --project forwarded", async () => {
  const ran = await w6w(
    ["data-stores", "list", "--kind", "table", "--limit", "5", "--project", "prj_1", "--json"],
    () => json(200, { items: [] }),
  );
  assertEquals(ran.code, 0, ran.stderr);
  assertEquals(ran.calls[0].method, "GET");
  assertEquals(ran.calls[0].url, `${URL_DS}?kind=table&limit=5&project=prj_1`);
  assertEquals(JSON.parse(ran.stdout), { items: [] });
  const bare = await w6w(["data-stores", "list"], () => json(200, { items: [] }));
  assertEquals(bare.calls[0].url, URL_DS);
});

Deno.test("data-stores get / archive: percent-encoded id; archive is a DELETE", async () => {
  const got = await w6w(["data-stores", "get", "a/b"], () => json(200, { id: "a/b" }));
  assertEquals(got.calls[0].url, `${URL_DS}/a%2Fb`);
  const gone = await w6w(
    ["data-stores", "archive", "ds_1"],
    () => new Response(null, { status: 204 }),
  );
  assertEquals(gone.code, 0, gone.stderr);
  assertEquals(gone.calls[0].method, "DELETE");
  assertEquals(gone.calls[0].url, `${URL_DS}/ds_1`);
});

Deno.test("data-stores create / update: body carries only the given fields, schema as JSON", async () => {
  const created = await w6w(
    ["data-stores", "create", "visits", "--kind", "table", "--schema", '{"columns":[]}'],
    () => json(201, { id: "ds_1" }),
  );
  assertEquals(created.calls[0].method, "POST");
  assertEquals(created.calls[0].url, URL_DS);
  assertEquals(created.calls[0].body, { kind: "table", name: "visits", schema: { columns: [] } });
  const updated = await w6w(["data-stores", "update", "ds_1", "--name", "n2"], () => json(200, {}));
  assertEquals(updated.calls[0].method, "PATCH");
  assertEquals(updated.calls[0].body, { name: "n2" });
});

Deno.test("data-stores import: a file is sent verbatim as text/csv", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const file = `${dir}/in.csv`;
    await Deno.writeTextFile(file, "id,name\n1,ä\n");
    const ran = await w6w(
      ["data-stores", "import", "ds_1", "--file", file],
      () => json(200, { imported: 1 }),
    );
    assertEquals(ran.code, 0, ran.stderr);
    assertEquals(ran.calls[0].method, "POST");
    assertEquals(ran.calls[0].url, `${URL_DS}/ds_1/import`);
    assertEquals(ran.calls[0].contentType, "text/csv");
    assertEquals(ran.calls[0].rawBody, "id,name\n1,ä\n");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("data-stores import --file -: reads standard input, not a file named `-`", async () => {
  const stdin = stdinOf("a,b\n1,2\n");
  const ran = await w6w(
    ["data-stores", "import", "ds_1", "--file", "-"],
    () => json(200, { imported: 1 }),
    stdin,
  );
  assertEquals(ran.code, 0, ran.stderr);
  assertEquals(stdin.reads, 1);
  assertEquals(ran.calls[0].rawBody, "a,b\n1,2\n");
  assertEquals(ran.calls[0].contentType, "text/csv");
});

Deno.test("data-stores import: an unreadable file is a usage error with zero requests", async () => {
  const ran = await w6w(["data-stores", "import", "ds_1", "--file", "/nonexistent/x.csv"]);
  assertEquals(ran.code, 1);
  assertStringIncludes(ran.stderr, "Cannot read");
  assertEquals(ran.calls.length, 0);
});

Deno.test("data-stores export: raw CSV to stdout, or to --out", async () => {
  const csv = "id,name\n1,ä\n";
  const reply: Reply = () =>
    new Response(csv, { status: 200, headers: { "content-type": "text/csv" } });
  const chunks: Uint8Array[] = [];
  const restore = useStdoutBytes((b) => {
    chunks.push(b);
    return Promise.resolve();
  });
  try {
    const ran = await w6w(["data-stores", "export", "ds_1"], reply);
    assertEquals(ran.code, 0, ran.stderr);
    assertEquals(ran.calls[0].url, `${URL_DS}/ds_1/export`);
    assertEquals(new TextDecoder().decode(chunks[0]), csv);
    assertEquals(ran.stdout, "");
  } finally {
    restore();
  }
  const dir = await Deno.makeTempDir();
  try {
    const out = `${dir}/out.csv`;
    const ran = await w6w(["data-stores", "export", "ds_1", "--out", out], reply);
    assertEquals(ran.code, 0, ran.stderr);
    assertEquals(await Deno.readTextFile(out), csv);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("data-stores entry-list / entry-get: query and percent-encoded key", async () => {
  const listed = await w6w(
    ["data-stores", "entry-list", "ds_1", "--prefix", "p", "--cursor", "c", "--limit", "2"],
    () => json(200, { items: [] }),
  );
  assertEquals(listed.calls[0].url, `${URL_DS}/ds_1/entries?prefix=p&cursor=c&limit=2`);
  const got = await w6w(["data-stores", "entry-get", "ds_1", "a/b:c"], () => json(200, {}));
  assertEquals(got.calls[0].url, `${URL_DS}/ds_1/entries/a%2Fb%3Ac`);
});

Deno.test("data-stores entry-set: PUT with ifVersion and ttlSeconds in the body beside value", async () => {
  const ran = await w6w(
    [
      "data-stores",
      "entry-set",
      "ds_1",
      "k",
      "--value",
      '{"n":1}',
      "--if-version",
      "3",
      "--ttl-seconds",
      "60",
    ],
    () => json(200, {}),
  );
  assertEquals(ran.code, 0, ran.stderr);
  assertEquals(ran.calls[0].method, "PUT");
  assertEquals(ran.calls[0].url, `${URL_DS}/ds_1/entries/k`);
  assertEquals(ran.calls[0].body, { value: { n: 1 }, ifVersion: 3, ttlSeconds: 60 });
});

Deno.test("data-stores entry-insert / entry-delete / entry-increment", async () => {
  const inserted = await w6w(
    ["data-stores", "entry-insert", "ds_1", "--value", '{"a":1}', "--ttl-seconds", "5"],
    () => json(201, {}),
  );
  assertEquals(inserted.calls[0].method, "POST");
  assertEquals(inserted.calls[0].body, { value: { a: 1 }, ttlSeconds: 5 });
  const deleted = await w6w(
    ["data-stores", "entry-delete", "ds_1", "k"],
    () => new Response(null, { status: 204 }),
  );
  assertEquals(deleted.calls[0].method, "DELETE");
  const bare = await w6w(["data-stores", "entry-increment", "ds_1", "k"], () => json(200, {}));
  assertEquals(bare.calls[0].url, `${URL_DS}/ds_1/entries/k/increment`);
  assertEquals(bare.calls[0].body, undefined);
  const by = await w6w(
    ["data-stores", "entry-increment", "ds_1", "k", "--by", "2"],
    () => json(200, {}),
  );
  assertEquals(by.calls[0].body, { by: 2 });
});

Deno.test("data-stores entry-query: --where repeats, one bracketed pair per column", async () => {
  const ran = await w6w(
    [
      "data-stores",
      "entry-query",
      "ds_1",
      "--where",
      "color=red",
      "--where",
      "n=a=b",
      "--order",
      "n",
      "--limit",
      "3",
    ],
    () => json(200, { items: [] }),
  );
  assertEquals(ran.code, 0, ran.stderr);
  const url = new URL(ran.calls[0].url);
  assertEquals(url.pathname, "/data-stores/ds_1/entries");
  assertEquals(
    [...url.searchParams.entries()],
    [["where[color]", "red"], ["where[n]", "a=b"], ["order", "n"], ["limit", "3"]],
  );
});

Deno.test("data-stores: bad arguments are usage errors, exit 1, zero requests", async () => {
  const cases: [string[], string][] = [
    [["data-stores", "entry-set", "ds_1", "k", "--value", "{bad"], "valid JSON"],
    [["data-stores", "entry-set", "ds_1", "k"], "--value"],
    [["data-stores", "entry-insert", "ds_1", "--value", "[1]"], "JSON object"],
    [["data-stores", "create", "n", "--kind", "table", "--schema", "{bad"], "valid JSON"],
    [["data-stores", "entry-query", "ds_1", "--where", "novalue"], "--where"],
    [["data-stores", "entry-increment", "ds_1", "k", "--by", "x"], "--by"],
    [
      ["data-stores", "entry-set", "ds_1", "k", "--value", "1", "--if-version", "x"],
      "--if-version",
    ],
    [["data-stores", "list", "--limit", "x"], "--limit"],
    [["data-stores", "get"], "data store id"],
  ];
  for (const [argv, expected] of cases) {
    const ran = await w6w(argv);
    assertEquals(ran.code, 1, `\`${argv.join(" ")}\` exited ${ran.code}: ${ran.stderr}`);
    assertStringIncludes(ran.stderr, expected);
    assertEquals(ran.calls.length, 0, "a usage error must not reach the server");
  }
});

Deno.test("data-stores: a 400 envelope exits 2 with its code on stderr (W-4)", async () => {
  const envelopes: Record<string, Record<string, unknown>> = {
    invalid_value: { field: "value", column: "note" },
    invalid_key: { field: "key" },
    invalid_cursor: {},
    unknown_project: {},
  };
  for (const [code, extra] of Object.entries(envelopes)) {
    const ran = await w6w(
      ["data-stores", "entry-set", "ds_1", "k", "--value", "1"],
      () => json(400, { error: { code, message: "m", ...extra } }),
    );
    assertEquals(ran.code, 2, `${code}: ${ran.stderr}`);
    assertStringIncludes(ran.stderr, code);
    assertEquals(ran.stdout, "");
  }
});

Deno.test("every `w6w data-stores` command in the help tree is registered, and no others", () => {
  const group = HELP_TREE.groups.find((candidate) => candidate.name === "data-stores");
  assert(group !== undefined, "the generated help tree has no `data-stores` group");
  const documented = group.commands.map((command) => command.path.join(" ")).sort();
  assertEquals(Object.keys(DATA_STORE_COMMANDS).sort(), documented);
  for (const path of documented) assert(Object.hasOwn(COMMANDS, path), `\`${path}\` is not wired`);
  assertEquals(documented.length, 14);
});
