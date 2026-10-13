/**
 * `client.console.tenantOAuthApps.*`, against an injected fake `fetch`.
 *
 * No case here needs a live server (`docs/implementation.md` §9). Every
 * assertion below is on the **recorded call** — method, URL, and the parsed
 * request body's exact KEY SET — never on the method name, because the mutants
 * that matter here all keep the method and change what goes on the wire.
 *
 * The case class that carries this file is `put`'s body-by-omission rule. A
 * serializer that normalised the untouched fields to `null` would send
 * `{"clientId":null,"clientSecret":null,"extra":null,"disabled":true}` for a
 * caller that only flipped `disabled` — and the server computes
 * `hasClientSecret: input.clientSecret !== null`
 * (`packages/server/packages/bll/tenant-oauth-app.ts:291-293`), so that shape
 * satisfies the enabled-override invariant at `:332` and overwrites the stored
 * ciphertext with nothing, silently. Asserting the exact key set — not merely
 * "the value we set is present" — is what discriminates it.
 *
 * No secret VALUE here is a real credential; `"cs_test_1"` is an
 * obviously-synthetic placeholder used only to prove the transport forwards the
 * string verbatim.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { W6WClient } from "../../src/client.ts";
import type { FetchLike } from "../../src/config.ts";
import { ApiError } from "../../src/errors.ts";
import type {
  SetTenantOAuthAppInput,
  TenantOAuthAppsResponse,
  TenantOAuthAppSummary,
  TenantOAuthCandidatesPage,
} from "../../src/console/tenant-oauth-apps.ts";

/** One recorded call to the fake transport. */
interface Call {
  url: string;
  method: string | undefined;
  headers: Headers;
  body: string | null;
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
    });
    return Promise.resolve(respond(calls[calls.length - 1]));
  };
  return { fetch, calls };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A client wired to a fake transport. */
function client(respond: (call: Call) => Response): { client: W6WClient; calls: Call[] } {
  const fake = fakeFetch(respond);
  return {
    client: new W6WClient({
      baseUrl: "https://api.example.com",
      token: "tok_1",
      fetch: fake.fetch,
    }),
    calls: fake.calls,
  };
}

/** The parsed request body of a recorded call. `{}` for a bodiless request. */
function sentBody(call: Call): Record<string, unknown> {
  return JSON.parse(call.body ?? "{}") as Record<string, unknown>;
}

// Deliberately NO `clientSecret` field — matches the summary's real wire shape
// (the server's summary row has no secret column on it either).
const CONFIG_A: TenantOAuthAppSummary = {
  appId: "sendgrid",
  authKey: "oauth2",
  clientId: "cid_1",
  redirectUri: "https://api.example.com/oauth/callback/sendgrid/oauth2",
  callbackUrl: "https://api.example.com/oauth/callback/sendgrid/oauth2",
  extra: { scopes: ["mail.send"] },
  hasClientSecret: true,
  disabled: false,
};

const CONFIG_B: TenantOAuthAppSummary = {
  appId: "eventbrite",
  authKey: "oauth2",
  clientId: null,
  redirectUri: null,
  extra: {},
  hasClientSecret: false,
  disabled: true,
};

const LIST: TenantOAuthAppsResponse = {
  configs: [CONFIG_A, CONFIG_B],
};

Deno.test(
  "console.tenantOAuthApps: list/listCandidates/put/remove are functions on a constructed client",
  () => {
    // Runtime, not type-level: a namespace that silently lost a method would
    // still typecheck everywhere else in this suite.
    const c = new W6WClient({ baseUrl: "https://api.example.com", token: "t" });
    assertEquals(typeof c.console.tenantOAuthApps.list, "function");
    assertEquals(typeof c.console.tenantOAuthApps.listCandidates, "function");
    assertEquals(typeof c.console.tenantOAuthApps.put, "function");
    assertEquals(typeof c.console.tenantOAuthApps.remove, "function");
  },
);

