/**
 * `w6w app-management …`, driven through the dispatcher against a fake transport.
 *
 * The real command line (`main()`, the real registry, the real SDK) with the
 * environment and `fetch` substituted. Assertions are against independent
 * literals: the request recorded by the fake and a canned server body.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import type { FetchLike } from "@w6w/sdk";
import { HELP_TREE, main } from "../mod.ts";
import { APP_MANAGEMENT_COMMANDS, COMMANDS } from "../src/commands/index.ts";
import type { EnvReader } from "../mod.ts";

const BASE = "https://api.example.test";
const CONFIGURED: Record<string, string> = { W6W_BASE_URL: BASE, W6W_TOKEN: "t_cli" };
const ENV: EnvReader = (name) => CONFIGURED[name];
const FOLDER_JSON = '{"folder":{"grant":"g","path":"./x"}}';
const FOLDER = { folder: { grant: "g", path: "./x" } };

interface Recorded {
  url: string;
  method: string;
  body: unknown;
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

async function w6w(argv: string[], reply: Reply = () => json(200, {})): Promise<Ran> {
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

const SYNC_OK = {
  appId: "a_1",
  outcome: "registry_updated",
  completedAt: "2026-10-30T00:00:00.000Z",
  previousVersion: "1.0.0",
  version: "1.0.1",
  bumped: true,
  source: { kind: "github", ref: "github:acme/app", active: true, revision: 4, pinned: false },
};

Deno.test("app-management list: GET with no options sends none; --json prints the page", async () => {
  const page = { apps: [], scope: "all", total: 0, offset: 0, limit: 50, nextCursor: "c2" };
  const ran = await w6w(["app-management", "list", "--json"], () => json(200, page));
  assertEquals(ran.code, 0, ran.stderr);
  assertEquals(ran.calls.length, 1);
  assertEquals(ran.calls[0].method, "GET");
  assertEquals(ran.calls[0].url, `${BASE}/app-management/apps`);
  assertEquals(JSON.parse(ran.stdout), page);
});

Deno.test("app-management list: every flag reaches the wire under its own name", async () => {
  const ran = await w6w(
    [
      "app-management",
      "list",
      "--scope",
      "tenant",
      "--q",
      "mail",
      "--sort=-recent",
      "--compact",
      "--cursor",
      "c1",
      "--offset",
      "0",
      "--limit",
      "5",
      "--json",
    ],
    () => json(200, { apps: [] }),
  );
  assertEquals(ran.code, 0, ran.stderr);
  assertEquals(
    ran.calls[0].url,
    `${BASE}/app-management/apps?scope=tenant&q=mail&sort=-recent&compact=true&cursor=c1&offset=0&limit=5`,
  );
});

Deno.test("app-management list: --snapshot is forwarded", async () => {
  const ran = await w6w(
    ["app-management", "list", "--snapshot", "snap_1", "--json"],
    () => json(200, { apps: [] }),
  );
  assertEquals(ran.calls[0].url, `${BASE}/app-management/apps?snapshot=snap_1`);
});

Deno.test("app-management list: the human table shows rows and the next-page hint", async () => {
  const row = {
    id: "sendgrid",
    version: "1.2.0",
    management: { class: "account" },
    source: { kind: "github", ref: "github:acme/sg", revision: 2 },
    lastSync: { outcome: "failed" },
  };
  const ran = await w6w(
    ["app-management", "list"],
    () => json(200, { apps: [row], total: 9, offset: 0, nextCursor: "c9" }),
  );
  assertEquals(ran.code, 0, ran.stderr);
  assertStringIncludes(ran.stdout, "sendgrid");
  assertStringIncludes(ran.stdout, "github:acme/sg");
  assertStringIncludes(ran.stdout, "--cursor c9");
});

Deno.test("app-management get: percent-encodes the id", async () => {
  const detail = { app: { id: "a/b" } };
  const ran = await w6w(["app-management", "get", "a/b", "--json"], () => json(200, detail));
  assertEquals(ran.code, 0, ran.stderr);
  assertEquals(ran.calls[0].method, "GET");
  assertEquals(ran.calls[0].url, `${BASE}/app-management/apps/a%2Fb`);
  assertEquals(JSON.parse(ran.stdout), detail);
});

Deno.test("app-management preview: a ref is sent as a string with the target", async () => {
  const out = { kind: "app", sourceRef: "github:acme/app", app: {} };
  const ran = await w6w(
    ["app-management", "preview", "github:acme/app", "--target", "account", "--json"],
    () => json(200, out),
  );
  assertEquals(ran.code, 0, ran.stderr);
  assertEquals(ran.calls[0].method, "POST");
  assertEquals(ran.calls[0].url, `${BASE}/app-management/preview`);
  assertEquals(ran.calls[0].body, { source: "github:acme/app", target: "account" });
  assertEquals(JSON.parse(ran.stdout), out);
});

Deno.test("app-management preview: a JSON source becomes an object body", async () => {
  const ran = await w6w(
    ["app-management", "preview", FOLDER_JSON, "--target", "personal", "--json"],
  );
  assertEquals(ran.code, 0, ran.stderr);
  assertEquals(ran.calls[0].body, { source: FOLDER, target: "personal" });
});

Deno.test("app-management register: --paths is split, trimmed and cleaned", async () => {
  const out = { kind: "pack", target: "tenant", registered: 2, failed: 0 };
  const ran = await w6w(
    [
      "app-management",
      "register",
      "github:acme/pack",
      "--target",
      "tenant",
      "--paths",
      "a, b,",
      "--json",
    ],
    () => json(201, out),
  );
  assertEquals(ran.code, 0, ran.stderr);
  assertEquals(ran.calls[0].method, "POST");
  assertEquals(ran.calls[0].url, `${BASE}/app-management/apps`);
  assertEquals(ran.calls[0].body, {
    target: "tenant",
    source: "github:acme/pack",
    paths: ["a", "b"],
  });
  assertEquals(JSON.parse(ran.stdout), out);
});

Deno.test("app-management register: no --paths means no paths key; folder source is an object", async () => {
  const ran = await w6w(
    ["app-management", "register", FOLDER_JSON, "--target", "account", "--json"],
    () => json(201, { kind: "app", target: "account" }),
  );
  assertEquals(ran.code, 0, ran.stderr);
  assertEquals(ran.calls[0].body, { target: "account", source: FOLDER });
});

Deno.test("app-management update-source: PUT with source and expectedRevision", async () => {
  const ran = await w6w(
    ["app-management", "update-source", "a/b", FOLDER_JSON, "--expected-revision", "0", "--json"],
    () => json(200, SYNC_OK),
  );
  assertEquals(ran.code, 0, ran.stderr);
  assertEquals(ran.calls[0].method, "PUT");
  assertEquals(ran.calls[0].url, `${BASE}/app-management/apps/a%2Fb/source`);
  assertEquals(ran.calls[0].body, { source: FOLDER, expectedRevision: 0 });
  assertEquals(JSON.parse(ran.stdout), SYNC_OK);
});

Deno.test("app-management sync: an empty body without --expected-revision, and 0 is sent", async () => {
  const bare = await w6w(["app-management", "sync", "a/b", "--json"], () => json(200, SYNC_OK));
  assertEquals(bare.code, 0, bare.stderr);
  assertEquals(bare.calls[0].method, "POST");
  assertEquals(bare.calls[0].url, `${BASE}/app-management/apps/a%2Fb/sync`);
  assertEquals(bare.calls[0].body, {});
  const zero = await w6w(
    ["app-management", "sync", "x", "--expected-revision", "0", "--json"],
    () => json(200, SYNC_OK),
  );
  assertEquals(zero.calls[0].body, { expectedRevision: 0 });
});

Deno.test("app-management sync: a failed outcome is a 200, exits 0 and prints the error code", async () => {
  const failed = {
    ...SYNC_OK,
    outcome: "failed",
    error: { code: "fetch_failed", message: "upstream said no" },
  };
  const human = await w6w(["app-management", "sync", "a_1"], () => json(200, failed));
  assertEquals(human.code, 0, human.stderr);
  assertStringIncludes(human.stdout, "failed");
  assertStringIncludes(human.stdout, "fetch_failed");
  const machine = await w6w(["app-management", "sync", "a_1", "--json"], () => json(200, failed));
  assertEquals(machine.code, 0);
  assertEquals(JSON.parse(machine.stdout), failed);
});

Deno.test("app-management remove: DELETE and the removed count", async () => {
  const ran = await w6w(
    ["app-management", "remove", "a/b", "--json"],
    () => json(200, { removed: 3 }),
  );
  assertEquals(ran.code, 0, ran.stderr);
  assertEquals(ran.calls[0].method, "DELETE");
  assertEquals(ran.calls[0].url, `${BASE}/app-management/apps/a%2Fb`);
  assertEquals(JSON.parse(ran.stdout), { removed: 3 });
});

Deno.test("app-management: a 404 unknown_app exits 2 with its code on stderr", async () => {
  const ran = await w6w(
    ["app-management", "get", "nope"],
    () => json(404, { error: { code: "unknown_app", message: "No such app." } }),
  );
  assertEquals(ran.code, 2);
  assertStringIncludes(ran.stderr, "unknown_app");
  assertEquals(ran.stdout, "");
});

Deno.test("app-management: bad arguments are usage errors, exit 1, zero requests", async () => {
  const cases: [string[], string][] = [
    [["app-management", "preview", "{bad", "--target", "account"], "JSON"],
    [["app-management", "preview", '{"a":1', "--target", "account"], "JSON"],
    [["app-management", "preview", "github:a/b"], "--target"],
    [["app-management", "sync", "a", "--expected-revision", "abc"], "--expected-revision"],
    [["app-management", "sync", "a", "--expected-revision", "-1"], "--expected-revision"],
    [["app-management", "update-source", "a", "github:a/b"], "--expected-revision"],
    [["app-management", "list", "--offset", "x"], "--offset"],
    [["app-management", "list", "--limit", "0"], "--limit"],
    [["app-management", "get"], "app id"],
    [["app-management", "list", "stray"], "takes no arguments"],
  ];
  for (const [argv, expected] of cases) {
    const ran = await w6w(argv);
    assertEquals(ran.code, 1, `\`${argv.join(" ")}\` exited ${ran.code}: ${ran.stderr}`);
    assertStringIncludes(ran.stderr, expected);
    assertEquals(ran.calls.length, 0, "a usage error must not reach the server");
  }
});

Deno.test("every `w6w app-management` command in the help tree is registered, and no others", () => {
  const group = HELP_TREE.groups.find((candidate) => candidate.name === "app-management");
  assert(group !== undefined, "the generated help tree has no `app-management` group");
  const documented = group.commands.map((command) => command.path.join(" ")).sort();
  assertEquals(Object.keys(APP_MANAGEMENT_COMMANDS).sort(), documented);
  for (const path of documented) assert(Object.hasOwn(COMMANDS, path), `\`${path}\` is not wired`);
  assertEquals(documented.length, 7);
});

const DISCOVER = {
  registry: "npm",
  q: "hello",
  items: [
    {
      name: "hello-app",
      version: "1.2.0",
      description: null,
      link: "https://www.npmjs.com/package/hello-app",
      ref: "npm:hello-app@^1.2.0",
      installed: false,
    },
    {
      name: "@acme/hello",
      version: "0.3.0",
      description: "Says hello.",
      link: "https://www.npmjs.com/package/@acme/hello",
      ref: "npm:@acme/hello@^0.3.0",
      installed: true,
    },
  ],
};

Deno.test("apps search: npm is the default registry on the wire; --json prints the body", async () => {
  const ran = await w6w(["apps", "search", "hello", "--json"], () => json(200, DISCOVER));
  assertEquals(ran.code, 0, ran.stderr);
  assertEquals(ran.calls.length, 1);
  assertEquals(ran.calls[0].method, "GET");
  assertEquals(ran.calls[0].url, `${BASE}/app-management/discover?registry=npm&q=hello`);
  assertEquals(JSON.parse(ran.stdout), DISCOVER);
});

Deno.test("apps search: --registry jsr --limit 5 are forwarded; the query is encoded", async () => {
  const ran = await w6w(
    ["apps", "search", "hello world", "--registry", "jsr", "--limit", "5", "--json"],
    () => json(200, { ...DISCOVER, registry: "jsr" }),
  );
  assertEquals(ran.code, 0, ran.stderr);
  assertEquals(
    ran.calls[0].url,
    `${BASE}/app-management/discover?registry=jsr&q=hello+world&limit=5`,
  );
});

Deno.test("apps search: the human table lists name, version, ref and installed", async () => {
  const ran = await w6w(["apps", "search", "hello"], () => json(200, DISCOVER));
  assertEquals(ran.code, 0, ran.stderr);
  for (const cell of ["hello-app", "1.2.0", "npm:hello-app@^1.2.0", "@acme/hello", "yes"]) {
    assertStringIncludes(ran.stdout, cell);
  }
  assertStringIncludes(ran.stdout, "INSTALLED");
});

Deno.test("apps search: no hits still exits 0 and says so", async () => {
  const empty = { registry: "npm", q: "zzz", items: [] };
  const ran = await w6w(["apps", "search", "zzz"], () => json(200, empty));
  assertEquals(ran.code, 0, ran.stderr);
  assertStringIncludes(ran.stdout, "No matching apps.");
});

Deno.test("apps search: bad flags are usage errors, exit 1, zero requests", async () => {
  const cases: [string[], string][] = [
    [["apps", "search"], "search query"],
    [["apps", "search", "hello", "--registry", "npmjs"], "--registry"],
    [["apps", "search", "hello", "--limit", "0"], "--limit"],
    [["apps", "search", "hello", "--limit", "abc"], "--limit"],
    [["apps", "search", "hello", "stray"], "extra one"],
  ];
  for (const [argv, expected] of cases) {
    const ran = await w6w(argv);
    assertEquals(ran.code, 1, `\`${argv.join(" ")}\` exited ${ran.code}: ${ran.stderr}`);
    assertStringIncludes(ran.stderr, expected);
    assertEquals(ran.calls.length, 0, "a usage error must not reach the server");
  }
});

Deno.test("apps list is the very handler app-management list is registered as", () => {
  assert(COMMANDS["apps list"] === COMMANDS["app-management list"]);
  assert(COMMANDS["apps list"] === APP_MANAGEMENT_COMMANDS["app-management list"]);
});

Deno.test("apps list prints exactly what app-management list prints for one response", async () => {
  const page = { apps: [{ id: "sg", version: "1.0.0" }], total: 1, offset: 0 };
  const run = async (path: string[]) => {
    const stdout: string[] = [];
    const { createOutput, NO_CONFIG, NO_ENV, NO_STDIN, NO_STORE } = await import("../mod.ts");
    const { W6WClient } = await import("@w6w/sdk");
    const fetch: FetchLike = () => Promise.resolve(json(200, page));
    const out = createOutput({ stdout: (t) => stdout.push(t), stderr: () => {} }, {
      json: true,
      noColor: true,
    });
    // deno-lint-ignore no-explicit-any
    const context: any = {
      command: { naming: path.join(" "), path },
      invocation: {
        command: path,
        positionals: [],
        globals: { json: true, noColor: true, version: false, help: false },
        options: {},
      },
      out,
      client: () => new W6WClient({ baseUrl: BASE, token: "t", fetch }),
      env: NO_ENV,
      stored: NO_CONFIG,
      store: NO_STORE,
      stdin: NO_STDIN,
    };
    await COMMANDS[path.join(" ")](context);
    return stdout.join("\n");
  };
  const viaApps = await run(["apps", "list"]);
  assertEquals(viaApps, await run(["app-management", "list"]));
  assertStringIncludes(viaApps, '"sg"');
});
