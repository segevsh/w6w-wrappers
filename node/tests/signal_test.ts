/**
 * `signal?: AbortSignal` (R-7) on every read method `@w6w/react`'s read hooks
 * call, against an injected fake `fetch`.
 *
 * Eleven methods, eleven witnesses — one case each, not one representative,
 * per this task's contract: `client.me()`, `documents.list/get/getByKey`,
 * `vars.list/get`, `connections.list`, `workflows.list/get`,
 * `functions.list/get`. Each asserts the SAME shape the exemplar
 * (`console/apps.ts`'s `listPage`, covered by `tests/console/apps_test.ts`)
 * already pins for `signal`: it reaches the injected `fetch`'s own
 * `RequestInit.signal` **unchanged** (object identity, not a copy), and it
 * never leaks into the request URL or body. One shared case at the end pins
 * the transport's cancellation branch (`code: "cancelled"`) — the branch lives
 * once in `src/http.ts`'s `request()`, so one method exercising it is enough.
 *
 * No case here needs a live server (`docs/implementation.md` §9).
 */

import { assertEquals, assertRejects } from "@std/assert";
import { W6WClient } from "../src/client.ts";
import type { FetchLike } from "../src/config.ts";
import { ApiError } from "../src/errors.ts";

/** One recorded call to the fake transport. */
interface Call {
  url: string;
  method: string | undefined;
  headers: Headers;
  body: string | null;
  signal: AbortSignal | null | undefined;
}

/** A `fetch`-shaped fake; `respond` produces the `Response` to hand back. */
function fakeFetch(respond: (call: Call) => Response): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = (input, init) => {
    calls.push({
      url: input,
      method: init?.method,
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? init.body : null,
      signal: init?.signal,
    });
    return Promise.resolve(respond(calls[calls.length - 1]));
  };
  return { fetch, calls };
}

/**
 * A `fetch`-shaped fake that honours abort: rejects with an `AbortError` the
 * moment `init.signal` is already aborted, otherwise defers to `respond` —
 * mirrors `tests/console/apps_test.ts`'s `abortableFetch` exactly.
 */
function abortableFetch(
  respond: (call: Call) => Response,
): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = (input, init) => {
    const call: Call = {
      url: input,
      method: init?.method,
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? init.body : null,
      signal: init?.signal,
    };
    calls.push(call);
    if (init?.signal?.aborted) {
      return Promise.reject(new DOMException("The operation was aborted.", "AbortError"));
    }
    return Promise.resolve(respond(call));
  };
  return { fetch, calls };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A client wired to a fake transport. `project` seeds the client-level default. */
function client(
  respond: (call: Call) => Response,
  project?: string,
): { client: W6WClient; calls: Call[] } {
  const fake = fakeFetch(respond);
  return {
    client: new W6WClient({
      baseUrl: "https://api.example.com",
      token: "tok_1",
      project,
      fetch: fake.fetch,
    }),
    calls: fake.calls,
  };
}

/** Same as {@linkcode client}, but the transport honours an aborted signal. */
function abortableClient(
  respond: (call: Call) => Response,
): { client: W6WClient; calls: Call[] } {
  const fake = abortableFetch(respond);
  return {
    client: new W6WClient({
      baseUrl: "https://api.example.com",
      token: "tok_1",
      fetch: fake.fetch,
    }),
    calls: fake.calls,
  };
}

// --- client.me() -------------------------------------------------------

Deno.test("client.me()'s signal reaches fetch's RequestInit, and is not serialized", async () => {
  const controller = new AbortController();
  const c = client(() => json({ tenant: "default", subject: "user_1" }));

  await c.client.me({ signal: controller.signal });

  assertEquals(c.calls[0].signal, controller.signal);
  const url = new URL(c.calls[0].url);
  assertEquals(url.searchParams.has("signal"), false);
  assertEquals(c.calls[0].body, null);
});

// --- documents.list/get/getByKey ----------------------------------------

