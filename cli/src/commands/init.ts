/**
 * `w6w apps init <id> [--template deno|node] [--dir <path>]` — scaffold a new w6w app
 * from a bundled template. Offline; refuses a non-empty target directory.
 *
 * @module
 */

import type { CommandHandler, CommandRegistry } from "../../mod.ts";
import { APP_ID, templateFiles, type TemplateName } from "../app-templates.ts";
import { argument, noExtraArguments, textFlag, usageError } from "./shared.ts";

/** The slice of `node:fs/promises` + `node:path` init uses (imported by variable: no host types). */
interface Host {
  readdir(path: string): Promise<string[]>;
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  writeFile(path: string, data: string): Promise<void>;
  dirname(path: string): string;
  join(...parts: string[]): string;
  resolve(...parts: string[]): string;
}

async function host(): Promise<Host> {
  const fsName = "node:fs/promises";
  const pathName = "node:path";
  const fs = await import(fsName);
  const path = await import(pathName);
  return {
    readdir: fs.readdir,
    mkdir: fs.mkdir,
    writeFile: fs.writeFile,
    dirname: path.dirname,
    join: path.join,
    resolve: path.resolve,
  };
}

/**
 * The id to suggest for a rejected one: `com.example.<slug>`, where the slug is the
 * rejected id folded into the builder's segment alphabet (`[a-z0-9-]`). Never silently
 * applied — the error only names it.
 */
export function suggestId(id: string): string {
  const slug = id.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `com.example.${slug === "" ? "my-app" : slug}`;
}

const appsInit: CommandHandler = async (context) => {
  const id = argument(context, 0, "an app id (e.g. com.example.demo-app)");
  noExtraArguments(context, 1);
  if (!APP_ID.test(id)) {
    throw usageError(
      context,
      `\`${id}\` is not a valid app id: the builder needs a dotted reverse-DNS id — ` +
        `lowercase letters, digits and hyphens, in two or more dot-separated segments ` +
        `(e.g. \`com.example.my-app\`). Try \`${suggestId(id)}\`.`,
    );
  }
  const template = textFlag(context, "template") ?? "deno";
  if (template !== "deno" && template !== "node") {
    throw usageError(context, `\`--template\` must be \`deno\` or \`node\`, not \`${template}\`.`);
  }
  const h = await host();
  const target = h.resolve(textFlag(context, "dir") ?? id);

  let entries = 0;
  try {
    entries = (await h.readdir(target)).length;
  } catch (error) {
    if ((error as { code?: string }).code !== "ENOENT") throw error;
  }
  if (entries > 0) {
    throw new Error(`\`${target}\` is not empty; refusing to scaffold into it.`);
  }

  const files = templateFiles(template as TemplateName, id);
  for (const [path, body] of Object.entries(files)) {
    const full = h.join(target, path);
    await h.mkdir(h.dirname(full), { recursive: true });
    await h.writeFile(full, body);
  }
  const written = Object.keys(files);
  context.out.emit(
    { id, template, dir: target, files: written },
    () => `created ${id} (${template}) in ${target}\n  ${written.join("\n  ")}`,
  );
};

/** `w6w apps init`. */
export const INIT_COMMANDS: CommandRegistry = {
  "apps init": appsInit,
};
