/**
 * Requirement 4 — a scaffolded project is a w6w **app**, not just a pile of files.
 *
 * For both `apps init` templates this scaffolds into a temp dir and then drives the CLI's
 * real `apps validate` and `apps build` handlers end to end. Nothing about the builder is
 * faked: the spawn is the real one (`deno run … @w6w/app-build/cli.ts`, through the
 * toolchain seam only to hand it the import map described below), the builder is the lane's
 * own `core/packages/app-build`, and the app's `@w6w/*` imports are served in registry mode
 * by core's `tests/jsr-mirror.ts` — the offline stand-in for the still-unpublished P3
 * packages (A11). The assertion is the user's: a scaffolded app validates, and `apps build`
 * leaves `<out>/<id>/<version>/{app.js,manifest.json}` on disk.
 *
 * One file is written into the temp dir for the builder's **own** graph (never the app's):
 * a `deno.json`-style import map that maps the lane's `@w6w/*` packages to their sources —
 * what core's own `deno.json` does — and the builder's one third-party import,
 * `jsr:@std/path`, to the immutable URL the Deno cache already holds. The mirror serves
 * `@w6w/*` only, so a bare `jsr:` fetch for it would 404 there.
 *
 * Skips — loudly, in the test name and its ignore reason — only when this lane has no
 * `../core` checkout: the one thing the test cannot supply for itself.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import type { CliIo, CommandContext, Invocation } from "../mod.ts";
import { createOutput, EXIT_SUCCESS, NO_CONFIG, NO_ENV, NO_STDIN, NO_STORE } from "../mod.ts";
import { type ToolchainRunner, useToolchainRunner } from "../src/app-toolchain.ts";
import { appsBuild } from "../src/commands/build.ts";
import { INIT_COMMANDS } from "../src/commands/init.ts";
import { VALIDATE_COMMANDS } from "../src/commands/validate.ts";

/** The lane root, two levels above `wrappers/cli` — `<lane>/core` is the sibling checkout. */
const LANE = decodeURIComponent(new URL("../../../", import.meta.url).pathname);
const CORE_PACKAGES = `${LANE}core/packages`;
/** The canonical builder, as `--builder` names it: the lane's own source, not a published spec. */
const BUILDER = `${CORE_PACKAGES}/app-build/cli.ts`;
/** A11's offline JSR stand-in: it serves the lane's `@w6w/*` packages on a loopback port. */
const MIRROR = `${CORE_PACKAGES}/app-build/tests/jsr-mirror.ts`;
/** Both templates' `package.json` version, and therefore the artifact's directory. */
const VERSION = "0.1.0";

/** The slice of a running `jsr-mirror.ts` this test uses. */
interface Mirror {
  url: string;
  close(): Promise<void>;
}

/** `path` as a `file:` URL, for the import map's core sources. */
function fileUrl(path: string): string {
  return new URL(`file://${path}`).href;
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await Deno.stat(path)).isFile;
  } catch {
    return false;
  }
}

/** Whether this lane carries the `core` checkout the canonical builder lives in. */
async function hasCore(): Promise<boolean> {
  for (const path of [BUILDER, MIRROR, `${CORE_PACKAGES}/types/deno.json`]) {
    if (!(await isFile(path))) return false;
  }
  return true;
}

const CORE_PRESENT = await hasCore();
const NO_CORE = "SKIPPED — this lane has no ../core checkout, so the canonical @w6w/app-build " +
  "builder and its jsr-mirror are not here to run; re-run this test in a lane with core";
if (!CORE_PRESENT) console.warn(NO_CORE);

/** Stage the lane's JSR mirror; it serves `@w6w/*` offline unless told otherwise. */
async function startMirror(): Promise<Mirror> {
  // Imported by path and off the type checker's graph: a `wrappers` checkout without
  // `core` has no such module, and this test must skip there, not fail to type-check.
  const mod = await import(MIRROR) as { startMirror(): Promise<Mirror> };
  return await mod.startMirror();
}

/** `deno info --json` for one specifier — what the cache resolves it to. */
interface DenoInfo {
  redirects?: Record<string, string>;
}

/**
 * Write the import map the builder process resolves its **own** imports through, and
 * return its path.
 *
 * Two halves, both of them the truth about how the lane builds today:
 *
 * - `@w6w/*` → the lane's package sources, exactly as `core/packages/app-build/deno.json`
 *   maps them (the builder is unbuilt source here, not a published package);
 * - the builder's `jsr:@std/path` specifiers → the immutable `https://jsr.io/@std/path/…`
 *   URLs the cache already holds, because `JSR_URL` is the mirror, which carries no `@std`.
 */