Deno.test(
  "documents.list's signal reaches fetch's RequestInit; URL matches the no-signal URL",
  async () => {
    const controller = new AbortController();
    const c = client(() => json({ documents: [] }));

    await c.client.documents.list({ project: "prj_1", signal: controller.signal });

    assertEquals(c.calls[0].signal, controller.signal);
    const withSignal = new URL(c.calls[0].url);
    assertEquals(withSignal.searchParams.has("signal"), false);
    assertEquals(c.calls[0].body, null);

    const noSignal = client(() => json({ documents: [] }));
    await noSignal.client.documents.list({ project: "prj_1" });
    assertEquals(c.calls[0].url, noSignal.calls[0].url);
  },
);

Deno.test(
  "documents.get's signal reaches fetch's RequestInit; URL matches the no-signal URL",
  async () => {
    const controller = new AbortController();
    const c = client(() => json({ document: { id: "doc_1" } }));

    await c.client.documents.get("doc_1", { project: "prj_1", signal: controller.signal });

    assertEquals(c.calls[0].signal, controller.signal);
    const withSignal = new URL(c.calls[0].url);
    assertEquals(withSignal.searchParams.has("signal"), false);
    assertEquals(c.calls[0].body, null);

    const noSignal = client(() => json({ document: { id: "doc_1" } }));
    await noSignal.client.documents.get("doc_1", { project: "prj_1" });
    assertEquals(c.calls[0].url, noSignal.calls[0].url);
  },
);

Deno.test(
  "documents.getByKey's signal reaches fetch's RequestInit; URL matches the no-signal URL",
  async () => {
    const controller = new AbortController();
    const c = client(() => json({ document: { id: "doc_1", key: "welcome" } }));

    await c.client.documents.getByKey("welcome", { project: "prj_1", signal: controller.signal });

    assertEquals(c.calls[0].signal, controller.signal);
    const withSignal = new URL(c.calls[0].url);
    assertEquals(withSignal.searchParams.has("signal"), false);
    assertEquals(c.calls[0].body, null);

    const noSignal = client(() => json({ document: { id: "doc_1", key: "welcome" } }));
    await noSignal.client.documents.getByKey("welcome", { project: "prj_1" });
    assertEquals(c.calls[0].url, noSignal.calls[0].url);
  },
);

// --- vars.list/get ---------------------------------------------------------

Deno.test("vars.list's signal reaches fetch's RequestInit, and is not serialized", async () => {
  const controller = new AbortController();
  const c = client(() => json({ vars: [] }));

  await c.client.vars.list({ signal: controller.signal });

  assertEquals(c.calls[0].signal, controller.signal);
  assertEquals(c.calls[0].url, "https://api.example.com/vars");
  assertEquals(c.calls[0].body, null);
});

Deno.test("vars.get's signal reaches fetch's RequestInit, and is not serialized", async () => {
  const controller = new AbortController();
  const c = client(() => json({ var: { id: "var_1" } }));

  await c.client.vars.get("var_1", { signal: controller.signal });

  assertEquals(c.calls[0].signal, controller.signal);
  assertEquals(c.calls[0].url, "https://api.example.com/vars/var_1");
  assertEquals(c.calls[0].body, null);
});

// --- connections.list --------------------------------------------------

Deno.test(
  "connections.list's signal reaches fetch's RequestInit, and is not serialized",
  async () => {
    const controller = new AbortController();
    const c = client(() => json({ connections: [] }));

    await c.client.connections.list({ signal: controller.signal });

    assertEquals(c.calls[0].signal, controller.signal);
    assertEquals(c.calls[0].url, "https://api.example.com/connections");
    assertEquals(c.calls[0].body, null);
  },
);

// --- workflows.list/get ------------------------------------------------

Deno.test(
  "workflows.list's signal reaches fetch's RequestInit; URL matches the no-signal URL",
  async () => {
    const controller = new AbortController();
    const c = client(() => json({ workflows: [] }));

    await c.client.workflows.list({ project: "prj_1", signal: controller.signal });

    assertEquals(c.calls[0].signal, controller.signal);
    const withSignal = new URL(c.calls[0].url);
    assertEquals(withSignal.searchParams.has("signal"), false);
    assertEquals(c.calls[0].body, null);

    const noSignal = client(() => json({ workflows: [] }));
    await noSignal.client.workflows.list({ project: "prj_1" });
    assertEquals(c.calls[0].url, noSignal.calls[0].url);
  },
);

