/**
 * `w6w apps init <id> [--template deno|node] [--dir <path>]` — scaffolds into a temp dir.
 */

import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import type { CliIo, CommandContext, Invocation } from "../mod.ts";
import { createOutput, NO_CONFIG, NO_ENV, NO_STDIN, NO_STORE } from "../mod.ts";
import { TEMPLATE_IMPORTS } from "../src/app-templates.ts";
import { INIT_COMMANDS } from "../src/commands/init.ts";

const NAMING = "w6w apps init <id> [--template deno|node] [--dir <path>]";

function context(positionals: string[], options: Record<string, string>): CommandContext {
  const io: CliIo = { stdout: () => {}, stderr: () => {} };
  const invocation: Invocation = {
    command: ["apps", "init"],
    positionals,
    globals: { json: false, noColor: true, version: false, help: false },
    options,
  };
  return {
    command: {
      operation: "apps.init",
      path: ["apps", "init"],
      name: "apps init",
      aliases: [],
      summary: "Scaffold an app.",
      short: "Scaffold an app.",
      headline: "Scaffold an app.",
      usage: "w6w apps init <id>",
      naming: NAMING,
      status: "live",
      params: [],
      examples: [],
      notes: [],
    },
    invocation,
    out: createOutput(io, { json: false, noColor: true }),
    client: () => {
      throw new Error("`apps init` never reaches the API.");
    },
    env: NO_ENV,
    stored: NO_CONFIG,
    store: NO_STORE,
    stdin: NO_STDIN,
  } as CommandContext;
}

const FILES = [
  "package.json",
  "deno.json",
  "index.ts",
  "auth/api-key.ts",
  "actions/ping.ts",
  "triggers/new-item.ts",
  "health/service.ts",
  "tests/app.test.ts",
  ".github/workflows/w6w.yml",
  "README.md",
];

async function walk(dir: string, base = ""): Promise<string[]> {
  const found: string[] = [];
  for await (const e of Deno.readDir(dir)) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory) found.push(...await walk(`${dir}/${e.name}`, rel));
    else found.push(rel);
  }
  return found.sort();
}

for (const template of ["deno", "node"]) {
  Deno.test(`apps init writes the ${template} template with P3 imports`, async () => {
    const root = await Deno.makeTempDir({ prefix: "w6w-init-" });
    try {
      const target = `${root}/demo-app`;
      await INIT_COMMANDS["apps init"](context(["demo-app"], { template, dir: target }));
      assertEquals(await walk(target), [...FILES].sort());
      const deno = JSON.parse(await Deno.readTextFile(`${target}/deno.json`));
      assertEquals(deno.imports, TEMPLATE_IMPORTS);
      for (const f of FILES) {
        const text = await Deno.readTextFile(`${target}/${f}`);
        assertEquals(text.includes("__ID__"), false, f);
      }
      const pkg = JSON.parse(await Deno.readTextFile(`${target}/package.json`));
      assertEquals(pkg.w6w.id, "demo-app");
      assertStringIncludes(await Deno.readTextFile(`${target}/README.md`), "Deno");
      assertStringIncludes(
        await Deno.readTextFile(`${target}/.github/workflows/w6w.yml`),
        "apps validate",
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });
}

Deno.test("apps init refuses a non-empty directory and writes nothing", async () => {
  const root = await Deno.makeTempDir({ prefix: "w6w-init-" });
  try {
    await Deno.writeTextFile(`${root}/keep.txt`, "x");
    await assertRejects(
      async () => {
        await INIT_COMMANDS["apps init"](context(["demo-app"], { dir: root }));
      },
      Error,
      "not empty",
    );
    assertEquals(await walk(root), ["keep.txt"]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("apps init rejects a bad id and a bad template as usage errors", async () => {
  for (const id of ["Demo", "-x", "a--b", "a_b", "1a"]) {
    await assertRejects(
      async () => {
        await INIT_COMMANDS["apps init"](context([id], { dir: "/nonexistent/never" }));
      },
      Error,
      NAMING,
    );
  }
  await assertRejects(
    async () => {
      await INIT_COMMANDS["apps init"](context(["demo"], { template: "go" }));
    },
    Error,
    "--template",
  );
});