Deno.test(
  "console.tenantOAuthApps.list GETs /tenant/oauth-apps and returns the body verbatim, per-row callbackUrl included",
  async () => {
    const c = client(() => json(LIST));

    const res = await c.client.console.tenantOAuthApps.list();

    // An `unwrap(res, "configs")` mutant would resolve the array alone and
    // fail this deep-equal: the body is returned exactly as the server sent it.
    assertEquals(res, LIST);
    assertEquals(
      res.configs[0].callbackUrl,
      "https://api.example.com/oauth/callback/sendgrid/oauth2",
    );
    assertEquals(c.calls.length, 1);
    assertEquals(c.calls[0].method, "GET");
    assertEquals(c.calls[0].url, "https://api.example.com/tenant/oauth-apps");
    // Authenticated: the tenant comes from the bearer, never from a parameter.
    assertEquals(c.calls[0].headers.get("authorization"), "Bearer tok_1");
  },
);

Deno.test(
  "console.tenantOAuthApps.put sends ONLY the keys set — {disabled:true} is exactly one key",
  async () => {
    const c = client(() => json({ config: CONFIG_A }, 201));

    await c.client.console.tenantOAuthApps.put("sendgrid", "oauth2", { disabled: true });

    // THE case. A serializer emitting
    // {"clientId":null,"clientSecret":null,"extra":null,"disabled":true} is the
    // silent-credential-wipe shape; the exact key set is what rejects it.
    const body = sentBody(c.calls[0]);
    assertEquals(Object.keys(body).sort(), ["disabled"]);
    assertEquals(body.disabled, true);
    assertEquals(c.calls[0].method, "PUT");
    assertEquals(c.calls[0].url, "https://api.example.com/tenant/oauth-app/sendgrid/oauth2");
  },
);

Deno.test(
  "console.tenantOAuthApps.put sends ONLY clientSecret, value verbatim",
  async () => {
    const c = client(() => json({ config: CONFIG_A }, 201));

    await c.client.console.tenantOAuthApps.put("sendgrid", "oauth2", { clientSecret: "cs_test_1" });

    const body = sentBody(c.calls[0]);
    assertEquals(Object.keys(body).sort(), ["clientSecret"]);
    assertEquals(body.clientSecret, "cs_test_1");
  },
);

Deno.test(
  "console.tenantOAuthApps.put preserves an explicit null — clearing must stay possible",
  async () => {
    const c = client(() => json({ config: CONFIG_B }, 201));

    await c.client.console.tenantOAuthApps.put("sendgrid", "oauth2", { clientSecret: null });

    // A serializer that treated `null` as "omit" would make clearing a stored
    // secret impossible: the key would simply never arrive and the server would
    // preserve what it has.
    const body = sentBody(c.calls[0]);
    assertEquals(Object.keys(body).sort(), ["clientSecret"]);
    assertEquals(body.clientSecret, null);
  },
);

Deno.test(
  "console.tenantOAuthApps.put drops an explicitly-undefined key rather than nulling it",
  async () => {
    const c = client(() => json({ config: CONFIG_A }, 201));

    // The shape a form produces when a field was rendered but never touched.
    const input: SetTenantOAuthAppInput = {
      clientId: "cid_2",
      clientSecret: undefined,
      extra: undefined,
      disabled: undefined,
    };
    await c.client.console.tenantOAuthApps.put("sendgrid", "oauth2", input);

    const body = sentBody(c.calls[0]);
    assertEquals(Object.keys(body).sort(), ["clientId"]);
    assertEquals(body.clientId, "cid_2");
  },
);

Deno.test("console.tenantOAuthApps.put sends every key the caller DID set", async () => {
  const c = client(() => json({ config: CONFIG_A }, 201));

  await c.client.console.tenantOAuthApps.put("sendgrid", "oauth2", {
    clientId: "cid_2",
    clientSecret: "cs_test_1",
    extra: { scopes: ["mail.send"] },
    disabled: false,
  });

  // The opposite mutant: an over-eager omission rule that dropped falsy values
  // would lose `disabled: false` here.
  const body = sentBody(c.calls[0]);
  assertEquals(Object.keys(body).sort(), ["clientId", "clientSecret", "disabled", "extra"]);
  assertEquals(body.disabled, false);
  assertEquals(body.extra, { scopes: ["mail.send"] });
});

