/**
 * Types for `app-assemble.js`, the vendored build of core's
 * `packages/app-build/assemble.ts` (`npm run vendor:assemble`). Hand-written: keep it to
 * exactly the API that file exports.
 */

/** Size caps; both default to core's own limits. */
export interface AssembleOptions {
  maxAssetBytes?: number;
  maxAppAssetBytes?: number;
}

/** What one successful assembly produced. */
export interface BuildResult {
  id: string;
  version: string;
  execSha256: string;
  digest: string;
  digestVersion: 1 | 2;
  sourceDigest: string;
  /** `<outRoot>/<id>/<version>`, absolute. */
  outDir: string;
  warnings?: string[];
  /** Counts behind the output-contract warnings; absent when all are zero. */
  outputWarnings?: Record<string, number>;
}

/** A refusal: `code` is the stable machine-readable reason; `message` reads `[code] …`. */
export declare class BuildError extends Error {
  readonly code: string;
  /** The app directory the refusal concerns, as given by the caller. */
  readonly appDir: string;
  constructor(code: string, message: string, appDir: string);
}

/** Core's default per-asset byte cap. */
export declare const MAX_ASSET_BYTES: number;
/** Core's default per-app inlined-asset byte cap. */
export declare const MAX_APP_ASSET_BYTES: number;

/** Package one prebuilt app into `<outRoot>/<id>/<version>/{app.js,manifest.json[,app.js.map]}`. */
export declare function assembleApp(
  appDir: string,
  outRoot: string,
  opts?: AssembleOptions,
): Promise<BuildResult>;

/** Every check `assembleApp` runs, writing nothing. */
export declare function validateAssembled(
  appDir: string,
  opts?: AssembleOptions,
): Promise<
  | { ok: true; id: string; version: string }
  | { ok: false; errors: { code: string; message: string }[] }
>;
