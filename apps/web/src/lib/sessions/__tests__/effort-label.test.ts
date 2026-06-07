import { describe, expect, it } from "vitest";
import { isMaxIntentRpe, MAX_INTENT_LABEL } from "../effort-label";

describe("effort-label", () => {
  it("flags RPE 10/10 as the max-intent (plyometric/power) marker", () => {
    expect(isMaxIntentRpe({ min: 10, max: 10 })).toBe(true);
  });

  it("does not flag sub-maximal or ranged RPE targets", () => {
    expect(isMaxIntentRpe({ min: 8, max: 9 })).toBe(false);
    expect(isMaxIntentRpe({ min: 9, max: 10 })).toBe(false);
    expect(isMaxIntentRpe({ min: 7, max: 7 })).toBe(false);
  });

  it("is safe on null/undefined", () => {
    expect(isMaxIntentRpe(undefined)).toBe(false);
    expect(isMaxIntentRpe(null)).toBe(false);
  });

  it("exposes the user-facing label", () => {
    expect(MAX_INTENT_LABEL).toBe("Max intent");
  });
});
