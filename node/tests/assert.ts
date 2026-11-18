/**
 * The assertion vocabulary this suite is written in, on top of `node:assert/strict`.
 *
 * The suite was authored against `@std/assert`; these are the same names and call
 * shapes, so the tests read unchanged after the move to `node:test`. Most are a
 * one-line alias. Two are not, and are why this module exists rather than a
 * direct `node:assert` import in every file: `assertRejects` / `assertThrows`
 * RETURN the error they caught (typed as the expected class), and dozens of tests
 * go on to assert on its `status` / `code` / `message`. `assert.rejects` /
 * `assert.throws` return nothing.
 *
 * Not a test file: `npm test` only runs `tests/**\/*_test.ts`.
 */

import nodeAssert from "node:assert/strict";

// biome-ignore lint/suspicious/noExplicitAny: an error class constructor of any arity.
type ErrorClass<E extends Error> = abstract new (...args: any[]) => E;

/** Assert `expr` is truthy. */
export function assert(expr: unknown, msg?: string): asserts expr {
  nodeAssert.ok(expr, msg);
}

/** Assert `expr` is falsy. */
export function assertFalse(expr: unknown, msg?: string): void {
  nodeAssert.ok(!expr, msg ?? `Expected ${String(expr)} to be falsy`);
}

/** Deep, strict equality. */
export function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  nodeAssert.deepStrictEqual(actual, expected, msg);
}

/** Deep, strict inequality. */
export function assertNotEquals<T>(actual: T, expected: T, msg?: string): void {
  nodeAssert.notDeepStrictEqual(actual, expected, msg);
}

/** Assert `actual` matches `expected`. */
export function assertMatch(actual: string, expected: RegExp, msg?: string): void {
  nodeAssert.match(actual, expected, msg);
}

/** Assert `actual` does not match `expected`. */
export function assertNotMatch(actual: string, expected: RegExp, msg?: string): void {
  nodeAssert.doesNotMatch(actual, expected, msg);
}

/** Assert `actual` contains `expected` as a substring. */
export function assertStringIncludes(actual: string, expected: string, msg?: string): void {
  nodeAssert.ok(
    actual.includes(expected),
    msg ?? `Expected actual: ${JSON.stringify(actual)} to contain: ${JSON.stringify(expected)}`,
  );
}

/** Assert `actual` is an instance of `expectedType`, narrowing it. */
export function assertInstanceOf<T extends abstract new (...args: never[]) => unknown>(
  actual: unknown,
  expectedType: T,
  msg?: string,
): asserts actual is InstanceType<T> {
  nodeAssert.ok(
    actual instanceof expectedType,
    msg ?? `Expected object to be an instance of "${expectedType.name}"`,
  );
}

function checkError<E extends Error>(
  err: unknown,
  ErrorClass: ErrorClass<E> | undefined,
  msgIncludes: string | undefined,
  msg: string | undefined,
): void {
  if (ErrorClass === undefined) return;
  const suffix = msg ? `: ${msg}` : "";
  nodeAssert.ok(
    err instanceof ErrorClass,
    `Expected error to be instance of "${ErrorClass.name}", but was "${
      (err as Error)?.constructor?.name
    }"${suffix}`,
  );
  if (msgIncludes !== undefined) {
    assertStringIncludes((err as Error).message, msgIncludes, msg);
  }
}

/**
 * Assert `fn` throws (synchronously), optionally an instance of `ErrorClass` whose
 * message contains `msgIncludes`. Returns the thrown error.
 */
export function assertThrows(fn: () => unknown, msg?: string): unknown;
export function assertThrows<E extends Error = Error>(
  fn: () => unknown,
  ErrorClass: ErrorClass<E>,
  msgIncludes?: string,
  msg?: string,
): E;
export function assertThrows<E extends Error = Error>(
  fn: () => unknown,
  errorClassOrMsg?: ErrorClass<E> | string,
  msgIncludes?: string,
  msg?: string,
): E | unknown {
  const ErrorClass = typeof errorClassOrMsg === "string" ? undefined : errorClassOrMsg;
  const outerMsg = typeof errorClassOrMsg === "string" ? errorClassOrMsg : msg;
  try {
    fn();
  } catch (err) {
    checkError(err, ErrorClass, msgIncludes, outerMsg);
    return err;
  }
  nodeAssert.fail(`Expected function to throw${outerMsg ? `: ${outerMsg}` : ""}`);
}

/**
 * Assert the promise `fn` returns rejects, optionally with an instance of
 * `ErrorClass` whose message contains `msgIncludes`. Returns the rejection.
 * A synchronous throw is a failure: the function must return a promise.
 */
export function assertRejects(fn: () => PromiseLike<unknown>, msg?: string): Promise<unknown>;
export function assertRejects<E extends Error = Error>(
  fn: () => PromiseLike<unknown>,
  ErrorClass: ErrorClass<E>,
  msgIncludes?: string,
  msg?: string,
): Promise<E>;
export async function assertRejects<E extends Error = Error>(
  fn: () => PromiseLike<unknown>,
  errorClassOrMsg?: ErrorClass<E> | string,
  msgIncludes?: string,
  msg?: string,
): Promise<E | unknown> {
  const ErrorClass = typeof errorClassOrMsg === "string" ? undefined : errorClassOrMsg;
  const outerMsg = typeof errorClassOrMsg === "string" ? errorClassOrMsg : msg;
  const suffix = outerMsg ? `: ${outerMsg}` : "";
  let promise: PromiseLike<unknown>;
  try {
    promise = fn();
  } catch (err) {
    nodeAssert.fail(`Function throws when expected to reject (${String(err)})${suffix}`);
  }
  nodeAssert.ok(
    promise !== null && typeof promise === "object" && typeof promise.then === "function",
    `Function returns a non-promise value when expected to reject${suffix}`,
  );
  try {
    await promise;
  } catch (err) {
    checkError(err, ErrorClass, msgIncludes, outerMsg);
    return err;
  }
  nodeAssert.fail(`Expected function to reject${suffix}`);
}
