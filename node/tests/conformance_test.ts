/**
 * Conformance: this lane's surface, checked against the shared contract.
 *
 * `docs/implementation.md` §10 requires every wrapper to carry a conformance
 * test, and `docs/parity.md` §Conformance states the same rule in the same
 * words. It is the drift alarm for the actual failure mode the lockstep bet
 * exists to prevent: **an operation added to two wrappers and forgotten in the
 * third.**
 *
 * `../endpoints.json` — this lane's sibling, read from THIS FILE's location and
 * never from the process working directory — names every operation all three
 * wrappers must expose, and the symbol each language must expose it as. This
 * file walks `operations[].naming.ts`, resolves each one on a constructed
 * client, and asserts the symbol exists and is **callable**.
 *
 * It **exempts nothing**: `status` records *server* readiness, not wrapper
 * obligation, so a `planned` operation is asserted exactly like a `required`
 * one (§10, §"The runner exempts nothing").
 *
 * If the contract is missing, the test **FAILS naming the path it looked for**;
 * it never skips, and it never falls back to a copy vendored inside this lane.
 * A guard that quietly passes when its input is missing is worse than no guard,
 * and a vendored copy goes stale silently — which defeats the whole mechanism.
 * A standalone clone therefore has to check the contract out beside it, which
 * is exactly what its CI job does.
 *
 * **This runner is separate from `surface_test.ts` on purpose.** That file pins
 * the barrel's export list and the *types* of what it exports; this one pins the
 * contract-to-client mapping. They fail for different reasons and a merge that
 * breaks one must not be able to hide behind the other.
 *
 * No case below makes a network call: the client is constructed with a dummy
 * base URL and token, and nothing is invoked.
 */

import { assert, assertEquals } from "@std/assert";
import { W6WClient } from "../mod.ts";

/** The shared contract, beside this lane — `packages/wrappers/endpoints.json`. */
const CONTRACT_URL = new URL("../../endpoints.json", import.meta.url);

/**
 * Every operation the contract lists, whatever its `status`.
 *
 * Declared structurally, and only as far as this runner reads it: the runner
 * resolves `naming.ts` and nothing else, so the rest of an entry is
 * deliberately not modelled here.
 */
interface Operation {
  /** The operation's dotted id, e.g. `documents.getByKey`. */
  name: string;
  /** The symbol this lane must expose it as — `naming.ts`, never `naming.node`. */
  naming: { ts: string };
}

interface Contract {
  operations: Operation[];
}

/**
 * Read the shared contract, or fail loudly naming where it looked.
 *
 * @returns The parsed `endpoints.json`.
 * @throws {Error} When the contract is not beside this lane.
 */
async function loadContract(): Promise<Contract> {
  let text: string;
  try {
    text = await Deno.readTextFile(CONTRACT_URL);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      throw new Error(
        `conformance: the wrappers' shared contract was not found at ${CONTRACT_URL.pathname}. ` +
          "It is a sibling of this lane (`../endpoints.json` from the lane root, so " +
          "`../../endpoints.json` from this test file) because that is what makes the answer " +
          "identical in CI, on a laptop, and inside the monorepo's submodule. Check it out " +
          "beside the lane rather than vendoring a copy — a vendored contract goes stale " +
          "silently and defeats the mechanism.",
      );
    }
    throw err;
  }
  return JSON.parse(text) as Contract;
}

/**
 * Resolve a `naming.ts` string to the attribute path it names.
 *
 * Pinned by `docs/implementation.md` §10 so all three runners agree:
 *
 * 1. truncate at the first `(`;
 * 2. drop the leading `client.`;
 * 3. split the remainder on `.`.
 *
 * ::
 *
 *     "client.documents.getByKey(key, opts?)" -> ["documents", "getByKey"]
 *
 * @param naming - The `naming.ts` entry of one operation.
 * @returns The attribute path from a client instance.
 */
function attributePath(naming: string): string[] {
  let symbol = naming.split("(", 1)[0].trim();
  const prefix = "client.";
  if (symbol.startsWith(prefix)) symbol = symbol.slice(prefix.length);
  return symbol.split(".");
}

/** The symbol a `naming.ts` string names, with the call signature cut off. */
function symbolOf(naming: string): string {
  return naming.split("(", 1)[0].trim();
}

/** `` `client.a.b` `` for the first `length` steps of an attribute path. */
function prefix(path: string[], length: number): string {
  return `\`client.${path.slice(0, length).join(".")}\``;
}