Deno.test(
  "workflows.get's signal reaches fetch's RequestInit, and is not serialized",
  async () => {
    const controller = new AbortController();
    const c = client(() =>
      json({ workflow: { id: "wf_1" }, sourceRef: null, updatedAt: "2026-07-22T18:03:00.000Z" })
    );

    await c.client.workflows.get("wf_1", { signal: controller.signal });

    assertEquals(c.calls[0].signal, controller.signal);
    assertEquals(c.calls[0].url, "https://api.example.com/workflows/wf_1");
    assertEquals(c.calls[0].body, null);
  },
);

// --- functions.list/get ------------------------------------------------

Deno.test(
  "functions.list's signal reaches fetch's RequestInit, and is not serialized",
  async () => {
    const controller = new AbortController();
    const c = client(() => json({ functions: [] }));

    await c.client.functions.list({ signal: controller.signal });

    assertEquals(c.calls[0].signal, controller.signal);
    assertEquals(c.calls[0].url, "https://api.example.com/functions");
    assertEquals(c.calls[0].body, null);
  },
);

Deno.test(
  "functions.get's signal reaches fetch's RequestInit, and is not serialized",
  async () => {
    const controller = new AbortController();
    const c = client(() => json({ function: { id: "fn_1" }, valid: true }));

    await c.client.functions.get("fn_1", { signal: controller.signal });

    assertEquals(c.calls[0].signal, controller.signal);
    assertEquals(c.calls[0].url, "https://api.example.com/functions/fn_1");
    assertEquals(c.calls[0].body, null);
  },
);

// --- shared transport branch: an already-aborted signal -------------------

Deno.test(
  "an already-aborted signal rejects with ApiError code 'cancelled', not network_error " +
    "(shared transport branch — one case covers all eleven methods)",
  async () => {
    const controller = new AbortController();
    controller.abort();
    const c = abortableClient(() => json({ vars: [] }));

    const err = await assertRejects(
      () => c.client.vars.list({ signal: controller.signal }),
      ApiError,
    );

    assertEquals(err.status, 0);
    assertEquals(err.code, "cancelled");
  },
);

// --- calls without options behave exactly as before ------------------------

Deno.test("every one of the eleven methods still works with no options at all", async () => {
  const c = client((call) => {
    if (call.url.endsWith("/auth/me")) return json({ tenant: "default", subject: "user_1" });
    if (call.url.endsWith("/documents")) return json({ documents: [] });
    if (call.url.endsWith("/documents/doc_1")) return json({ document: { id: "doc_1" } });
    if (call.url.includes("/documents/by-key/")) {
      return json({ document: { id: "doc_1", key: "welcome" } });
    }
    if (call.url.endsWith("/vars")) return json({ vars: [] });
    if (call.url.endsWith("/vars/var_1")) return json({ var: { id: "var_1" } });
    if (call.url.endsWith("/connections")) return json({ connections: [] });
    if (call.url.endsWith("/workflows")) return json({ workflows: [] });
    if (call.url.endsWith("/workflows/wf_1")) {
      return json({
        workflow: { id: "wf_1" },
        sourceRef: null,
        updatedAt: "2026-07-22T00:00:00.000Z",
      });
    }
    if (call.url.endsWith("/functions")) return json({ functions: [] });
    if (call.url.endsWith("/functions/fn_1")) {
      return json({ function: { id: "fn_1" }, valid: true });
    }
    throw new Error(`unexpected call: ${call.url}`);
  });

  await c.client.me();
  await c.client.documents.list();
  await c.client.documents.get("doc_1");
  await c.client.documents.getByKey("welcome");
  await c.client.vars.list();
  await c.client.vars.get("var_1");
  await c.client.connections.list();
  await c.client.workflows.list();
  await c.client.workflows.get("wf_1");
  await c.client.functions.list();
  await c.client.functions.get("fn_1");

  for (const call of c.calls) {
    assertEquals(call.signal, undefined);
  }
});