Deno.test("console.tenantOAuthApps.put returns res.body.config, not res.body", async () => {
  const c = client(() => json({ config: CONFIG_A }, 201));

  const res = await c.client.console.tenantOAuthApps.put("sendgrid", "oauth2", { clientId: "x" });

  // A copy-paste from `list` would resolve the envelope `{config: …}` itself.
  assertEquals(res, CONFIG_A);
});

Deno.test("console.tenantOAuthApps.remove DELETEs and resolves void", async () => {
  const c = client(() => json({ ok: true }));

  const res = await c.client.console.tenantOAuthApps.remove("sendgrid", "oauth2");

  assertEquals(res, undefined);
  assertEquals(c.calls[0].method, "DELETE");
  assertEquals(c.calls[0].url, "https://api.example.com/tenant/oauth-app/sendgrid/oauth2");
  // Bodiless: `hasBody` is false, so nothing is serialised.
  assertEquals(c.calls[0].body, null);
});

Deno.test("console.tenantOAuthApps percent-encodes both path segments", async () => {
  const c = client(() => json({ ok: true }));

  await c.client.console.tenantOAuthApps.remove("a/b", "k 1");

  // A raw template literal would have produced `/tenant/oauth-app/a/b/k 1`,
  // which addresses a different route entirely.
  assertEquals(c.calls[0].url, "https://api.example.com/tenant/oauth-app/a%2Fb/k%201");

  const c2 = client(() => json({ config: CONFIG_A }, 201));
  await c2.client.console.tenantOAuthApps.put("a/b", "k 1", { disabled: true });
  assertEquals(c2.calls[0].url, "https://api.example.com/tenant/oauth-app/a%2Fb/k%201");
});

// ── Type-level: the input type must not offer what the surface does not have ──

const PAGE_WITH_CURSOR: TenantOAuthCandidatesPage = {
  apps: [{
    id: "eventbrite",
    displayName: "Eventbrite",
    version: "1.2.0",
    description: "Events",
    categories: ["events"],
    brandColor: "#f05537",
    owner: { tenant: "", subject: "" },
  }],
  nextCursor: "eyJrIjoi",
};
const PAGE_LAST: TenantOAuthCandidatesPage = {
  apps: [{
    id: "mailchimp",
    displayName: "Mailchimp",
    version: "2.0.0",
    description: "Email",
    owner: { tenant: "", subject: "" },
  }],
};

Deno.test(
  "console.tenantOAuthApps.listCandidates() GETs /tenant/oauth-apps/candidates with NO query string",
  async () => {
    const c = client(() => json(PAGE_LAST));
    await c.client.console.tenantOAuthApps.listCandidates();
    assertEquals(c.calls.length, 1);
    assertEquals(c.calls[0].method, "GET");
    assertEquals(c.calls[0].url, "https://api.example.com/tenant/oauth-apps/candidates");
    assertEquals(c.calls[0].body, null);
  },
);

Deno.test(
  "console.tenantOAuthApps.listCandidates serializes q/limit/cursor under their own wire names, percent-encoded",
  async () => {
    const c = client(() => json(PAGE_LAST));
    await c.client.console.tenantOAuthApps.listCandidates({
      q: "a b&c",
      limit: 25,
      cursor: "eyJ",
    });
    const url = new URL(c.calls[0].url);
    assertEquals(url.pathname, "/tenant/oauth-apps/candidates");
    assertEquals(url.searchParams.get("q"), "a b&c");
    assertEquals(url.searchParams.get("limit"), "25");
    assertEquals(url.searchParams.get("cursor"), "eyJ");
    assertEquals([...url.searchParams.keys()].sort(), ["cursor", "limit", "q"]);
    // The raw query string must keep `&` inside q encoded, not split it.
    assertEquals(url.search.includes("q=a%20b%26c") || url.search.includes("q=a+b%26c"), true);
  },
);

