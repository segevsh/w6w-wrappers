/**
 * Pins `test-assert-guard.mjs` (loaded by `test-jsx-loader.mjs`): a failing equality assertion on a
 * DOM node or a large graph fails FAST with a bounded message, instead of Node inspecting the
 * operand at depth 1000 and myers-diffing it (2026-10-17: ~3.5 GB/s off-heap per process, host OOM).
 *
 * Every graph here is small enough that, were the guard missing, Node would still render it in well
 * under a second. Those tests then fail on the message LENGTH instead of taking the host down.
 */
import legacy from "node:assert";
import assert from "node:assert/strict";
import { equal as namedEqual } from "node:assert/strict";
import { test } from "node:test";

const BOUND = 5_000;

/** Stands in for a rendered element: a DOM-shaped node whose enumerable fiber key reaches a big graph. */
function fakeRenderedNode() {
  const fiber: Record<string, unknown> = {};
  let cur = fiber;
  for (let i = 0; i < 3_000; i++) {
    const next: Record<string, unknown> = { tag: i, memoizedProps: { i } };
    cur.child = next;
    cur = next;
  }
  return {
    nodeType: 1,
    nodeName: "BUTTON",
    outerHTML: '<button type="button">Saving…</button>',
    __reactFiber$abc: fiber,
  };
}

function bigPlain() {
  const o: Record<string, number> = {};
  for (let i = 0; i < 5_000; i++) o[`k${i}`] = i;
  return o;
}

function caught(fn: () => void): Error & { operator?: string } {
  try {
    fn();
  } catch (e) {
    return e as Error & { operator?: string };
  }
  assert.fail("expected the assertion to throw");
}

test("a failing equal(domNode, null, msg) is bounded and keeps the message and the operator", () => {
  const t0 = performance.now();
  const err = caught(() => assert.equal(fakeRenderedNode(), null, "saving leaked onto b"));
  assert.ok(performance.now() - t0 < 1_000, "bounded failure took over 1s");
  assert.ok(err instanceof legacy.AssertionError, "still an AssertionError");
  assert.ok(err.message.length < BOUND, `message is ${err.message.length} chars`);
  assert.match(err.message, /^saving leaked onto b/);
  assert.match(err.message, /<BUTTON> <button type="button">Saving…<\/button>/);
  assert.equal(err.operator, "strictEqual");
});

test("every guarded entry point is bounded: strict, legacy, named import, deep and not-variants", () => {
  const node = fakeRenderedNode();
  const cases: Array<[string, () => void]> = [
    ["strict.strictEqual", () => assert.strictEqual(node, null)],
    ["strict.deepEqual", () => assert.deepEqual(bigPlain(), {})],
    ["strict.deepStrictEqual", () => assert.deepStrictEqual({ el: node }, {})],
    ["strict.notStrictEqual", () => assert.notStrictEqual(node, node)],
    ["strict.notDeepStrictEqual", () => assert.notDeepStrictEqual(bigPlain(), bigPlain())],
    ["named equal", () => namedEqual(node, null, "named")],
    ["legacy.strictEqual", () => legacy.strictEqual(node, null)],
    ["legacy.equal", () => legacy.equal(node, null)],
    ["legacy.deepStrictEqual", () => legacy.deepStrictEqual(bigPlain(), {})],
  ];
  for (const [name, fn] of cases) {
    const err = caught(fn);
    assert.ok(err.message.length < BOUND, `${name}: message is ${err.message.length} chars`);
  }
});

test("small plain operands keep Node's own diff; passing assertions still pass", () => {
  const err = caught(() => assert.deepStrictEqual({ a: 1, b: [1, 2] }, { a: 1, b: [1, 3] }));
  assert.match(err.message, /\+ actual - expected/);
  const node = fakeRenderedNode();
  assert.equal(node, node);
  assert.deepStrictEqual(bigPlain(), bigPlain());
  assert.notEqual(node, null);
});
