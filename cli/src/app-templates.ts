/**
 * The bundled `apps init` template (string constants, no network).
 *
 * One app: an `apiKey` auth, a `ping` action, a `new-item` poll trigger and a `service`
 * health check, written in TypeScript under `src/`. The project needs **Node and npm
 * only**: the developer's own build (esbuild, a devDependency of the scaffolded app — any
 * bundler would do) turns `src/index.ts` into one self-contained ESM file,
 * `dist/app.js`, plus its source map `dist/app.js.map`; `package.json` names that file
 * as `w6w.entry`, and `w6w apps validate|build|publish` package it. Tests run on
 * `node:test`.
 *
 * Nothing it imports must come from outside npm: the poll helper lives in the app's own
 * `src/lib/poll.ts`, and the definition types it uses are declared in `src/lib/types.ts`.
 *
 * Every `__ID__` in a template body is replaced with the app id.
 *
 * @module
 */

/** The scaffold variants. Only `node` remains; `--template` still accepts it by name. */
export type TemplateName = "node";

/** The default and only template. */
export const DEFAULT_TEMPLATE: TemplateName = "node";

/**
 * The app-id grammar `apps init` accepts: the canonical builder's `ID_RE`
 * (`core/packages/app-build`), restated here so the CLI refuses a non-buildable id at
 * scaffold time instead of letting `apps validate` do it later.
 */
export const APP_ID = /^[a-z0-9]+(\.[a-z0-9-]+)+$/;

/** The scaffolded app's devDependencies — the developer's own toolchain, all on npm. */
export const TEMPLATE_DEV_DEPENDENCIES: Record<string, string> = {
  "@types/node": "^24.19.2",
  esbuild: "^0.28.2",
  typescript: "^5.9.3",
};

/** What `npm run build` runs: bundle `src/index.ts` into `dist/app.js` + `dist/app.js.map`. */
export const TEMPLATE_BUILD =
  "esbuild src/index.ts --bundle --format=esm --platform=neutral --target=es2022 " +
  "--sourcemap --outfile=dist/app.js";

/** The bundled app icon (`assets/icon.svg`), inlined into the packaged manifest. */
const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
     stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="9"/>
  <path d="M3.5 12h17"/>
  <path d="M12 3.5c2.5 2.4 3.9 5.4 3.9 8.5s-1.4 6.1-3.9 8.5c-2.5-2.4-3.9-5.4-3.9-8.5s1.4-6.1 3.9-8.5z"/>
</svg>
`;

const TYPES = `/**
 * The slice of the w6w app model this app uses. A bundled app ships no type
 * imports, so these are plain local declarations: widen them as the app grows.
 */

/** What every hook receives from the host. */
export interface HookContext {
  /** Network access, mediated by the host (egress allowlist + signing). */
  fetch: typeof fetch;
  /** Structured logging routed back to the host. */
  log?: (level: "debug" | "info" | "warn" | "error", message: string, data?: unknown) => void;
}

/** One input field of an action or trigger. */
export interface Param {
  key: string;
  label: string;
  type: "string" | "number" | "boolean" | "secret" | "json";
  required?: boolean;
  description?: string;
}

/** One field of an action's or trigger's output. */
export interface OutputField {
  key: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  label?: string;
}

/** An outgoing request, as a \`sign\` hook sees it. */
export interface SignableRequest {
  url: string;
  method?: string;
  headers: Record<string, string>;
  body?: unknown;
}

export interface AuthDefinition {
  key: string;
  type: "apiKey" | "basic" | "bearer" | "oauth2" | "custom";
  displayName: string;
  description?: string;
  connectionLabel?: string;
  apiKey?: { in: "header" | "query"; name: string };
  fields: Param[];
  test(
    input: { credential: Record<string, unknown> },
    ctx: HookContext,
  ): Promise<{ ok: true } | { ok: false; message: string }>;
  sign?(
    input: { request: SignableRequest; credential: Record<string, unknown> },
    ctx: HookContext,
  ): SignableRequest | Promise<SignableRequest>;
}

export interface ActionDefinition<P = Record<string, unknown>, O = unknown> {
  key: string;
  type: "read" | "search" | "create" | "update" | "delete" | "perform";
  resource?: string;
  title: string;
  description: string;
  params?: Param[];
  output?: OutputField[];
  execute(input: P, ctx: HookContext): O | Promise<O>;
}