Deno.test(
  "console.tenantOAuthApps.listCandidates: an omitted member is ABSENT from the query, never `q=` or `undefined`",
  async () => {
    const c = client(() => json(PAGE_LAST));
    await c.client.console.tenantOAuthApps.listCandidates({ limit: 10 });
    await c.client.console.tenantOAuthApps.listCandidates({ q: "x", cursor: undefined });
    const first = new URL(c.calls[0].url);
    assertEquals([...first.searchParams.keys()], ["limit"]);
    const second = new URL(c.calls[1].url);
    assertEquals([...second.searchParams.keys()], ["q"]);
    assertEquals(c.calls[0].url.includes("undefined"), false);
    assertEquals(c.calls[1].url.includes("undefined"), false);
  },
);

Deno.test(
  "console.tenantOAuthApps.listCandidates returns the body verbatim, with and without nextCursor",
  async () => {
    const withCursor = client(() => json(PAGE_WITH_CURSOR));
    assertEquals(
      await withCursor.client.console.tenantOAuthApps.listCandidates(),
      PAGE_WITH_CURSOR,
    );
    const last = client(() => json(PAGE_LAST));
    const res = await last.client.console.tenantOAuthApps.listCandidates();
    assertEquals(res, PAGE_LAST);
    assertEquals("nextCursor" in res, false);
  },
);

Deno.test(
  "console.tenantOAuthApps.listCandidates: signal rides the request, never the query; an aborted one rejects 'cancelled'",
  async () => {
    const controller = new AbortController();
    controller.abort();
    const calls: Call[] = [];
    const fetch: FetchLike = (input, init) => {
      calls.push({
        url: input,
        method: init?.method,
        headers: new Headers(init?.headers),
        body: null,
      });
      if (init?.signal?.aborted) {
        return Promise.reject(new DOMException("The operation was aborted.", "AbortError"));
      }
      return Promise.resolve(json(PAGE_LAST));
    };
    const c = new W6WClient({ baseUrl: "https://api.example.com", token: "tok_1", fetch });

    const err = await assertRejects(
      () => c.console.tenantOAuthApps.listCandidates({ signal: controller.signal }),
      ApiError,
    );
    assertEquals(err.status, 0);
    assertEquals(err.code, "cancelled");
    assertEquals(new URL(calls[0].url).search, "");
  },
);

/**
 * `redirectUri` is derived SERVER-SIDE (each row's `callbackUrl`) and `force` is an
 * operator-only affordance (W4). Neither is on this surface, and a field the
 * SDK offers is a field a form will fill — so both must fail to COMPILE.
 * Aimed at an explicit `SetTenantOAuthAppInput` annotation rather than an
 * inferred call argument, so `deno task check` is the gate.
 */
// @ts-expect-error — `redirectUri` is not on this surface; it is server-derived.
const _withRedirectUri: SetTenantOAuthAppInput = { redirectUri: "https://example.com/cb" };
// @ts-expect-error — `force` is an operator affordance, never a tenant admin's.
const _withForce: SetTenantOAuthAppInput = { disabled: true, force: true };

/** A summary can never carry a secret — the structural half of the same rule. */
// @ts-expect-error — `clientSecret` is not on the summary; only `hasClientSecret` is.
const _summaryWithSecret: TenantOAuthAppSummary = { ...CONFIG_A, clientSecret: "cs_test_1" };

Deno.test("type-level guards above are referenced so the file cannot be dead-stripped", () => {
  assertEquals(typeof _withRedirectUri, "object");
  assertEquals(typeof _withForce, "object");
  assertEquals(typeof _summaryWithSecret, "object");
});

const _listWithTopLevelCallback: TenantOAuthAppsResponse = {
  configs: [],
  // @ts-expect-error — the callback URL is per row now; there is no top-level `callbackUrl`.
  callbackUrl: "https://api.example.com/oauth/callback/x/oauth2",
};

Deno.test("console.tenantOAuthApps: the top-level callbackUrl witness is referenced", () => {
  assertEquals(_listWithTopLevelCallback.configs.length, 0);
});
