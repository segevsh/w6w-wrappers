/**
 * The three client-wide options this task adds: a per-request token supplier,
 * opt-in one-shot 401 recovery with an `onUnauthorized` callback, and
 * client-wide default `headers`. Exercised against the real {@linkcode request}
 * transport (and, for the headers acceptance case, a real typed call) rather
 * than a mock of either — the same fake-`fetch` seam `tests/http_test.ts` uses,
 * so no new test infrastructure is needed (`docs/implementation.md` §9).
 */

import { assertEquals, assertRejects } from "@std/assert";
import { W6WClient } from "../src/client.ts";
import { type FetchLike, resolveConfig, type TokenProvider } from "../src/config.ts";
import { ApiError, ConfigError } from "../src/errors.ts";
import { request } from "../src/http.ts";

/** One recorded call to the fake transport. */
interface Call {
  url: string;
  method: string | undefined;
  headers: Headers;
  body: string | null;
}

function fakeFetch(respond: (call: Call) => Response): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = (input, init) => {
    const call: Call = {
      url: input,
      method: init?.method,
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? init.body : null,
    };
    calls.push(call);
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

/** A `401` carrying the exact code the server's `oidc.ts unauthorized()` sends. */
function unauthorized(message = "Token expired."): Response {
  return json({ error: { code: "unauthorized", message } }, 401);
}

// ---------------------------------------------------------------------------
// acc.1 — the supplier is called fresh on every request, awaited, validated
// ---------------------------------------------------------------------------

Deno.test("a function token is called fresh on every request — two calls, two different bearers", async () => {
  let n = 0;
  const token: TokenProvider = () => `tok_${++n}`;
  const config = resolveConfig({ baseUrl: "https://api.example.com", token });
  const fake = fakeFetch(() => json({ ok: true }));

  await request(config, fake.fetch, { method: "GET", path: "/vars" });
  await request(config, fake.fetch, { method: "GET", path: "/vars" });

  assertEquals(fake.calls.length, 2);
  assertEquals(fake.calls[0].headers.get("authorization"), "Bearer tok_1");
  assertEquals(fake.calls[1].headers.get("authorization"), "Bearer tok_2");
});

Deno.test("a Promise-returning provider is awaited — never the literal '[object Promise]'", async () => {
  const token: TokenProvider = () => Promise.resolve("tok_async");
  const config = resolveConfig({ baseUrl: "https://api.example.com", token });
  const fake = fakeFetch(() => json({ ok: true }));

  await request(config, fake.fetch, { method: "GET", path: "/vars" });

  assertEquals(fake.calls[0].headers.get("authorization"), "Bearer tok_async");
});

Deno.test("a nullish provider result raises the same ConfigError, with ZERO transport calls", async () => {
  const token: TokenProvider = () => null;
  const config = resolveConfig({ baseUrl: "https://api.example.com", token });
  const fake = fakeFetch(() => json({ ok: true }));

  const err = await assertRejects(
    () => request(config, fake.fetch, { method: "GET", path: "/vars" }),
    ConfigError,
  );
  // The SAME message a nullish/blank STATIC token raises today — no second
  // message for the function case.
  assertEquals(
    err.message,
    "No w6w API token is configured. Pass one to the client " +
      '(new W6WClient({ token: "…" })) or set the ' +
      "W6W_TOKEN environment variable. Every w6w API operation is authenticated.",
  );
  assertEquals(fake.calls.length, 0);
});

Deno.test("a blank (whitespace-only) provider result is treated exactly like a nullish one", async () => {
  const token: TokenProvider = () => "   ";
  const config = resolveConfig({ baseUrl: "https://api.example.com", token });
  const fake = fakeFetch(() => json({ ok: true }));

  await assertRejects(
    () => request(config, fake.fetch, { method: "GET", path: "/vars" }),
    ConfigError,
  );
  assertEquals(fake.calls.length, 0);
});

Deno.test("a plain string token behaves exactly as before — same bearer, every call", async () => {
  const config = resolveConfig({ baseUrl: "https://api.example.com", token: "tok_static" });
  const fake = fakeFetch(() => json({ ok: true }));

  await request(config, fake.fetch, { method: "GET", path: "/vars" });
  await request(config, fake.fetch, { method: "GET", path: "/vars" });

  assertEquals(fake.calls[0].headers.get("authorization"), "Bearer tok_static");
  assertEquals(fake.calls[1].headers.get("authorization"), "Bearer tok_static");
});

// ---------------------------------------------------------------------------
// acc.2 — never echo a token value, including on the recovery-failure path
// ---------------------------------------------------------------------------

Deno.test(
  "a failed recovery attempt (blank refreshed token) never echoes the ORIGINAL token into the thrown error",
  async () => {
    const config = resolveConfig({
      baseUrl: "https://api.example.com",
      // A secret-looking value on the normal call — so an accidental
      // interpolation anywhere in the error path would be obvious — that goes
      // blank (not nullish) only on the forced-refresh call.
      token: (ctx) => (ctx?.forceRefresh ? "   " : "tok_SECRET_do_not_leak"),
      refreshOnUnauthorized: true,
    });
    const fake = fakeFetch(() => unauthorized());

    const err = await assertRejects(
      () => request(config, fake.fetch, { method: "GET", path: "/vars" }),
      ApiError,
    );

    assertEquals(err.status, 401);
    // The refresh was attempted (that's covered below); it yielded nothing
    // usable, so there is no retry — exactly the original call.
    assertEquals(fake.calls.length, 1);
    assertEquals(err.message.includes("tok_SECRET_do_not_leak"), false);
  },
);

// ---------------------------------------------------------------------------
// acc.3 — opt-in one-shot 401 recovery
// ---------------------------------------------------------------------------

Deno.test("refreshOnUnauthorized defaults to false — one call, the 401 is thrown, unchanged", async () => {
  let providerCalls = 0;
  const token: TokenProvider = () => {
    providerCalls++;
    return "tok_1";
  };
  const config = resolveConfig({ baseUrl: "https://api.example.com", token });
  const fake = fakeFetch(() => unauthorized());

  const err = await assertRejects(
    () => request(config, fake.fetch, { method: "GET", path: "/vars" }),
    ApiError,
  );

  assertEquals(err.status, 401);
  assertEquals(fake.calls.length, 1);
  assertEquals(providerCalls, 1);
});

Deno.test(
  "refreshOnUnauthorized: true — exactly one forced refresh and one retry, the SAME method/path/query",
  async () => {
    const ctxSeen: Array<{ forceRefresh?: boolean } | undefined> = [];
    let n = 0;
    const token: TokenProvider = (ctx) => {
      ctxSeen.push(ctx);
      n += 1;
      return n === 1 ? "tok_old" : "tok_new";
    };
    const config = resolveConfig({
      baseUrl: "https://api.example.com",
      token,
      refreshOnUnauthorized: true,
    });
    let attempt = 0;
    const fake = fakeFetch(() => (attempt++ === 0 ? unauthorized() : json({ ok: true })));

    const res = await request(config, fake.fetch, {
      method: "GET",
      path: "/vars",
      query: { project: "prj_1" },
    });

    assertEquals(res.body, { ok: true });
    assertEquals(fake.calls.length, 2);
    assertEquals(fake.calls[0].url, "https://api.example.com/vars?project=prj_1");
    assertEquals(fake.calls[1].url, "https://api.example.com/vars?project=prj_1");
    assertEquals(fake.calls[0].headers.get("authorization"), "Bearer tok_old");
    assertEquals(fake.calls[1].headers.get("authorization"), "Bearer tok_new");
    // Normal per-request resolution never passes forceRefresh; the retry's
    // forced refresh passes it exactly once — not zero, not twice.
    assertEquals(ctxSeen, [undefined, { forceRefresh: true }]);
  },
);

Deno.test("the retry re-sends the identical method/path/body — POST case", async () => {
  let n = 0;
  const token: TokenProvider = () => (++n === 1 ? "tok_old" : "tok_new");
  const config = resolveConfig({
    baseUrl: "https://api.example.com",
    token,
    refreshOnUnauthorized: true,
  });
  let attempt = 0;
  const fake = fakeFetch(() => (attempt++ === 0 ? unauthorized() : json({ ok: true }, 202)));

  const res = await request(config, fake.fetch, {
    method: "POST",
    path: "/workflows/wf_1/run",
    body: { variables: { a: 1 } },
  });

  assertEquals(res.status, 202);
  assertEquals(fake.calls.length, 2);
  for (const call of fake.calls) {
    assertEquals(call.method, "POST");
    assertEquals(call.url, "https://api.example.com/workflows/wf_1/run");
    assertEquals(call.body, '{"variables":{"a":1}}');
  }
  assertEquals(fake.calls[1].headers.get("authorization"), "Bearer tok_new");
});

Deno.test("a 401 with any code other than 'unauthorized' never triggers recovery", async () => {
  let providerCalls = 0;
  const token: TokenProvider = () => {
    providerCalls++;
    return `tok_${providerCalls}`;
  };
  const config = resolveConfig({
    baseUrl: "https://api.example.com",
    token,
    refreshOnUnauthorized: true,
  });
  const fake = fakeFetch(() => json({ error: { code: "forbidden", message: "nope" } }, 401));

  const err = await assertRejects(
    () => request(config, fake.fetch, { method: "GET", path: "/vars" }),
    ApiError,
  );

  assertEquals(err.code, "forbidden");
  assertEquals(fake.calls.length, 1);
  assertEquals(providerCalls, 1);
});

Deno.test(
  "two consecutive 401/unauthorized responses: exactly 2 calls, onUnauthorized fires ONCE, then throws",
  async () => {
    let n = 0;
    const token: TokenProvider = () => `tok_${++n}`;
    let onUnauthorizedCalls = 0;
    let lastSeen: ApiError | undefined;
    const config = resolveConfig({
      baseUrl: "https://api.example.com",
      token,
      refreshOnUnauthorized: true,
      onUnauthorized: (err) => {
        onUnauthorizedCalls += 1;
        lastSeen = err;
      },
    });
    const fake = fakeFetch(() => unauthorized());

    const err = await assertRejects(
      () => request(config, fake.fetch, { method: "GET", path: "/vars" }),
      ApiError,
    );

    assertEquals(fake.calls.length, 2);
    assertEquals(onUnauthorizedCalls, 1);
    assertEquals(lastSeen, err);
    assertEquals(err.status, 401);
    assertEquals(err.code, "unauthorized");
    // The refreshed token is never leaked into the terminal error either.
    assertEquals(err.message.includes("tok_2"), false);
  },
);

Deno.test("a static string token cannot be retried through, even with recovery on — exactly 1 call", async () => {
  const config = resolveConfig({
    baseUrl: "https://api.example.com",
    token: "tok_static",
    refreshOnUnauthorized: true,
  });
  const fake = fakeFetch(() => unauthorized());

  await assertRejects(
    () => request(config, fake.fetch, { method: "GET", path: "/vars" }),
    ApiError,
  );

  assertEquals(fake.calls.length, 1);
});

Deno.test("requireAuth: false never retries and never calls onUnauthorized, even on a 401", async () => {
  let n = 0;
  const token: TokenProvider = () => `tok_${++n}`;
  let onUnauthorizedCalls = 0;
  const config = resolveConfig({
    baseUrl: "https://api.example.com",
    token,
    refreshOnUnauthorized: true,
    onUnauthorized: () => {
      onUnauthorizedCalls += 1;
    },
  });
  const fake = fakeFetch(() => unauthorized());

  await assertRejects(
    () =>
      request(config, fake.fetch, {
        method: "POST",
        path: "/auth/login",
        body: { username: "u", password: "p" },
        requireAuth: false,
      }),
    ApiError,
  );

  assertEquals(fake.calls.length, 1);
  assertEquals(onUnauthorizedCalls, 0);
});

Deno.test("a successful retry never calls onUnauthorized", async () => {
  let n = 0;
  const token: TokenProvider = () => (++n === 1 ? "tok_old" : "tok_new");
  let onUnauthorizedCalls = 0;
  const config = resolveConfig({
    baseUrl: "https://api.example.com",
    token,
    refreshOnUnauthorized: true,
    onUnauthorized: () => {
      onUnauthorizedCalls += 1;
    },
  });
  let attempt = 0;
  const fake = fakeFetch(() => (attempt++ === 0 ? unauthorized() : json({ ok: true })));

  await request(config, fake.fetch, { method: "GET", path: "/vars" });

  assertEquals(onUnauthorizedCalls, 0);
});

// ---------------------------------------------------------------------------
// acc.4 — client-wide default headers
// ---------------------------------------------------------------------------

Deno.test("client-wide default headers reach a typed call (workflows.list)", async () => {
  const fake = fakeFetch(() => json({ workflows: [] }));
  const client = new W6WClient({
    baseUrl: "https://api.example.com",
    token: "tok_1",
    headers: { "x-tenant": "t_42" },
    fetch: fake.fetch,
  });

  await client.workflows.list();

  assertEquals(fake.calls[0].headers.get("x-tenant"), "t_42");
});

Deno.test("a per-request header overrides a same-named client default", async () => {
  const fake = fakeFetch(() => json({ ok: true }));
  const config = resolveConfig({
    baseUrl: "https://api.example.com",
    token: "tok_1",
    headers: { "x-tenant": "default" },
  });

  await request(config, fake.fetch, {
    method: "GET",
    path: "/vars",
    headers: { "x-tenant": "override" },
  });

  assertEquals(fake.calls[0].headers.get("x-tenant"), "override");
});

Deno.test(
  "a client default authorization/content-type can never displace the bearer or the JSON content-type",
  async () => {
    const fake = fakeFetch(() => json({ ok: true }));
    const config = resolveConfig({
      baseUrl: "https://api.example.com",
      token: "tok_real",
      headers: { authorization: "Bearer evil-default", "content-type": "text/plain" },
    });

    await request(config, fake.fetch, { method: "POST", path: "/vars", body: { a: 1 } });

    assertEquals(fake.calls[0].headers.get("authorization"), "Bearer tok_real");
    assertEquals(fake.calls[0].headers.get("content-type"), "application/json");
  },
);
