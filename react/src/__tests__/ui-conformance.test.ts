/**
 * Runs `tsconfig.ui-conformance.json` (which compiles ONLY
 * `ui-conformance.check.ts`, see that file's header) as a real `tsc`
 * subprocess and asserts it exits `0` — the CI-run enforcement R-8 needs:
 * `release.yml`'s react step runs `npm test` only, no bare `tsc`, and
 * `tsconfig.json` excludes `src/__tests__`, so without this test the
 * type-only conformance check would never actually run in CI.
 *
 * Spawns TypeScript's own bin via `process.execPath` (the same Node this
 * test itself runs under) rather than shelling out to a `tsc` on `$PATH` —
 * this package's own pinned `typescript` devDependency is the one version
 * this check is meant to run under.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const reactRoot = fileURLToPath(new URL("../..", import.meta.url));
const tscBin = fileURLToPath(new URL("../../node_modules/typescript/bin/tsc", import.meta.url));

test("ui-conformance: createW6WUiAdapter's return type satisfies the real @w6w/ui W6WApi", () => {
  const result = spawnSync(process.execPath, [tscBin, "-p", "tsconfig.ui-conformance.json"], {
    cwd: reactRoot,
    encoding: "utf8",
  });

  assert.equal(
    result.status,
    0,
    `tsc -p tsconfig.ui-conformance.json failed (exit ${result.status}) — createW6WUiAdapter's return type no longer satisfies @w6w/ui's real W6WApi. tsc output:\n${result.stdout}${result.stderr}`,
  );
});
