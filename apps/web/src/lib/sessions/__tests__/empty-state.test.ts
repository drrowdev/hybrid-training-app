/**
 * Tests for the in-session header action-button predicate.
 *
 * Encodes the spec contract directly:
 *   - Cancel renders when session is empty + not complete
 *   - Delete renders for completed or partially-logged sessions
 */
import { describe, it, expect } from "vitest";
import { isEmptyInProgressSession } from "../empty-state";

describe("isEmptyInProgressSession", () => {
  it("returns true when no sets, no cardio, and not completed", () => {
    expect(
      isEmptyInProgressSession({
        completedAt: null,
        setLogCount: 0,
        cardioLogCount: 0,
      }),
    ).toBe(true);
  });

  it("returns false when session has at least one set log", () => {
    expect(
      isEmptyInProgressSession({
        completedAt: null,
        setLogCount: 1,
        cardioLogCount: 0,
      }),
    ).toBe(false);
  });

  it("returns false when session has at least one cardio log", () => {
    expect(
      isEmptyInProgressSession({
        completedAt: null,
        setLogCount: 0,
        cardioLogCount: 1,
      }),
    ).toBe(false);
  });

  it("returns false when session is completed (even if empty)", () => {
    expect(
      isEmptyInProgressSession({
        completedAt: "2025-01-01T00:00:00Z",
        setLogCount: 0,
        cardioLogCount: 0,
      }),
    ).toBe(false);
  });

  it("returns false when session is completed and has logs", () => {
    expect(
      isEmptyInProgressSession({
        completedAt: "2025-01-01T00:00:00Z",
        setLogCount: 5,
        cardioLogCount: 2,
      }),
    ).toBe(false);
  });

  it("treats undefined completedAt the same as null (no completion)", () => {
    expect(
      isEmptyInProgressSession({
        completedAt: undefined,
        setLogCount: 0,
        cardioLogCount: 0,
      }),
    ).toBe(true);
  });
});
