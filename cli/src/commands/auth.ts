/**
 * `w6w auth login | logout | status` — the stored API token.
 *
 * Declared in `endpoints.json` `cli.commands[]` (CLI-only: no API operation sits
 * behind them) and routed like any other group. None of them touches the
 * network, and none ever prints a token.
 *
 * The token is **bound to the base URL it is saved for**. All three commands
 * resolve that URL through the one resolver in `src/client.ts`
 * ({@linkcode resolveSettings}), the same code a real command uses, so
 * `auth status` reports exactly what the next command will do.
 *
 * `login` takes the token as a positional (`w6w auth login <token>`) or from
 * standard input (`w6w auth login -`, or no argument with piped input). The
 * stdin form is the safer one: a positional lands in shell history and in the
 * process list. `login` never stores the global `--token` or `W6W_TOKEN` — they
 * are overrides, not credentials to save.
 *
 * @module
 */

import { ConfigError } from "@w6w/sdk";
import type { CommandContext, CommandHandler, CommandRegistry } from "../../mod.ts";
import { ENV_TOKEN, isUnsendable, resolveSettings } from "../client.ts";
import { serializeConfig, type StoredConfig } from "../config-store.ts";
import { noExtraArguments, usageError } from "./shared.ts";

/** The base URL these commands act on: flag > env > stored > default, never the token sources. */
function resolveBase(context: CommandContext) {
  const { globals } = context.invocation;
  return resolveSettings(
    { ...globals, token: undefined },
    (name) => (name === ENV_TOKEN ? undefined : context.env(name)),
    context.stored,
  );
}

/** `"****"` plus the last four characters of a long-enough token, else just `"****"`. */
function mask(token: string): string {
  return token.length >= 12 ? `****${token.slice(-4)}` : "****";
}

function requirePath(context: CommandContext): string {
  const path = context.store.path;
  if (path === undefined) {
    throw new ConfigError(
      "w6w cannot tell where to keep its config: neither XDG_CONFIG_HOME (an absolute path) " +
        "nor HOME is set. Nothing was saved.",
    );
  }
  return path;
}

const login: CommandHandler = async (context) => {
  noExtraArguments(context, 1);
  const positional = context.invocation.positionals[0];

  let token: string;
  if (positional === "-" || (positional === undefined && !context.stdin.isTerminal())) {
    // One trailing newline is the shell's, not the token's.
    token = (await context.stdin.read()).replace(/\r?\n$/, "");
  } else if (positional === undefined) {
    throw usageError(
      context,
      "`auth login` needs a token. Pass it as an argument, or pipe it in: " +
        "`printf '%s' \"$TOKEN\" | w6w auth login -`.",
    );
  } else {
    token = positional;
  }

  if (token.trim().length === 0) {
    throw usageError(context, "The token is empty; nothing was saved.");
  }
  if (isUnsendable(token)) {
    throw usageError(
      context,
      "The token contains a character that cannot be sent in an HTTP header " +
        "(a control character); nothing was saved.",
    );
  }

  const { baseUrl } = resolveBase(context);
  const path = requirePath(context);
  const next: StoredConfig = {
    version: 1,
    baseUrl,
    hosts: { ...context.stored.hosts, [baseUrl]: { token } },
  };
  await context.store.write(serializeConfig(next));
  context.out.emit(
    { baseUrl, configPath: path },
    () => `Saved the API token for ${baseUrl} in ${path}.`,
  );
};

const logout: CommandHandler = async (context) => {
  noExtraArguments(context, 0);
  const { baseUrl } = resolveBase(context);
  const had = Object.hasOwn(context.stored.hosts, baseUrl);
  if (had) {
    requirePath(context);
    const hosts = { ...context.stored.hosts };
    delete hosts[baseUrl];
    await context.store.write(
      serializeConfig({ version: 1, baseUrl: context.stored.baseUrl, hosts }),
    );
  }
  context.out.emit(
    { baseUrl, removed: had },
    () =>
      had
        ? `Removed the stored API token for ${baseUrl}.`
        : `No stored API token for ${baseUrl}; nothing to remove.`,
  );
};

const status: CommandHandler = (context) => {
  noExtraArguments(context, 0);
  const settings = resolveSettings(context.invocation.globals, context.env, context.stored);
  const payload = {
    baseUrl: settings.baseUrl,
    baseUrlSource: settings.baseUrlSource,
    tokenSource: settings.tokenSource ?? null,
    tokenMasked: settings.token === undefined ? null : mask(settings.token),
    configPath: context.store.path ?? null,
  };
  context.out.emit(payload, (styles) =>
    [
      `${styles.bold("base URL")}  ${payload.baseUrl} (${payload.baseUrlSource})`,
      `${styles.bold("token")}     ${
        payload.tokenSource === null
          ? "none — run `w6w auth login`"
          : `${payload.tokenMasked} (${payload.tokenSource})`
      }`,
      `${styles.bold("config")}    ${payload.configPath ?? "(no config directory)"}`,
    ].join("\n"));
};

/** The three `w6w auth` commands. */
export const AUTH_COMMANDS: CommandRegistry = {
  "auth login": login,
  "auth logout": logout,
  "auth status": status,
};
