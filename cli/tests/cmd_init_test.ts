/**
 * `w6w apps init <id> [--template node] [--dir <path>]` — scaffolds into a temp dir.
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
import { TEMPLATE_BUILD, TEMPLATE_DEV_DEPENDENCIES } from "../src/app-templates.ts";
import { INIT_COMMANDS, suggestId } from "../src/commands/init.ts";

const NAMING = "w6w apps init <id> [--template node] [--dir <path>]";

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
  "tsconfig.json",
  ".gitignore",
  "assets/icon.svg",
  "src/index.ts",
  "src/lib/types.ts",
  "src/lib/poll.ts",
  "src/auth/api-key.ts",
  "src/actions/ping.ts",
  "src/triggers/new-item.ts",
  "src/health/service.ts",
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

for (const options of [{}, { template: "node" }] as Record<string, string>[]) {
  Deno.test(`apps init writes the Node template (${JSON.stringify(options)})`, async () => {
    const root = await Deno.makeTempDir({ prefix: "w6w-init-" });
    try {
      const target = `${root}/${APP}`;
      await INIT_COMMANDS["apps init"](context([APP], { ...options, dir: target }));
      assertEquals(await walk(target), [...FILES].sort());
      for (const f of FILES) {
        const text = await Deno.readTextFile(`${target}/${f}`);
        assertEquals(text.includes("__ID__"), false, f);
        // Node and npm only: nothing scaffolded mentions Deno, JSR or the unpublished kit.
        for (const banned of ["deno", "jsr:", "@w6w/app-kit", "@w6w/types"]) {
          assertEquals(text.toLowerCase().includes(banned), false, `${f} mentions ${banned}`);
        }
      }
      const pkg = JSON.parse(await Deno.readTextFile(`${target}/package.json`));
      assertEquals(pkg.w6w.id, APP);
      assertEquals(pkg.w6w.entry, "./dist/app.js");
      // The manifest the assembler validates has an author and a bundled icon.
      assertEquals(pkg.author?.name, APP);
      assertEquals(pkg.w6w.appearance, { icon: { url: "assets/icon.svg" } });
      assertStringIncludes(await Deno.readTextFile(`${target}/assets/icon.svg`), "<svg");
      // The developer's own toolchain: esbuild bundles to dist/app.js with a source map.
      assertEquals(pkg.devDependencies, TEMPLATE_DEV_DEPENDENCIES);
      assertEquals(pkg.dependencies, undefined);
      assertEquals(pkg.scripts.build, TEMPLATE_BUILD);
      assertStringIncludes(pkg.scripts.build, "--outfile=dist/app.js");
      assertStringIncludes(pkg.scripts.build, "--sourcemap");
      assertStringIncludes(pkg.scripts.build, "--bundle");
      assertStringIncludes(pkg.scripts.test, "node --test");
      assertEquals(pkg.scripts.validate, "w6w apps validate");
      assertStringIncludes(pkg.scripts.package, "w6w apps build");
      const workflow = await Deno.readTextFile(`${target}/.github/workflows/w6w.yml`);
      for (const step of ["npm ci", "npm run build", "npm test", "npm run validate"]) {
        assertStringIncludes(workflow, step);
      }
      assertStringIncludes(await Deno.readTextFile(`${target}/README.md`), "Node.js");
      // The poll helper is the app's own, not an import from an unpublished package.
      assertStringIncludes(
        await Deno.readTextFile(`${target}/src/triggers/new-item.ts`),
        'from "../lib/poll.ts"',
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
  const error = await assertRejects(
    async () => {
      await INIT_COMMANDS["apps init"](context([APP], { template: "go" }));
    },
    Error,
    "--template",
  );
  assertEquals(exitCodeFor(error), EXIT_USAGE);
});

Deno.test("apps init --template deno says the template was removed, and writes nothing", async () => {
  const root = await Deno.makeTempDir({ prefix: "w6w-init-" });
  try {
    const error = await assertRejects(
      async () => {
        await INIT_COMMANDS["apps init"](
          context([APP], { template: "deno", dir: `${root}/${APP}` }),
        );
      },
      Error,
    );
    assertStringIncludes(error.message, "`deno` template was removed");
    assertStringIncludes(error.message, NAMING);
    assertEquals(exitCodeFor(error), EXIT_USAGE);
    assertEquals(await walk(root), []);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
