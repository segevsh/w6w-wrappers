/**
 * `w6w apps init <id> [--template deno|node] [--dir <path>]` — scaffolds into a temp dir.
 */

import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import type { CliIo, CommandContext, Invocation } from "../mod.ts";
import {
  createOutput,
  EXIT_USAGE,
  exitCodeFor,
  NO_CONFIG,
  NO_ENV,
  NO_STDIN,
  NO_STORE,
} from "../mod.ts";
import { TEMPLATE_IMPORTS } from "../src/app-templates.ts";
import { INIT_COMMANDS, suggestId } from "../src/commands/init.ts";

const NAMING = "w6w apps init <id> [--template deno|node] [--dir <path>]";

/** A scaffolding id the canonical builder accepts: dotted reverse-DNS. */
const APP = "com.example.demo-app";

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
  "assets/icon.svg",
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
      const target = `${root}/${APP}`;
      await INIT_COMMANDS["apps init"](context([APP], { template, dir: target }));
      assertEquals(await walk(target), [...FILES].sort());
      const deno = JSON.parse(await Deno.readTextFile(`${target}/deno.json`));
      assertEquals(deno.imports, TEMPLATE_IMPORTS);
      for (const f of FILES) {
        const text = await Deno.readTextFile(`${target}/${f}`);
        assertEquals(text.includes("__ID__"), false, f);
      }
      const pkg = JSON.parse(await Deno.readTextFile(`${target}/package.json`));
      assertEquals(pkg.w6w.id, APP);
      // Requirement 1: the manifest the builder validates has an author and a bundled icon.
      assertEquals(pkg.author?.name, APP);
      assertEquals(pkg.w6w.appearance, { icon: { url: "assets/icon.svg" } });
      assertStringIncludes(await Deno.readTextFile(`${target}/assets/icon.svg`), "<svg");
      assertStringIncludes(await Deno.readTextFile(`${target}/README.md`), "Deno");
      assertStringIncludes(
        await Deno.readTextFile(`${target}/.github/workflows/w6w.yml`),
        "apps validate",
      );
      if (template === "deno") {
        // Requirement 3: every step of the README loop is a real `deno task`.
        assertEquals(deno.tasks.test, "deno test -A tests/");
        assertEquals(deno.tasks.validate, "w6w apps validate");
        assertEquals(deno.tasks.build, "w6w apps build");
      }
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
        await INIT_COMMANDS["apps init"](context([APP], { dir: root }));
      },
      Error,
      "not empty",
    );
    assertEquals(await walk(root), ["keep.txt"]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("apps init rejects a non-dotted id: usage exit, the rule, a suggestion, nothing written", async () => {
  const root = await Deno.makeTempDir({ prefix: "w6w-init-" });
  try {
    for (const id of ["demo-app", "Demo.App", "a_b", "1a", "com..example", "com.example."]) {
      const error = await assertRejects(
        async () => {
          await INIT_COMMANDS["apps init"](context([id], { dir: `${root}/${id}` }));
        },
        Error,
      );
      // Requirement 2: the message carries the builder's rule and a suggested id.
      assertStringIncludes(error.message, "reverse-DNS");
      assertStringIncludes(error.message, "com.example.");
      assertStringIncludes(error.message, NAMING);
      assertEquals(exitCodeFor(error), EXIT_USAGE);
      // No silent rewriting: a rejected id creates nothing.
      assertEquals(await walk(root), [], id);
    }
    // The suggestion folds the rejected id into a dotted reverse-DNS spelling.
    assertEquals(suggestId("demo-app"), "com.example.demo-app");
    assertEquals(suggestId("My_App"), "com.example.my-app");
    assertEquals(suggestId("-"), "com.example.my-app");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("apps init rejects a bad template as a usage error", async () => {
  await assertRejects(
    async () => {
      await INIT_COMMANDS["apps init"](context([APP], { template: "go" }));
    },
    Error,
    "--template",
  );
});
