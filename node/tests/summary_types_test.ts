/**
 * Type-level pins for the list-row summaries: `deno check` is the assertion.
 * The runtime test only keeps the file in the suite.
 */
import { assertEquals } from "@std/assert";
import type { FunctionSummary as PublicFunctionSummary } from "../src/types.ts";
import type { FunctionSummary } from "../src/console/functions.ts";
import type { EndpointSummary } from "../src/console/endpoints.ts";
import type { ReliabilityServiceMembers } from "../src/console/mod.ts";

Deno.test("summary types carry the list fields the server sends", () => {
  const publicArchived: PublicFunctionSummary["archivedAt"] = null as string | null;
  const consoleArchived: FunctionSummary["archivedAt"] = null as string | null;
  const endpointArchived: EndpointSummary["archivedAt"] = null as string | null;
  const status: EndpointSummary["status"] = "draft" as "draft" | "ready";
  const ready: EndpointSummary["status"] = "ready";
  // @ts-expect-error the union is closed
  const bad: EndpointSummary["status"] = "published";
  const incomplete: EndpointSummary["incomplete"] = true as boolean;
  const members: ReliabilityServiceMembers | undefined = undefined;
  assertEquals(
    [publicArchived, consoleArchived, endpointArchived, status, ready, bad, incomplete, members]
      .length,
    8,
  );
});
