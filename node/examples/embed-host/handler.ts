/**
 * Host endpoint that mints a w6w embed session for the signed-in user.
 *
 * A copy-paste example, not exported SDK API. It is framework-neutral: a plain
 * `(Request) => Promise<Response>`, so it drops into Next.js, Hono, Deno.serve,
 * Bun or a Cloudflare Worker. `./route.ts` is the Next.js App Router adapter.
 *
 * The trust rule: the browser may only ASK for a company. Who the user is and
 * which companies they belong to come from `authenticate`, which reads YOUR
 * server-side session. Nothing in the request body is ever used as the subject
 * or as an account reference without first being checked against that session.
 *
 * (Imports are relative so the tests can load this file from the repo. In your
 * own code write `import type { EmbedSessionClient } from "@w6w/sdk/server"`.)
 */
import type { EmbedSessionClient } from "../../src/server/mod.ts";

/** What your own sign-in knows about the caller. Built on the server only. */
export interface HostSession {
  /** Your user's id. It becomes the w6w `subject`. */
  userId: string;
  /** Every company (your external company id) this user may act in. */
  companyIds: readonly string[];
  /** The company the user is currently working in, when your app tracks one. */
  activeCompanyId?: string;
}

export interface EmbedSessionHandlerOptions {
  /** The session client. Only `create` is used. */
  sessions: Pick<EmbedSessionClient, "create">;
  /** Replace with your session lookup. Return `null` for an anonymous caller. */
  authenticate(req: Request): HostSession | null | Promise<HostSession | null>;
}

type ErrorCode =
  | "unauthenticated"
  | "company_required"
  | "company_forbidden"
  | "session_unavailable"
  | "method_not_allowed";

function reply(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...extra },
  });
}

function refuse(status: number, code: ErrorCode, extra?: Record<string, string>): Response {
  return reply(status, { error: { code } }, extra);
}

/**
 * The company the browser asks for. A hint only: anything that is not a
 * non-blank string is ignored, and a malformed or missing body is not an error.
 */
async function companyHint(req: Request): Promise<string | undefined> {
  try {
    const body: unknown = await req.json();
    if (body !== null && typeof body === "object") {
      const company = (body as { company?: unknown }).company;
      if (typeof company === "string" && company.trim() !== "") return company;
    }
  } catch {
    // No body, or not JSON: fall back to the session's active company.
  }
  return undefined;
}

export function createEmbedSessionHandler(
  o: EmbedSessionHandlerOptions,
): (req: Request) => Promise<Response> {
  return async (req) => {
    // 1. Only POST: a GET must never mint a token (links, prefetch, crawlers).
    if (req.method !== "POST") return refuse(405, "method_not_allowed", { allow: "POST" });

    try {
      // 2. Who is this? Decided by your server-side session, never the body.
      const session = await o.authenticate(req);
      if (!session) return refuse(401, "unauthenticated");

      // 3. Which company? The browser's hint wins, else the session's active one.
      const company = (await companyHint(req)) ?? session.activeCompanyId;
      if (company === undefined || company.trim() === "") return refuse(400, "company_required");

      // 4. The company must be one this user belongs to, per YOUR records.
      if (!session.companyIds.includes(company)) return refuse(403, "company_forbidden");

      // 5. Only now talk to w6w. `subject` and `accountRef` come from the
      //    verified session; `subject` / `accountRef` / `account` in the body
      //    are never read.
      const minted = await o.sessions.create({ subject: session.userId, accountRef: company });

      // 6. Hand the browser the session. It holds no client secret.
      return reply(200, minted);
    } catch {
      // Opaque on purpose: no upstream message, code or secret reaches the browser.
      // Log the real error on your server here.
      return refuse(502, "session_unavailable");
    }
  };
}
