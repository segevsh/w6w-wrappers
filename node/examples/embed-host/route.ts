/**
 * Next.js App Router adapter: save as `app/api/w6w-session/route.ts`.
 *
 * No `next` import is needed: an App Router route handler is a function from a
 * standard `Request` to a standard `Response`. The session client is built on
 * the first request, so importing this module (for example during `next build`)
 * never reads the environment or throws.
 */
import { createEmbedSessionClient } from "@w6w/sdk/server";
import { createEmbedSessionHandler, type HostSession } from "./handler.ts";

type Env = Record<string, string | undefined>;

/** Replace with your session lookup (cookie, JWT, your auth library). */
function authenticate(_req: Request): HostSession | null {
  // Example only: return null until you wire in your own sign-in. Read the
  // user and their companies from YOUR server-side records, never from the request.
  return null;
}

/**
 * Your API origin from `W6W_BASE_URL`, or `undefined` when it is unset or blank so the helper
 * uses its default (`https://api.w6w.io`). Self-hosted? Set `W6W_BASE_URL`: when omitted, the
 * tenant client credentials are sent to `https://api.w6w.io`.
 */
export function baseUrlFromEnv(env: Env): string | undefined {
  return env.W6W_BASE_URL?.trim() ? env.W6W_BASE_URL : undefined;
}

let handler: ((req: Request) => Promise<Response>) | undefined;

export function POST(req: Request): Promise<Response> {
  try {
    if (!handler) {
      const env = (globalThis as { process?: { env: Env } }).process?.env ?? {};
      handler = createEmbedSessionHandler({
        sessions: createEmbedSessionClient({
          baseUrl: baseUrlFromEnv(env),
          clientId: env.W6W_TENANT_CLIENT_ID ?? "",
          clientSecret: env.W6W_TENANT_CLIENT_SECRET ?? "",
        }),
        authenticate,
      });
    }
  } catch {
    // Missing or malformed credentials: log the ConfigError on your server.
    return Promise.resolve(
      new Response(JSON.stringify({ error: { code: "session_unavailable" } }), {
        status: 502,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      }),
    );
  }
  return handler(req);
}
