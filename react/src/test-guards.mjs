// Test-only, never published. Imported by test-jsx-loader.mjs, so every `node --test` process that
// loads the loader gets both guards. Identical copies live in
// w6w-studio (packages/embed) and w6w-ui.
//
// Why: a failing `assert.equal(domNode, null)` once took a test process to 72 GB RSS in 40s and
// starved the host. A DOM node React rendered carries `__reactFiber$…` / `__reactProps$…` own
// properties, and both node:assert's diff (`inspect` at depth 1000, custom inspectors OFF) and the
// TAP reporter's `actual:` dump walk that whole fiber graph — props, the query client, the jsdom
// window — re-expanding every shared object, synchronously and mostly off the V8 heap, so neither
// `--max-old-space-size` nor a timer can stop it.
import assert from "node:assert";
import { syncBuiltinESMExports } from "node:module";
import { Worker, isMainThread } from "node:worker_threads";

if (isMainThread) {
  guardAssertAgainstDomNodes();
  startRssWatchdog();
}

/**
 * Replaces any DOM node handed to an `assert.*` comparison with a short token unique per node, so
 * identity comparisons keep their meaning and a failure reports `<dialog#x> (DOM node #3)` instead
 * of the fiber graph. Deep comparisons treat nodes by identity too — comparing two DOM nodes'
 * internals was never a meaningful test.
 */
function guardAssertAgainstDomNodes() {
  const ids = new WeakMap();
  let next = 0;
  const isDomish = (v) =>
    v !== null &&
    typeof v === "object" &&
    ((typeof v.nodeType === "number" && typeof v.nodeName === "string") || v.window === v);
  const token = (n) => {
    if (!ids.has(n)) ids.set(n, ++next);
    if (n.window === n) return `[Window] (DOM node #${ids.get(n)})`;
    const id = n.id ? `#${n.id}` : "";
    const cls =
      typeof n.className === "string" && n.className
        ? `.${n.className.trim().split(/\s+/).join(".")}`
        : "";
    const name = n.nodeType === 1 ? `<${n.nodeName.toLowerCase()}${id}${cls}>` : n.nodeName;
    return `${name} (DOM node #${ids.get(n)})`;
  };
  const scrub = (v, seen = new Set()) => {
    if (isDomish(v)) return token(v);
    if (v === null || typeof v !== "object" || seen.has(v)) return v;
    const proto = Object.getPrototypeOf(v);
    if (!Array.isArray(v) && proto !== Object.prototype && proto !== null) return v;
    seen.add(v);
    let out = v;
    for (const k of Object.keys(v)) {
      const s = scrub(v[k], seen);
      if (s !== v[k]) {
        if (out === v) out = Array.isArray(v) ? [...v] : { ...v };
        out[k] = s;
      }
    }
    return out;
  };
  const NAMES = [
    "equal",
    "notEqual",
    "strictEqual",
    "notStrictEqual",
    "deepEqual",
    "notDeepEqual",
    "deepStrictEqual",
    "notDeepStrictEqual",
    "partialDeepStrictEqual",
  ];
  for (const target of new Set([assert, assert.strict])) {
    for (const name of NAMES) {
      const orig = target[name];
      if (typeof orig !== "function") continue;
      const guarded = function (...args) {
        // Fewer than two arguments is Node's own ERR_MISSING_ARGS; scrubbing would turn it into
        // `equal(undefined, undefined)`, a silent pass.
        if (args.length < 2) return orig.apply(this, args);
        const [actual, expected, ...rest] = args;
        try {
          return orig.call(this, scrub(actual), scrub(expected), ...rest);
        } catch (e) {
          // Point the stack at the test's own line, not this wrapper.
          if (e instanceof assert.AssertionError) Error.captureStackTrace(e, guarded);
          throw e;
        }
      };
      target[name] = guarded;
    }
  }
  syncBuiltinESMExports();
}

/**
 * Last line of defence for whatever the assert guard does not cover: a worker thread (it keeps
 * running while the main thread is stuck in a synchronous loop) SIGKILLs this process once its RSS
 * passes W6W_TEST_MAX_RSS_MB (default 4096; a healthy suite file peaks near 500 MB). `node --test`
 * then reports the file as failed with signal SIGKILL.
 */
function startRssWatchdog() {
  const limitMb = Number(process.env.W6W_TEST_MAX_RSS_MB ?? 4096);
  if (!(limitMb > 0)) return;
  const worker = new Worker(
    `const { writeSync } = require("node:fs");
const { workerData: { limitMb, argv } } = require("node:worker_threads");
setInterval(() => {
  const mb = Math.round(process.memoryUsage.rss() / 1048576);
  if (mb <= limitMb) return;
  writeSync(2, "\\n[test-guards] RSS " + mb + " MB exceeded W6W_TEST_MAX_RSS_MB=" + limitMb +
    " in " + argv + " - killing this test process.\\n");
  process.kill(process.pid, "SIGKILL");
}, 250);`,
    { eval: true, workerData: { limitMb, argv: process.argv.slice(1).join(" ") } },
  );
  worker.unref();
}