export interface TriggerDefinition<P = Record<string, unknown>> {
  key: string;
  title: string;
  description: string;
  /** Vendor floor for the poll interval, in milliseconds. */
  minIntervalMs?: number;
  params?: Param[];
  output?: OutputField[];
  sample?: unknown;
  poll(
    input: { params: P; state: unknown },
    ctx: HookContext,
  ): Promise<{ events: unknown[]; nextState: unknown }>;
}

export type HealthState = "ok" | "degraded" | "down" | "unknown";

export interface HealthCheckDefinition {
  key: string;
  title: string;
  description?: string;
  kind: "service" | "credential" | "quota";
  covers?: string[];
  minIntervalSeconds?: number;
  check(
    input: Record<string, unknown>,
    ctx: HookContext,
  ): Promise<{ state: HealthState; message?: string; ttlSeconds?: number }>;
}

export interface AppDefinition {
  actions: ActionDefinition<never, unknown>[];
  auth?: AuthDefinition[];
  triggers?: TriggerDefinition<never>[];
  healthChecks?: HealthCheckDefinition[];
}
`;

const POLL = `/**
 * Snapshot polling: report the rows that appeared or changed between two checks.
 *
 * State is \`{ v: 1, kind: "snapshot", seeded: true, hashes }\` — one short SHA-256 per
 * row key, never the row's values. Any other state (the host's initial \`{}\` included)
 * is unseeded: the first check records a baseline and emits nothing.
 */

export interface SnapshotState {
  v: 1;
  kind: "snapshot";
  seeded: true;
  hashes: Record<string, string>;
}

export interface SnapshotChange {
  change: "added" | "updated" | "removed";
  key: string;
  /** The row's values; \`null\` for a removed row. */
  values: unknown;
}

function seeded(state: unknown): SnapshotState | null {
  if (typeof state !== "object" || state === null) return null;
  const s = state as Partial<SnapshotState>;
  return s.v === 1 && s.kind === "snapshot" && s.seeded === true &&
      typeof s.hashes === "object" && s.hashes !== null
    ? (s as SnapshotState)
    : null;
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const o = v as Record<string, unknown>;
      return Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
    }
    return v;
  }) ?? "null";
}

async function rowHash(values: unknown): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(values)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")
    .slice(0, 12);
}

/**
 * Compare \`rows\` with the previous check. Emits added and updated rows by default;
 * \`removed\` is opt-in. More than \`maxRows\` rows, or a duplicate key, throws.
 */
