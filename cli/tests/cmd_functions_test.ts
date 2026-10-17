/**
 * `w6w functions update --if-unmodified-since`, driven through the dispatcher
 * against a stub fetch that records the OUTGOING headers (the shared harness in
 * `cmd_versions_test.ts` records method/url/body only).
 */

import { assertEquals } from "@std/assert";
import type { FetchLike } from "@w6w/sdk";
import { main } from "../mod.ts";
import type { EnvReader } from "../mod.ts";
import { COMMANDS } from "../src/commands/index.ts";

const ENV: EnvReader = (name) =>
  ({ W6W_BASE_URL: "https://api.example.test", W6W_TOKEN: "t_cli" })[name];
const H = "x-w6w-if-unmodified-since";
const TOKEN = "2026-10-17T01:00:00.000Z";
const DEFINITION = JSON.stringify({ key: "send-email", inputs: [] });

async function w6w(argv: string[]) {
  const sent: Array<{ header: string | null; body: unknown }> = [];
  const stdout: string[] = [];
  const fetch: FetchLike = (_url, init) => {
    sent.push({
      header: new Headers(init?.headers).get(H),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    return Promise.resolve(
      new Response(
        JSON.stringify({ function: { id: "fn_1", key: "send-email" }, updatedAt: TOKEN }),
        { status: 201, headers: { "content-type": "application/json" } },
      ),
    );
  };
  const code = await main(argv, { stdout: (t) => stdout.push(t), stderr: () => {} }, {
    env: ENV,
    fetch,
    commands: COMMANDS,
  });
  return { code, sent, stdout: stdout.join("\n") };
}

Deno.test("functions update sends the precondition header only when --if-unmodified-since is given", async () => {
  const without = await w6w(["functions", "update", "fn_1", "--definition", DEFINITION]);
  assertEquals(without.code, 0);
  assertEquals(without.sent[0].header, null);

  const withFlag = await w6w([
    "functions",
    "update",
    "fn_1",
    "--definition",
    DEFINITION,
    "--if-unmodified-since",
    TOKEN,
  ]);
  assertEquals(withFlag.code, 0);
  assertEquals(withFlag.sent[0].header, TOKEN);
  assertEquals((withFlag.sent[0].body as { id: string }).id, "fn_1");
});

Deno.test("functions update --json emits the save result with its updatedAt", async () => {
  const r = await w6w(["functions", "update", "fn_1", "--definition", DEFINITION, "--json"]);
  assertEquals(JSON.parse(r.stdout), { id: "fn_1", key: "send-email", updatedAt: TOKEN });
});