async function writeBuilderMap(dir: string): Promise<string> {
  const info = await new Deno.Command(Deno.execPath(), {
    // `dir` carries no `deno.json`, so the answer is the cache's, not this repo's config.
    args: ["info", "--json", "--no-lock", "jsr:@std/path@^1.0.0"],
    cwd: dir,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
  assertEquals(info.code, 0, `\`deno info jsr:@std/path\` failed: ${decode(info.stderr)}`);
  const imports: Record<string, string> = {};
  for (
    const [from, to] of Object.entries(
      (JSON.parse(decode(info.stdout)) as DenoInfo).redirects ?? {},
    )
  ) {
    if (from.startsWith("jsr:")) imports[from] = to;
  }
  assertStringIncludes(
    Object.keys(imports).join(" "),
    "jsr:@std/path@^1.0.0",
    "the Deno cache resolved no jsr:@std/path for the builder's import map",
  );
  for (const name of ["types", "runtime", "validator"]) {
    imports[`@w6w/${name}`] = fileUrl(`${CORE_PACKAGES}/${name}/mod.ts`);
  }
  const path = `${dir}/builder-map.json`;
  await Deno.writeTextFile(path, JSON.stringify({ imports }, null, 2) + "\n");
  return path;
}

/**
 * The real toolchain runner: `deno` spawned exactly as `apps validate|build` spawn it, with
 * the builder pointed at {@linkcode writeBuilderMap}'s map and at the mirror through
 * `JSR_URL`. `W6W_APP_BUILD_REEXEC=1` says the `--unstable-worker-options` flag is already
 * there (it is: {@linkcode builderArgs} adds it), so the builder does not re-exec itself and
 * drop both.
 */
function realRunner(options: { map: string; jsrUrl: string }): ToolchainRunner {
  return async (argv, cwd) => {
    const args = [...argv];
    // The seam's own assumptions, asserted rather than trusted: the spawn names the lane's
    // builder, and the builder is already told to allow worker options (which is the only
    // reason the re-exec marker above may be set).
    assertStringIncludes(args.join(" "), BUILDER);
    assertStringIncludes(args.join(" "), "--unstable-worker-options");
    const at = args.indexOf("--config");
    if (at === -1) throw new Error(`the builder argv names no --config: ${args.join(" ")}`);
    args[at + 1] = options.map;
    const result = await new Deno.Command(Deno.execPath(), {
      args,
      cwd,
      env: { JSR_URL: options.jsrUrl, W6W_APP_BUILD_REEXEC: "1" },
      stdout: "piped",
      stderr: "piped",
    }).output();
    return {
      code: result.code,
      stdout: new TextDecoder().decode(result.stdout),
      stderr: new TextDecoder().decode(result.stderr),
    };
  };
}

/** The `apps init` / `apps validate` / `apps build` context, the renderer included. */
function context(
  command: string,
  positionals: string[],
  options: Record<string, string>,
): { context: CommandContext; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const io: CliIo = {
    stdout: (text) => stdout.push(text),
    stderr: (text) => stderr.push(text),
  };
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
    stderr,
  };
}

for (const template of ["deno", "node"] as const) {
  Deno.test({
    name: CORE_PRESENT
      ? `apps init ${template}: the scaffold validates and builds with the real builder`
      : `apps init ${template}: ${NO_CORE}`,
    ignore: !CORE_PRESENT,
    fn: async () => {
      const id = `com.example.${template}-app`;
      const root = await Deno.makeTempDir({ prefix: `w6w-scaffold-${template}-` });
      const mirror = await startMirror();
      const appDir = `${root}/app`;
      const out = `${root}/out`;
      try {
        await INIT_COMMANDS["apps init"](
          context("apps init", [id], { template, dir: appDir }).context,
        );
        const restore = useToolchainRunner(
          realRunner({ map: await writeBuilderMap(root), jsrUrl: mirror.url }),
        );
        try {
          // `apps validate` — the builder's own answer, in registry mode, off the mirror.
          const validate = context("apps validate", [appDir], {
            builder: BUILDER,
            resolution: "registry",
          });
          assertEquals(
            await VALIDATE_COMMANDS["apps validate"](validate.context),
            EXIT_SUCCESS,
            `apps validate refused the ${template} scaffold: ${validate.stdout.join("")}`,
          );
          assertEquals(JSON.parse(validate.stdout.join("")), { ok: true, id, version: VERSION });

          // `apps build` — the artifact a publisher would upload.
          const build = context("apps build", [appDir], {
            builder: BUILDER,
            out,
            resolution: "registry",
          });
          assertEquals(
            await appsBuild(build.context),
            EXIT_SUCCESS,
            `apps build failed on the ${template} scaffold: ${build.stderr.join("")}`,
          );
          const artifact = `${out}/${id}/${VERSION}`;
          const js = await Deno.stat(`${artifact}/app.js`);
          assertEquals(js.isFile && js.size > 0, true, `${artifact}/app.js is missing or empty`);
          const manifest = JSON.parse(await Deno.readTextFile(`${artifact}/manifest.json`));
          assertEquals(manifest.id, id);
          assertEquals(manifest.version, VERSION);
          // Requirement 1: the icon `init` ships is the one the built manifest carries —
          // inlined as a `data:` URL by the builder, decoded here back to svg.
          const icon = manifest.manifest.appearance.icon.url as string;
          assertStringIncludes(icon, "data:image/svg+xml;base64,");
          assertStringIncludes(atob(icon.slice(icon.indexOf(",") + 1)), "<svg");
        } finally {
          restore();
        }
      } finally {
        await mirror.close();
        await Deno.remove(root, { recursive: true }).catch(() => {});
      }
    },
  });
}
