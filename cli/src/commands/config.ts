/**
 * `w6w config get-base-url | set-base-url <url>` — the stored API base URL.
 *
 * Declared in `endpoints.json` `cli.commands[]` (CLI-only: no API operation sits
 * behind them). Neither touches the network, and neither ever prints a token.
 *
 * Both resolve the URL through the one resolver in `src/client.ts`
 * ({@linkcode resolveSettings}), so `get-base-url` reports exactly what the next
 * command will use, and `set-base-url` stores exactly the canonical form that
 * resolver produces (and that `hosts` is keyed by).
 *
 * `set-base-url` rewrites only `baseUrl`. It never copies, moves or re-keys a
 * token: a token saved for host A is never sent to host B, so after switching
 * hosts the new one needs its own `w6w auth login`.
 *
 * @module
 */

import { joinBaseUrl } from "@w6w/sdk";
import type { CommandHandler, CommandRegistry } from "../../mod.ts";
import { ENV_BASE_URL, ENV_TOKEN, envValue, resolveSettings } from "../client.ts";
import { serializeConfig } from "../config-store.ts";
import { argument, noExtraArguments } from "./shared.ts";

const getBaseUrl: CommandHandler = (context) => {
  noExtraArguments(context, 0);
  // The token sources are irrelevant here; hide them so a bad token never blocks a read.
  const settings = resolveSettings(
    { ...context.invocation.globals, token: undefined },
    (name) => (name === ENV_TOKEN ? undefined : context.env(name)),
    context.stored,
  );
  const configBaseUrl = context.stored.baseUrl.trim().length > 0
    ? context.stored.baseUrl
    : undefined;
  const payload = {
    baseUrl: settings.baseUrl,
    baseUrlSource: settings.baseUrlSource,
    ...(configBaseUrl === undefined ? {} : { configBaseUrl }),
    configPath: context.store.path ?? null,
  };
  context.out.emit(payload, () => `${payload.baseUrl} (${payload.baseUrlSource})`);
};

const setBaseUrl: CommandHandler = async (context) => {
  const raw = argument(context, 0, "a base URL, like `https://api.example.com`");
  noExtraArguments(context, 1);
  // Validate and canonicalise with the one resolver: the positional stands in for the flag.
  const { baseUrl } = resolveSettings({
    ...context.invocation.globals,
    baseUrl: raw,
    token: undefined,
  });
  const path = context.store.path;
  if (path === undefined) {
    throw new Error(
      "w6w cannot tell where to keep its config: neither XDG_CONFIG_HOME (an absolute path) " +
        "nor HOME is set. Nothing was saved.",
    );
  }
  await context.store.write(
    serializeConfig({ version: 1, baseUrl, hosts: context.stored.hosts }),
  );
  context.out.emit(
    { baseUrl, configPath: path },
    () => `Saved ${baseUrl} as the base URL in ${path}.`,
  );

  const fromEnv = envValue(context.env, ENV_BASE_URL);
  if (fromEnv !== undefined) {
    let envCanonical: string;
    try {
      envCanonical = joinBaseUrl(fromEnv.trim());
    } catch {
      envCanonical = fromEnv;
    }
    if (envCanonical !== baseUrl) {
      // stderr, so `--json` stdout stays one parseable document.
      context.out.error(
        `${ENV_BASE_URL} is set to ${fromEnv} and still takes precedence over the saved base URL.`,
      );
    }
  }
};

/** The two `w6w config` commands. */
export const CONFIG_COMMANDS: CommandRegistry = {
  "config get-base-url": getBaseUrl,
  "config set-base-url": setBaseUrl,
};
