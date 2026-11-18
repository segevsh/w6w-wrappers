/**
 * Type-level assertions against `src/types.ts`, made runtime-observable.
 *
 * A plain compile-time check (`const s: WorkflowStatus = "archived"`) with no
 * corresponding `test` would never run and could bit-rot silently; wiring
 * it into an assertion means `npm run typecheck` fails loudly the moment a
 * mutant narrows the union back, and `npm test` still reports it as one
 * more passing assertion today.
 */

import { test } from "node:test";
import { assertEquals } from "./assert.ts";
import type { WorkflowStatus } from "../src/types.ts";

test("WorkflowStatus includes archived", () => {
  // Fails `npm run typecheck` if the union narrows back to "draft" | "active" —
  // a mutant reverting T2.5.1's widening is a compile error here, not just a
  // runtime assertion that could pass by accident.
  const s: WorkflowStatus = "archived";
  assertEquals(s, "archived");
});
