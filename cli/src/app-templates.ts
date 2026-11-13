/**
 * Bundled `apps init` templates (string constants, no network).
 *
 * Skeleton: the file sets are filled in by a later slice.
 *
 * @module
 */

/** The two scaffold variants. */
export type TemplateName = "deno" | "node";

/** The app-id grammar `apps init` accepts. */
export const APP_ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/** The exact `deno.json` imports every template carries (pinned P3). */
export const TEMPLATE_IMPORTS: Record<string, string> = {
  "@w6w/types": "jsr:@w6w/types@0.2.0",
  "@w6w/runtime/author": "jsr:@w6w/runtime@0.2.0/author",
  "@w6w/app-kit/poll": "jsr:@w6w/app-kit@0.1.0/poll",
};

/** Relative path → file content, for `template` with `id` substituted. */
export function templateFiles(_template: TemplateName, _id: string): Record<string, string> {
  throw new Error("not implemented");
}