export async function pollSnapshot(o: {
  state: unknown;
  rows: Array<{ key: string; values: unknown }>;
  emit?: { added?: boolean; updated?: boolean; removed?: boolean };
  maxRows?: number;
}): Promise<{ events: SnapshotChange[]; nextState: SnapshotState }> {
  const maxRows = o.maxRows ?? 5000;
  if (o.rows.length > maxRows) {
    throw new Error(\`pollSnapshot: \${o.rows.length} rows exceeds the \${maxRows}-row cap\`);
  }
  const emit = { added: true, updated: true, removed: false, ...o.emit };
  const hashes: Record<string, string> = {};
  for (const row of o.rows) {
    if (Object.hasOwn(hashes, row.key)) {
      throw new Error(\`pollSnapshot: duplicate row key \${JSON.stringify(row.key)}\`);
    }
    hashes[row.key] = await rowHash(row.values);
  }
  const nextState: SnapshotState = { v: 1, kind: "snapshot", seeded: true, hashes };
  const prior = seeded(o.state);
  if (!prior) return { events: [], nextState };

  const events: SnapshotChange[] = [];
  for (const row of o.rows) {
    const before = prior.hashes[row.key];
    if (before === undefined) {
      if (emit.added) events.push({ change: "added", key: row.key, values: row.values });
    } else if (before !== hashes[row.key] && emit.updated) {
      events.push({ change: "updated", key: row.key, values: row.values });
    }
  }
  if (emit.removed) {
    for (const key of Object.keys(prior.hashes).sort()) {
      if (!Object.hasOwn(hashes, key)) events.push({ change: "removed", key, values: null });
    }
  }
  return { events, nextState };
}
`;

const INDEX = `import type { AppDefinition } from "./lib/types.ts";
import apiKey from "./auth/api-key.ts";
import ping from "./actions/ping.ts";
import service from "./health/service.ts";
import newItem from "./triggers/new-item.ts";

export default {
  actions: [ping],
  auth: [apiKey],
  healthChecks: [service],
  triggers: [newItem],
} satisfies AppDefinition;
`;

const AUTH = `import type { AuthDefinition } from "../lib/types.ts";

/** A bare API key sent in the \`X-Api-Key\` header. Replace with your vendor's scheme. */
const apiKey: AuthDefinition = {
  key: "api-key",
  type: "apiKey",
  displayName: "API Key",
  description: "The API key for __ID__.",
  connectionLabel: "__ID__",
  apiKey: { in: "header", name: "X-Api-Key" },
  fields: [{ key: "apiKey", label: "API Key", type: "secret", required: true }],

  /** Required: the connect-time check that the credential is live. */
  async test({ credential }) {
    const { apiKey } = credential as { apiKey?: string };
    return apiKey ? { ok: true } : { ok: false, message: "no API key" };
  },

  sign({ request, credential }) {
    const { apiKey } = credential as { apiKey: string };
    request.headers["x-api-key"] = apiKey;
    return request;
  },
};

export default apiKey;
`;

const ACTION = `import type { ActionDefinition } from "../lib/types.ts";

type Input = { message?: string };

const ping: ActionDefinition<Input> = {
  key: "ping",
  type: "read",
  resource: "item",
  title: "Ping",
  description: "Echo a message. Replace with a call to the __ID__ API.",
  params: [{ key: "message", label: "Message", type: "string", required: false }],
  output: [{ key: "message", type: "string", label: "The echoed message" }],

  execute(input) {
    return Promise.resolve({ message: input.message ?? "pong" });
  },
};

export default ping;
`;

const HEALTH = `import type { HealthCheckDefinition } from "../lib/types.ts";

const service: HealthCheckDefinition = {
  key: "service",
  title: "__ID__ reachability",
  description: "Is the __ID__ API answering? Replace the URL with a real probe.",
  kind: "service",
  covers: ["*"],
  minIntervalSeconds: 60,

  async check(_input, ctx) {
    try {
      const res = await ctx.fetch("https://example.com/health");
      return res.status >= 500
        ? { state: "down", message: \`probe returned \${res.status}\` }
        : { state: "ok", ttlSeconds: 60 };
    } catch (err) {
      return { state: "down", message: \`could not reach the API: \${String(err)}\` };
    }
  },
};

export default service;
`;

const TRIGGER = `import type { TriggerDefinition } from "../lib/types.ts";
import { pollSnapshot } from "../lib/poll.ts";

/** Replace with a call to the __ID__ API listing the current items. */
export async function listItems(): Promise<Array<{ id: string }>> {
  return [];
}

/** A poll trigger stub: emits each item that appears between two checks. */
const newItem: TriggerDefinition = {
  key: "new-item",
  title: "New item",
  description: "Fires for each new item since the last check.",
  minIntervalMs: 300_000,
  params: [],
  output: [{ key: "id", type: "string", label: "Item id" }],
  sample: { id: "item_1" },

  async poll({ state }) {
    const items = await listItems();
    const { events, nextState } = await pollSnapshot({
      state,
      rows: items.map((item) => ({ key: item.id, values: item })),
      emit: { added: true, updated: false },
    });
    return { events: events.map((e) => e.values), nextState };
  },
};

export default newItem;
`;

const TEST = `import assert from "node:assert/strict";
import { test } from "node:test";
import apiKey from "../src/auth/api-key.ts";
import ping from "../src/actions/ping.ts";
import { pollSnapshot } from "../src/lib/poll.ts";

const ctx = {} as never;

test("api-key signs with X-Api-Key", async () => {
  const request = { url: "https://example.com", headers: {} as Record<string, string> };
  const signed = await apiKey.sign!({ request, credential: { apiKey: "k" } }, ctx);
  assert.equal(signed.headers["x-api-key"], "k");
});

test("api-key test hook accepts a key and refuses none", async () => {
  assert.deepEqual(await apiKey.test({ credential: { apiKey: "k" } }, ctx), { ok: true });
  assert.equal((await apiKey.test({ credential: {} }, ctx)).ok, false);
});

test("ping echoes", async () => {
  assert.deepEqual(await ping.execute({ message: "hi" }, ctx), { message: "hi" });
});

test("pollSnapshot records a baseline, then emits only new rows", async () => {
  const first = await pollSnapshot({ state: {}, rows: [{ key: "a", values: { id: "a" } }] });
  assert.deepEqual(first.events, []);
  const second = await pollSnapshot({
    state: first.nextState,
    rows: [{ key: "a", values: { id: "a" } }, { key: "b", values: { id: "b" } }],
  });
  assert.deepEqual(second.events, [{ change: "added", key: "b", values: { id: "b" } }]);
});
`;

const TSCONFIG = {
  compilerOptions: {
    target: "ES2022",
    module: "NodeNext",
    moduleResolution: "NodeNext",
    lib: ["ES2023"],
    types: ["node"],
    strict: true,
    noEmit: true,
    allowImportingTsExtensions: true,
    verbatimModuleSyntax: true,
    erasableSyntaxOnly: true,
    skipLibCheck: true,
  },
  include: ["src", "tests"],
};

const GITIGNORE = `node_modules/
dist/
out/
`;

const WORKFLOW = `name: w6w
on: [push, pull_request]
jobs:
  app:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: npm ci
      - run: npm run typecheck
      - run: npm run build
      - run: npm test
      - run: npm install -g @w6w/cli
      - run: npm run validate
      - run: npm run package
`;

const README = `# __ID__

A w6w app scaffolded by \`w6w apps init __ID__\`.

## Prerequisites

Node.js 22.6 or newer and npm — nothing else. Install the \`w6w\` CLI with
\`npm install -g @w6w/cli\` (or prefix each \`w6w\` command with \`npx @w6w/cli\`).

## Loop

\`\`\`sh
npm install
npm run build      # esbuild: src/index.ts → dist/app.js + dist/app.js.map
npm test           # unit tests (node:test)
npm run typecheck  # tsc --noEmit
npm run validate   # w6w apps validate: would dist/app.js package as a w6w app?
npm run package    # build, then w6w apps build -o out → out/__ID__/<version>/…
\`\`\`

## How a w6w app is built

You own the build. \`npm run build\` is this project's choice of bundler (esbuild); any tool
works, as long as it writes **one self-contained ES module** — every import bundled in — at the
path \`package.json\` names in \`w6w.entry\`. Its default export is the app definition.

\`w6w apps build\` does not compile anything: it loads that file, generates the manifest, inlines
\`assets/\`, and writes \`out/__ID__/<version>/{app.js,manifest.json}\`. When your build also
writes a source map (\`dist/app.js.map\`, or a \`//# sourceMappingURL=\` comment naming a local
file), it is packaged as \`app.js.map\` too, and stack traces from your app point at your
TypeScript. Drop \`--sourcemap\` from the build script and no map is packaged.

## Manifest

\`package.json\` carries the app's manifest under \`w6w\`: the dotted reverse-DNS \`id\`, a bundled
\`appearance.icon\` (\`assets/icon.svg\`) and the \`author\` the build requires. Replace the icon and
fill in your own \`author\` before publishing with \`w6w apps publish\`.

CI (\`.github/workflows/w6w.yml\`) runs \`npm ci\`, so commit \`package-lock.json\`.
`;

/** Relative path → file content, for `template` with `id` substituted. */
export function templateFiles(_template: TemplateName, id: string): Record<string, string> {
  const pkg = {
    name: `@w6w-apps/${id}`,
    version: "0.1.0",
    description: `The ${id} w6w app.`,
    license: "MIT",
    author: { name: id },
    private: true,
    type: "module",
    engines: { node: ">=22.6" },
    w6w: {
      id,
      displayName: id,
      longDescription: `The ${id} w6w app.`,
      appearance: { icon: { url: "assets/icon.svg" } },
      categories: ["other"],
      network: { allow: ["example.com"] },
      entry: "./dist/app.js",
    },
    scripts: {
      build: TEMPLATE_BUILD,
      test: 'node --test --experimental-strip-types "tests/**/*.test.ts"',
      typecheck: "tsc --noEmit",
      validate: "w6w apps validate",
      package: "npm run build && w6w apps build -o out",
    },
    devDependencies: TEMPLATE_DEV_DEPENDENCIES,
  };
  const files: Record<string, string> = {
    "package.json": JSON.stringify(pkg, null, 2) + "\n",
    "tsconfig.json": JSON.stringify(TSCONFIG, null, 2) + "\n",
    ".gitignore": GITIGNORE,
    "assets/icon.svg": ICON_SVG,
    "src/index.ts": INDEX,
    "src/lib/types.ts": TYPES,
    "src/lib/poll.ts": POLL,
    "src/auth/api-key.ts": AUTH,
    "src/actions/ping.ts": ACTION,
    "src/triggers/new-item.ts": TRIGGER,
    "src/health/service.ts": HEALTH,
    "tests/app.test.ts": TEST,
    ".github/workflows/w6w.yml": WORKFLOW,
    "README.md": README,
  };
  const out: Record<string, string> = {};
  for (const [path, body] of Object.entries(files)) out[path] = body.replaceAll("__ID__", id);
  return out;
}
