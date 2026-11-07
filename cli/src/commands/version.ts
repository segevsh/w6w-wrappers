/**
 * `w6w version` and `w6w --version` / `-v` — one handler, versions only.
 *
 * Prints this CLI's own version plus the server's `version` and `composition`,
 * and **no identity**: nothing here says who the caller is (that is `w6w me`).
 * The server half comes from `GET <resolved base URL>/version`, which is
 * unauthenticated — so **no `Authorization` header is ever sent**, whatever
 * token a flag, the environment or the store holds, and a missing token is
 * irrelevant. The request is bounded by {@linkcode VERSION_TIMEOUT_MS}.
 *
 * It **never fails**. An invalid base URL, an unreadable store, a refused
 * connection, a timeout, a non-2xx, a body that is not JSON or lacks string
 * `version`/`composition` — each makes the server *unavailable*, reported as
 * `server: unavailable (<reason>)`, and the exit code is still 0. A banner that
 * could break a script because the server is down would be worse than no banner.
 *
 * Text applies the D5 display rule (`0.0.0` / empty shows as `dev`, shared with
 * `w6w me`); `--json` carries the raw values, through the normal emit path:
 * `{wrapper, server | null, composition | null, serverError?}`.
 *
 * @module
 */

import type { CommandContext } from "../../mod.ts";
import { resolveSettings } from "../client.ts";
import type { Styles } from "../output.ts";
import { displayVersion } from "./shared.ts";
import type { FetchLike } from "@w6w/sdk";

/** How long the `/version` request may take before the server counts as unavailable. */
export const VERSION_TIMEOUT_MS = 3000;

/** What `/version` told us, or why it could not. */
type ServerVersions =
  | { ok: true; version: string; composition: string }
  | { ok: false; reason: string };

/** The first line of an error's message, short enough to sit in parentheses. */
function reasonOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const line = text.split("\n")[0].trim();
  return line.length > 0 ? line.slice(0, 120) : "request failed";
}

async function fetchServerVersions(
  context: Pick<CommandContext, "invocation" | "env" | "store" | "stored">,
  fetchImpl: FetchLike,
): Promise<ServerVersions> {
  let baseUrl: string;
  try {
    // The resolver also resolves a token; a token it refuses (unsendable) is a
    // reason unrelated to this command, so it is deliberately not our problem:
    // retry the base URL alone with the token sources stripped.
    baseUrl = resolveSettings(
      { ...context.invocation.globals, token: undefined },
      (name) => name === "W6W_TOKEN" ? undefined : context.env(name),
      { ...context.stored, hosts: {} },
    ).baseUrl;
  } catch (error) {
    return { ok: false, reason: reasonOf(error) };
  }

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`timed out after ${VERSION_TIMEOUT_MS / 1000}s`));
      controller.abort();
    }, VERSION_TIMEOUT_MS);
  });
  try {
    // Explicitly header-free: no Authorization, no credentials of any kind.
    const response = await Promise.race([
      fetchImpl(`${baseUrl}/version`, {
        method: "GET",
        headers: { accept: "application/json" },
        signal: controller.signal,
      }),
      timeout,
    ]);
    if (!response.ok) return { ok: false, reason: `HTTP ${response.status}` };
    let body: unknown;
    try {
      body = await Promise.race([response.json(), timeout]);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("timed out")) throw error;
      return { ok: false, reason: "response was not JSON" };
    }
    const record = typeof body === "object" && body !== null && !Array.isArray(body)
      ? body as Record<string, unknown>
      : {};
    if (typeof record.version !== "string" || typeof record.composition !== "string") {
      return { ok: false, reason: "unexpected response" };
    }
    return { ok: true, version: record.version, composition: record.composition };
  } catch (error) {
    return { ok: false, reason: reasonOf(error) };
  } finally {
    clearTimeout(timer);
  }
}

/** The inputs the shared handler needs; a `CommandContext` minus the client. */
export type VersionContext = Pick<
  CommandContext,
  "invocation" | "env" | "store" | "stored" | "out"
>;

/**
 * Report the wrapper and server versions. Always returns normally.
 *
 * @param context - The invocation, renderer, environment and stored config.
 * @param wrapper - This CLI's own version.
 * @param fetchImpl - The transport; defaults to `globalThis.fetch`.
 */
export async function reportVersions(
  context: VersionContext,
  wrapper: string,
  fetchImpl?: FetchLike,
): Promise<void> {
  const transport: FetchLike = fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  const server = await fetchServerVersions(context, transport);
  const payload: Record<string, unknown> = {
    wrapper,
    server: server.ok ? server.version : null,
    composition: server.ok ? server.composition : null,
  };
  if (!server.ok) payload.serverError = server.reason;
  context.out.emit(payload, (_styles: Styles) => {
    const lines = [`wrapper: ${displayVersion(wrapper)}`];
    if (server.ok) {
      lines.push(
        `server: ${displayVersion(server.version)}`,
        `composition: ${displayVersion(server.composition)}`,
      );
    } else {
      lines.push(`server: unavailable (${server.reason})`);
    }
    return lines.join("\n");
  });
}
