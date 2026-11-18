// Vendors core's app assembler into the CLI: bundles
// `../../core/packages/app-build/assemble.ts` (relative to cli/) and everything it imports
// into ONE Node ESM file, `src/vendor/app-assemble.js`, which is committed.
//
// Why vendored: the wrappers repo is self-contained (its CI has no core checkout) and the
// published CLI must run on Node alone — no Deno, no JSR, no network. The packaging logic
// stays single-sourced in core; this script is how a core change reaches the CLI:
//
//   cd cli && npm run vendor:assemble   # needs a sibling ../../core checkout
//
// `@w6w/*` bare specifiers resolve exactly as Deno resolves them in core: the importing
// package's `deno.json` `imports` first, then core's root `deno.json`, then the named
// package's own `deno.json` `exports`. `node:*` stays external. Anything else that is not a
// relative path — `jsr:`, `npm:`, `https:`, a bare npm name — fails the script, as does a
// bundle that loads a module next to itself by `import.meta.url` (the vendored file is alone
// in dist; nothing sits beside it). Core also runs under Deno, so guarded `globalThis.Deno`
// probes are fine; the proof that nothing UNguarded is left is a smoke import of the written
// file in a plain Node process, which must expose both functions.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CORE = resolve(CLI, "../../core");
const ENTRY = join(CORE, "packages/app-build/assemble.ts");
const OUT = join(CLI, "src/vendor/app-assemble.js");

function fail(message) {
  console.error(`vendor:assemble: ${message}`);
  process.exit(1);
}

if (!existsSync(ENTRY)) fail(`no ${ENTRY} — this needs a core checkout beside the wrappers repo`);

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

/** The nearest `deno.json` at or above `dir`, inside core. */
function nearestConfig(dir) {
  for (let at = dir; at.startsWith(CORE); at = dirname(at)) {
    const candidate = join(at, "deno.json");
    if (existsSync(candidate)) return candidate;
    if (at === dirname(at)) break;
  }
  return undefined;
}

/** `spec` through one import map (exact key, then the longest `prefix/` key). */
function mapThrough(imports, spec, base) {
  if (!imports) return undefined;
  if (typeof imports[spec] === "string") return { target: imports[spec], base };
  const prefix = Object.keys(imports)
    .filter((key) => key.endsWith("/") && spec.startsWith(key))
    .sort((a, b) => b.length - a.length)[0];
  return prefix ? { target: imports[prefix] + spec.slice(prefix.length), base } : undefined;
}

/** `@w6w/<pkg>[/<sub>]` through that package's own `exports`. */
function viaExports(spec) {
  const [, pkg, sub] = /^@w6w\/([^/]+)(?:\/(.+))?$/.exec(spec) ?? [];
  if (!pkg) return undefined;
  const config = join(CORE, "packages", pkg, "deno.json");
  if (!existsSync(config)) return undefined;
  const { exports } = readJson(config);
  const key = sub ? `./${sub}` : ".";
  const target = typeof exports === "string" ? (sub ? undefined : exports) : exports?.[key];
  return target ? { target, base: dirname(config) } : undefined;
}

function resolveBare(spec, importer) {
  const local = nearestConfig(dirname(importer));
  const hit = (local && mapThrough(readJson(local).imports, spec, dirname(local))) ??
    mapThrough(readJson(join(CORE, "deno.json")).imports, spec, CORE) ??
    viaExports(spec);
  if (!hit) return undefined;
  if (/^(jsr|npm|https?):/.test(hit.target)) {
    fail(`\`${spec}\` (from ${importer}) maps to \`${hit.target}\`; the CLI must not need it`);
  }
  return resolve(hit.base, hit.target);
}

const corePlugin = {
  name: "w6w-core",
  setup(build) {
    build.onResolve({ filter: /^node:/ }, (args) => ({ path: args.path, external: true }));
    build.onResolve(
      { filter: /^(jsr|npm|https?|data|file):/ },
      (args) =>
        fail(`\`${args.path}\` imported by ${args.importer}: only @w6w/* and node:* are allowed`),
    );
    build.onResolve({ filter: /^[^./]/ }, (args) => {
      const path = args.path.startsWith("@w6w/") ? resolveBare(args.path, args.importer) : null;
      if (!path) {
        fail(`bare \`${args.path}\` imported by ${args.importer} does not resolve inside core`);
      }
      return { path };
    });
  },
};

const result = await esbuild.build({
  entryPoints: [ENTRY],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  write: false,
  legalComments: "none",
  logLevel: "warning",
  plugins: [corePlugin],
});
const code = result.outputFiles[0].text;

if (/new\s+URL\(\s*["'`][^"'`]+["'`]\s*,\s*import\.meta\.url\s*\)/.test(code)) {
  fail("the bundle loads a file beside itself by import.meta.url; inline it instead");
}

const git = (...args) => execFileSync("git", ["-C", CORE, ...args], { encoding: "utf8" }).trim();
const commit = git("rev-parse", "HEAD");
const dirty = git("status", "--porcelain", "--", "packages") === ""
  ? ""
  : " (with uncommitted changes)";

const header = `// generated — do not edit. Run \`npm run vendor:assemble\` in cli/ to refresh.
// Vendored from w6w-core ${commit}${dirty}: packages/app-build/assemble.ts,
// bundled by cli/scripts/vendor-app-assemble.mjs with esbuild ${esbuild.version}.
`;
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, header + code);
const smoke = `import(${JSON.stringify(new URL(`file://${OUT}`).href)}).then((m) => {
  for (const name of ["assembleApp", "validateAssembled", "BuildError"]) {
    if (typeof m[name] !== "function") throw new Error(name + " is not exported");
  }
})`;
try {
  execFileSync(process.execPath, ["--input-type=module", "-e", smoke], { stdio: "pipe" });
} catch (error) {
  fail(`the bundle does not load under plain Node:\n${String(error.stderr ?? error)}`);
}

console.log(
  `vendor:assemble: wrote ${OUT} (${(code.length / 1024).toFixed(1)} KiB, core ${
    commit.slice(0, 12)
  }${dirty})`,
);
