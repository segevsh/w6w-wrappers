/**
 * A scaffolded project is a w6w **app**, not just a pile of files.
 *
 * `apps init` scaffolds into a temp dir; the app is then built exactly as its own
 * `npm run build` builds it (the template's esbuild command, run with the esbuild this
 * package already has as a devDependency — no network), its `node:test` suite runs under
 * Node, and the CLI's real `apps validate` / `apps build` handlers package it through the
 * vendored assembler — nothing faked. The assertions are the developer's: the tests pass,
 * the app validates, and `apps build` leaves `<out>/<id>/<version>/{app.js,manifest.json,
 * app.js.map}` on disk, the map only when the build made one.
 *
 * Skips — loudly, in the test name — when `npm install` has not run here (no esbuild) or
 * the vendored assembler is still the placeholder (`npm run vendor:assemble` not run).
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import type { CliIo, CommandContext, Invocation } from "../mod.ts";
import { createOutput, EXIT_SUCCESS, NO_CONFIG, NO_ENV, NO_STDIN, NO_STORE } from "../mod.ts";
import { TEMPLATE_BUILD } from "../src/app-templates.ts";
import { appsBuild } from "../src/commands/build.ts";
import { INIT_COMMANDS } from "../src/commands/init.ts";
import { VALIDATE_COMMANDS } from "../src/commands/validate.ts";

const ESBUILD = decodeURIComponent(
  new URL("../node_modules/.bin/esbuild", import.meta.url).pathname,
);
const VENDORED = new URL("../src/vendor/app-assemble.js", import.meta.url);
const VERSION = "0.1.0";

async function exists(path: string | URL): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

const HAS_ESBUILD = await exists(ESBUILD);
const HAS_ASSEMBLER = await exists(VENDORED) &&
  !(await Deno.readTextFile(VENDORED)).includes("PLACEHOLDER");
const SKIP = !HAS_ESBUILD
  ? "SKIPPED — no node_modules/.bin/esbuild; run `npm install` in cli/ first"
  : !HAS_ASSEMBLER
  ? "SKIPPED — src/vendor/app-assemble.js is the placeholder; run `npm run vendor:assemble`"
  : undefined;
if (SKIP) console.warn(SKIP);

/** Run a command to completion in `cwd`, failing the test with its output on a nonzero exit. */
async function run(cmd: string, args: string[], cwd: string): Promise<string> {
  const result = await new Deno.Command(cmd, { args, cwd, stdout: "piped", stderr: "piped" })
    .output();
  const text = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
  assertEquals(result.code, 0, `${cmd} ${args.join(" ")} failed:\n${text}`);
  return text;
}

/** The `apps init` / `apps validate` / `apps build` context, the renderer included. */
function context(
  command: string,
  positionals: string[],
  options: Record<string, string>,
): { context: CommandContext; stdout: string[] } {
  const stdout: string[] = [];
  const io: CliIo = { stdout: (text) => stdout.push(text), stderr: () => {} };
  const invocation: Invocation = {
    command: command.split(" "),
    positionals,
    globals: { json: true, noColor: true, version: false, help: false },
    options,
  };
  return {
    context: {
      command: {
        operation: command.replaceAll(" ", "."),
        path: command.split(" "),
        name: command,
        aliases: [],
        summary: "Local app scaffolding/build.",
        short: "Local app scaffolding/build.",
        headline: "Local app scaffolding/build.",
        usage: `w6w ${command}`,
        naming: `w6w ${command}`,
        status: "live",
        params: [],
        examples: [],
        notes: [],
      },
      invocation,
      out: createOutput(io, { json: true, noColor: true }),
      client: () => {
        throw new Error("scaffolding, validating and building never reach the API.");
      },
      env: NO_ENV,
      stored: NO_CONFIG,
      store: NO_STORE,
      stdin: NO_STDIN,
    } as CommandContext,
    stdout,
  };
}

for (const sourcemap of [true, false]) {
  const label = sourcemap ? "with a source map" : "without a source map";
  Deno.test({
    name: SKIP
      ? `apps init: the scaffold builds, tests and packages (${label}) — ${SKIP}`
      : `apps init: the scaffold builds, tests and packages (${label})`,
    ignore: SKIP !== undefined,
    fn: async () => {
      const id = "com.example.scaffold-app";
      const root = await Deno.makeTempDir({ prefix: "w6w-scaffold-" });
      const appDir = `${root}/app`;
      const out = `${root}/out`;
      try {
        await INIT_COMMANDS["apps init"](context("apps init", [id], { dir: appDir }).context);

        // The developer's own build, as `npm run build` runs it.
        const args = TEMPLATE_BUILD.split(" ").slice(1)
          .filter((arg) => sourcemap || arg !== "--sourcemap");
        await run(ESBUILD, args, appDir);
        assertEquals(await exists(`${appDir}/dist/app.js.map`), sourcemap);

        // The scaffold's own tests, as `npm test` runs them.
        const pkg = JSON.parse(await Deno.readTextFile(`${appDir}/package.json`));
        const testArgs = (pkg.scripts.test as string).split(" ").slice(1)
          .map((arg) => arg.replaceAll('"', ""));
        assertStringIncludes(await run("node", testArgs, appDir), "pass 4");

        const validate = context("apps validate", [appDir], {});
        assertEquals(
          await VALIDATE_COMMANDS["apps validate"](validate.context),
          EXIT_SUCCESS,
          `apps validate refused the scaffold: ${validate.stdout.join("")}`,
        );
        assertEquals(JSON.parse(validate.stdout.join("")), { ok: true, id, version: VERSION });

        const build = context("apps build", [appDir], { out });
        assertEquals(await appsBuild(build.context), EXIT_SUCCESS);
        assertEquals(JSON.parse(build.stdout.join("")).id, id);
        const artifact = `${out}/${id}/${VERSION}`;
        assert((await Deno.stat(`${artifact}/app.js`)).size > 0);
        assertEquals(await exists(`${artifact}/app.js.map`), sourcemap);
        const manifest = JSON.parse(await Deno.readTextFile(`${artifact}/manifest.json`));
        assertEquals(manifest.id, id);
        assertEquals(manifest.version, VERSION);
        assertEquals(manifest.map !== undefined, sourcemap);
        // The icon `init` ships is the one the manifest carries, inlined as a data: URL.
        const icon = manifest.manifest.appearance.icon.url as string;
        assertStringIncludes(icon, "data:image/svg+xml;base64,");
        assertStringIncludes(atob(icon.slice(icon.indexOf(",") + 1)), "<svg");
        assertEquals(
          JSON.parse(await Deno.readTextFile(`${out}/index.json`)).apps[0].id,
          id,
        );
      } finally {
        await Deno.remove(root, { recursive: true }).catch(() => {});
      }
    },
  });
}
