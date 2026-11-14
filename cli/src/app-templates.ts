/**
 * Bundled `apps init` templates (string constants, no network).
 *
 * Two variants share one app: an `apiKey` auth, a `ping` action, a `new-item` poll trigger
 * (via `@w6w/app-kit/poll`) and a `service` health check. The `deno` variant tests with
 * `deno test`; the `node` variant has zero dependencies and tests with
 * `node --test --experimental-strip-types` (type-only `@w6w/*` imports). Building and
 * validating always go through Deno (`w6w apps validate|build`).
 *
 * Every `__ID__` in a template body is replaced with the app id.
 *
 * @module
 */

/** The two scaffold variants. */
export type TemplateName = "deno" | "node";

/**
 * The app-id grammar `apps init` accepts: the canonical builder's `ID_RE`
 * (`core/packages/app-build/src/build.ts`), restated here so the CLI refuses a
 * non-buildable id at scaffold time instead of letting `apps validate` do it later.
 */
export const APP_ID = /^[a-z0-9]+(\.[a-z0-9-]+)+$/;

/** The exact `deno.json` imports every template carries (pinned P3). */
export const TEMPLATE_IMPORTS: Record<string, string> = {
  "@w6w/types": "jsr:@w6w/types@0.2.0",
  "@w6w/runtime/author": "jsr:@w6w/runtime@0.2.0/author",
  "@w6w/app-kit/poll": "jsr:@w6w/app-kit@0.1.0/poll",
};

/** The bundled app icon (`assets/icon.svg`), inlined into the built manifest. */
const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
     stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="9"/>
  <path d="M3.5 12h17"/>
  <path d="M12 3.5c2.5 2.4 3.9 5.4 3.9 8.5s-1.4 6.1-3.9 8.5c-2.5-2.4-3.9-5.4-3.9-8.5s1.4-6.1 3.9-8.5z"/>
</svg>
`;

const INDEX = `import type { AppDefinition } from "@w6w/types";
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

const AUTH = `import type { AuthDefinition } from "@w6w/types";

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
    const { apiKey } = credential as { apiKey: string };
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

const ACTION = `import type { ActionDefinition } from "@w6w/types";

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

const HEALTH = `import type { HealthCheckDefinition } from "@w6w/types";

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

const TRIGGER = `import type { TriggerDefinition } from "@w6w/types";
import { pollSnapshot } from "@w6w/app-kit/poll";

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
    // Replace with a call to the __ID__ API listing the current items.
    const items: Array<{ id: string }> = [];
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

const WORKFLOW = `name: w6w
on: [push, pull_request]
jobs:
  app:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: denoland/setup-deno@v2
        with:
          deno-version: v2.x
      - run: npx -y @w6w/cli apps validate
      - run: npx -y @w6w/cli apps build -o dist
`;

function readme(template: TemplateName): string {
  const loop = template === "deno"
    ? `deno task test  # unit tests
deno task validate  # check the app against the builder
deno task build     # write ./out/__ID__/<version>/{app.js,manifest.json}`
    : `npm test           # unit tests
w6w apps validate  # check the app against the builder
w6w apps build     # write ./out/__ID__/<version>/{app.js,manifest.json}`;
  return `# __ID__

A w6w app scaffolded by \`w6w apps init __ID__ --template ${template}\`.

## Prerequisite

[Deno](https://deno.com) must be on your PATH: \`w6w apps validate\` and \`w6w apps build\` run the
canonical \`@w6w/app-build\` builder through it. The \`w6w\` CLI itself must be on your PATH too.

## Loop

\`\`\`sh
${loop}
\`\`\`

## Manifest

\`package.json\` carries the app's manifest under \`w6w\`: the dotted reverse-DNS \`id\`, a bundled
\`appearance.icon\` (\`assets/icon.svg\`) and the \`author\` the build requires. Replace the icon and
fill in your own \`author\` before publishing.
`;
}

const AUTH_TEST_DENO = `import { assertEquals } from "jsr:@std/assert@^1.0.0";
import apiKey from "../auth/api-key.ts";
import ping from "../actions/ping.ts";

Deno.test("api-key signs with X-Api-Key", () => {
  const request = { url: "https://example.com", headers: {} as Record<string, string> };
  const signed = apiKey.sign!(
    { request, credential: { apiKey: "k" } } as never,
    {} as never,
  ) as typeof request;
  assertEquals(signed.headers["x-api-key"], "k");
});

Deno.test("api-key test hook accepts a key", async () => {
  const result = await apiKey.test({ credential: { apiKey: "k" } } as never, {} as never);
  assertEquals(result, { ok: true });
});

Deno.test("ping echoes", async () => {
  assertEquals(await ping.execute({ message: "hi" }, {} as never), { message: "hi" });
});
`;

const AUTH_TEST_NODE = `import assert from "node:assert/strict";
import { test } from "node:test";
import apiKey from "../auth/api-key.ts";
import ping from "../actions/ping.ts";

test("api-key signs with X-Api-Key", () => {
  const request = { url: "https://example.com", headers: {} as Record<string, string> };
  const signed = apiKey.sign!(
    { request, credential: { apiKey: "k" } } as never,
    {} as never,
  ) as typeof request;
  assert.equal(signed.headers["x-api-key"], "k");
});

test("api-key test hook accepts a key", async () => {
  assert.deepEqual(await apiKey.test({ credential: { apiKey: "k" } } as never, {} as never), {
    ok: true,
  });
});

test("ping echoes", async () => {
  assert.deepEqual(await ping.execute({ message: "hi" }, {} as never), { message: "hi" });
});
`;

/** Relative path → file content, for `template` with `id` substituted. */
export function templateFiles(template: TemplateName, id: string): Record<string, string> {
  const denoJson = {
    name: `@w6w-apps/${id}`,
    exports: "./index.ts",
    imports: TEMPLATE_IMPORTS,
    tasks: template === "deno"
      ? {
        test: "deno test -A tests/",
        validate: "w6w apps validate",
        build: "w6w apps build",
      }
      : { test: "node --test --experimental-strip-types tests/*.test.ts" },
  };
  const pkg: Record<string, unknown> = {
    name: `@w6w-apps/${id}`,
    version: "0.1.0",
    description: `The ${id} w6w app.`,
    license: "MIT",
    author: { name: id },
    private: true,
    w6w: {
      id,
      displayName: id,
      longDescription: `The ${id} w6w app.`,
      appearance: { icon: { url: "assets/icon.svg" } },
      categories: ["other"],
      network: { allow: ["example.com"] },
      entry: "./index.ts",
    },
    type: "module",
  };
  if (template === "node") {
    pkg.scripts = { test: "node --test --experimental-strip-types tests/*.test.ts" };
  }
  const files: Record<string, string> = {
    "package.json": JSON.stringify(pkg, null, 2) + "\n",
    "deno.json": JSON.stringify(denoJson, null, 2) + "\n",
    "assets/icon.svg": ICON_SVG,
    "index.ts": INDEX,
    "auth/api-key.ts": AUTH,
    "actions/ping.ts": ACTION,
    "triggers/new-item.ts": TRIGGER,
    "health/service.ts": HEALTH,
    "tests/app.test.ts": template === "deno" ? AUTH_TEST_DENO : AUTH_TEST_NODE,
    ".github/workflows/w6w.yml": WORKFLOW,
    "README.md": readme(template),
  };
  const out: Record<string, string> = {};
  for (const [path, body] of Object.entries(files)) out[path] = body.replaceAll("__ID__", id);
  return out;
}
