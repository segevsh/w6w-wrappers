// Test-only, never published. Loaded by `test-jsx-loader.mjs`, so every test run gets it.
//
// Node 22's AssertionError renders a failing strictEqual / deepStrictEqual by inspecting BOTH
// operands with `{ depth: 1000, maxArrayLength: Infinity, sorted: true }` and myers-diffing the
// output, EVEN WHEN a custom message is passed. A rendered DOM node carries `__reactFiber$…`, so
// one such operand inspects the whole fiber tree, the QueryClient and the jsdom window. Measured
// 2026-10-17: `assert.equal(button, null, "saving leaked")` failing under a mutant grew one
// process at ~3.5 GB/s, mostly off-heap (so `--max-old-space-size` did not stop it), until the
// host ran out of RAM and swap.
//
// So before one of these assertions fails, measure its operands. Plain data that fits the budget
// keeps Node's own diff. Anything larger fails here with a bounded message and the assertion's own
// operator.
import assert from "node:assert";
import { syncBuiltinESMExports } from "node:module";
import { inspect, isDeepStrictEqual } from "node:util";

/** Values `inspect` may visit before an operand counts as too large to render. */
const BUDGET = 2_000;
const MAX_CHARS = 2_000;

/**
 * True when `v` reaches more than BUDGET values (own enumerable keys, array items, Map/Set entries).
 * Every OCCURRENCE counts, not every distinct object: inspect expands a shared reference each time it
 * meets one, so a small diamond-shaped graph renders exponentially. The budget also ends a cycle.
 */
function heavy(v) {
  if (v === null || typeof v !== "object") return false;
  const stack = [v];
  let visited = 0;
  while (stack.length > 0) {
    const cur = stack.pop();
    if (cur === null || typeof cur !== "object") continue;
    // A DOM node is a window into the whole document, and React's fiber keys are enumerable.
    if (typeof cur.nodeType === "number" && typeof cur.nodeName === "string") return true;
    let kids;
    try {
      kids =
        cur instanceof Map
          ? [...cur.keys(), ...cur.values()]
          : cur instanceof Set
            ? [...cur]
            : Reflect.ownKeys(cur)
                .filter((k) => Object.prototype.propertyIsEnumerable.call(cur, k))
                .map((k) => cur[k]);
    } catch {
      return true; // a throwing getter or a revoked proxy: never hand it to inspect
    }
    visited += kids.length + 1;
    if (visited > BUDGET) return true;
    stack.push(...kids);
  }
  return false;
}

function brief(v) {
  if (v !== null && typeof v === "object" && typeof v.nodeType === "number") {
    const html = typeof v.outerHTML === "string" ? v.outerHTML : String(v.textContent ?? "");
    return `<${v.nodeName}> ${html.length > 300 ? `${html.slice(0, 300)}…` : html}`;
  }
  let s;
  try {
    s = inspect(v, { depth: 2, maxArrayLength: 20, maxStringLength: 200, breakLength: 120 });
  } catch {
    s = Object.prototype.toString.call(v);
  }
  return s.length > MAX_CHARS ? `${s.slice(0, MAX_CHARS)}…` : s;
}

function failBounded(operator, actual, expected, message, stackStartFn) {
  if (message instanceof Error) throw message;
  const head = message ?? `Expected values to satisfy ${operator}`;
  const err = new assert.AssertionError({
    message: `${head}\n\nactual:   ${brief(actual)}\nexpected: ${brief(expected)}\n(operands too large to diff; see test-assert-guard.mjs)`,
    operator: "fail", // a custom message on "fail" is used as-is: no inspect, no diff
    stackStartFn,
  });
  err.operator = operator;
  err.actual = brief(actual);
  err.expected = brief(expected);
  throw err;
}

// [method, operator, does it fail?]
const SPECS = [
  ["strictEqual", "strictEqual", (a, b) => !Object.is(a, b)],
  ["notStrictEqual", "notStrictEqual", (a, b) => Object.is(a, b)],
  ["deepStrictEqual", "deepStrictEqual", (a, b) => !isDeepStrictEqual(a, b)],
  ["notDeepStrictEqual", "notDeepStrictEqual", (a, b) => isDeepStrictEqual(a, b)],
  // biome-ignore lint/suspicious/noDoubleEquals: legacy `assert.equal` is `==` by definition
  ["equal", "==", (a, b) => !(a == b || (Number.isNaN(a) && Number.isNaN(b)))],
  // biome-ignore lint/suspicious/noDoubleEquals: legacy `assert.notEqual` is `!=` by definition
  ["notEqual", "!=", (a, b) => a == b || (Number.isNaN(a) && Number.isNaN(b))],
];

function guard(target, method, operator, fails) {
  const original = target[method];
  if (typeof original !== "function" || original.__w6wGuarded) return;
  const wrapped = function (...args) {
    // Fewer than two arguments is Node's own ERR_MISSING_ARGS: let it throw that.
    if (args.length < 2) return original.apply(this, args);
    const [actual, expected, message] = args;
    if (fails(actual, expected) && (heavy(actual) || heavy(expected))) {
      failBounded(operator, actual, expected, message, wrapped);
    }
    return original.apply(this, args);
  };
  wrapped.__w6wGuarded = true;
  target[method] = wrapped;
}

for (const [method, operator, fails] of SPECS) {
  guard(assert, method, operator, fails);
  // `node:assert/strict` is a separate object whose equal / deepEqual / notEqual are the strict ones.
  const strictOp =
    method === "equal" ? "strictEqual" : method === "notEqual" ? "notStrictEqual" : operator;
  const strictFails =
    method === "equal" ? SPECS[0][2] : method === "notEqual" ? SPECS[1][2] : fails;
  guard(assert.strict, method, strictOp, strictFails);
}
guard(assert.strict, "deepEqual", "deepStrictEqual", SPECS[2][2]);
guard(assert.strict, "notDeepEqual", "notDeepStrictEqual", SPECS[3][2]);

// Named imports (`import { equal } from "node:assert/strict"`) read the ESM facade, not the object.
syncBuiltinESMExports();
