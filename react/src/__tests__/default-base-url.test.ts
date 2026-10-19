/**
 * react's `DEFAULT_BASE_URL` is its own constant (not imported from the SDK);
 * this pins it to the shared contract's `defaultBaseUrl`, like the node lane's
 * conformance test.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { DEFAULT_BASE_URL } from "../../mod.ts";

const contractPath = fileURLToPath(new URL("../../../endpoints.json", import.meta.url));

test("DEFAULT_BASE_URL equals endpoints.json defaultBaseUrl", () => {
  const contract = JSON.parse(readFileSync(contractPath, "utf8")) as { defaultBaseUrl?: string };
  assert.equal(contract.defaultBaseUrl, "https://api.w6w.io");
  assert.equal(DEFAULT_BASE_URL, contract.defaultBaseUrl);
});
