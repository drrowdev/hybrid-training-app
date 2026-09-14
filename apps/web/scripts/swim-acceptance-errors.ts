import nodeAssert, { AssertionError } from "node:assert/strict";
import { constants } from "node:os";
import type { ProcessResult } from "./swim-acceptance-guards";

export type FailureCause = {
  classification: "guard" | "process" | "assertion" | "parser" | "unexpected";
  message: string;
  result?: ProcessResult;
};
const authoredCauses = new WeakMap<object, FailureCause>();

// Only messages supplied by local call sites are public, never Node's assertion diffs.
function authoredAssertion(action: () => void, message?: string) {
  try { action(); } catch (error) {
    if (error instanceof AssertionError && message) {
      authoredCauses.set(error, { classification: "guard", message });
    }
    throw error;
  }
}

export const acceptanceAssert: {
  (value: unknown, message?: string): asserts value;
  deepEqual(actual: unknown, expected: unknown, message?: string): void;
  match(value: string, regexp: RegExp, message?: string): void;
} = Object.assign(
  (value: unknown, message?: string) => authoredAssertion(() => nodeAssert(value, message), message),
  {
    deepEqual: (actual: unknown, expected: unknown, message?: string) =>
      authoredAssertion(() => nodeAssert.deepEqual(actual, expected, message), message),
    match: (value: string, regexp: RegExp, message?: string) =>
      authoredAssertion(() => nodeAssert.match(value, regexp, message), message),
  },
);

export function processFailure(result: ProcessResult) {
  const error = new Error("Process failed or timed out");
  authoredCauses.set(error, {
    classification: "process", message: error.message,
    result: {
      code: Number.isSafeInteger(result.code) ? result.code : null,
      signal: result.signal === null || result.signal === "spawn-error" ||
        Object.hasOwn(constants.signals, result.signal) ? result.signal : "unknown-signal",
      timedOut: result.timedOut === true,
    },
  });
  return error;
}

export function safeFailureCause(error: unknown): FailureCause {
  if (error instanceof Error) {
    const authored = authoredCauses.get(error);
    if (authored) return authored;
    if (error instanceof AssertionError) {
      return { classification: "assertion", message: "Acceptance assertion failed; generated details withheld" };
    }
    if (error instanceof SyntaxError) {
      return { classification: "parser", message: "Acceptance data could not be parsed; raw data withheld" };
    }
  }
  return { classification: "unexpected", message: "Unexpected acceptance error; details withheld" };
}