/**
 * Walk an attribute path from a client instance, asserting each step exists
 * and that the final attribute is **callable** (§10's pinned algorithm).
 *
 * @param client - A constructed client; nothing here invokes anything.
 * @param path - The attribute path, e.g. `["documents", "getByKey"]`.
 * @returns Why the path did not resolve, or `null` when it did.
 */
function unresolved(client: W6WClient, path: string[]): string | null {
  let target: unknown = client;
  for (let index = 0; index < path.length; index += 1) {
    if (typeof target !== "object" || target === null) {
      return `${prefix(path, index)} is not an object`;
    }
    const next = (target as Record<string, unknown>)[path[index]];
    if (next === undefined || next === null) {
      return `${prefix(path, index + 1)} is missing`;
    }
    target = next;
  }
  if (typeof target !== "function") {
    return `${prefix(path, path.length)} is not callable`;
  }
  return null;
}

/**
 * §10's failure message: it names the operation AND the symbol that was looked
 * for, so a red run answers "which line do I fix" without a second command.
 *
 * @param operation - The contract entry that did not resolve.
 * @param reason - What went wrong on the way down the path.
 * @returns The one-line assertion message.
 */
function failureMessage(operation: Operation, reason: string): string {
  return `conformance: operation \`${operation.name}\` is not reachable — expected ` +
    `\`${symbolOf(operation.naming.ts)}\` (from endpoints.json naming.ts) — ${reason}`;
}

Deno.test("the contract lists operations this runner can walk", async () => {
  // The two properties every case below depends on: the contract is readable,
  // and it names a `naming.ts` symbol for every operation it lists. Without
  // this, an empty or mis-keyed `operations[]` would make the walk below assert
  // nothing at all and still pass — a guard that quietly does nothing.
  const contract = await loadContract();

  assert(
    contract.operations.length > 0,
    "conformance: the contract lists no operations, so the walk below would assert nothing",
  );
  assertEquals(
    contract.operations.length,
    36,
    "conformance: the contract's operation count changed. Extend this lane (and its " +
      "version guard) in the same change, then update this pin — it exists so a " +
      "truncated or half-merged contract cannot silently shrink the walk.",
  );
  for (const operation of contract.operations) {
    assert(
      typeof operation.naming?.ts === "string" && operation.naming.ts.length > 0,
      `conformance: operation \`${operation.name}\` has no \`naming.ts\` string. The node ` +
        "runner reads `naming.ts`; there is no `naming.node` key in the contract.",
    );
  }
});

Deno.test("every contracted operation is reachable and callable on a client", async () => {
  const contract = await loadContract();
  const client = new W6WClient({
    baseUrl: "https://api.example.com",
    token: "tok_conformance",
  });

  const failures: string[] = [];
  for (const operation of contract.operations) {
    // `status` records server readiness, not wrapper obligation: `planned`
    // operations are asserted exactly like the rest.
    const reason = unresolved(client, attributePath(operation.naming.ts));
    if (reason !== null) failures.push(failureMessage(operation, reason));
  }

  assertEquals(
    failures,
    [],
    `operations not reachable on a constructed client:\n${failures.join("\n")}`,
  );
});

Deno.test("the runner resolves the pinned shapes, including a missing symbol", () => {
  // The walk itself is pinned, so a change to the resolution algorithm cannot
  // make every path above resolve trivially. The negative case is the one that
  // matters: it is exactly the mutation a drift alarm has to catch — a
  // `naming.ts` that names a symbol the client does not have.
  const client = new W6WClient({
    baseUrl: "https://api.example.com",
    token: "tok_conformance",
  });

  assertEquals(attributePath("client.documents.getByKey(key, opts?)"), ["documents", "getByKey"]);
  // A call at the root: `client.me()` -> `["me"]`.
  assertEquals(attributePath("client.me()"), ["me"]);
  // A three-step path: namespaces are walked, not guessed.
  assertEquals(attributePath("client.team.members()"), ["team", "members"]);

  assertEquals(unresolved(client, ["documents", "getByKey"]), null);
  assertEquals(unresolved(client, ["me"]), null);
  assertEquals(
    unresolved(client, ["workflows", "listX"]),
    "`client.workflows.listX` is missing",
  );
  // `documents` is a namespace object, not something a caller invokes.
  assertEquals(unresolved(client, ["documents"]), "`client.documents` is not callable");
  assertEquals(unresolved(client, ["nope", "deeper"]), "`client.nope` is missing");
  assert(
    failureMessage(
      { name: "workflows.list", naming: { ts: "client.workflows.listX()" } },
      "`client.workflows.listX` is missing",
    ).startsWith(
      "conformance: operation `workflows.list` is not reachable — expected " +
        "`client.workflows.listX` (from endpoints.json naming.ts)",
    ),
  );
});
