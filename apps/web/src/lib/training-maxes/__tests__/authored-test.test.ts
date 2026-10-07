/**
 * DC-K4: a Test week proposes a new 1RM; the user decides.
 * DC-R6: only marked authored Test sets from typed programs can propose one.
 */
import { describe, expect, it } from "vitest";
import { evaluateAuthoredTest, pickAuthoredTestSetsByMovement } from "../authored-test";

const rule = { after: "updateFromLoggedSet" } as const;
const set = (over: Record<string, unknown> = {}) => ({
  id: "s1", movementId: "m1", setKind: "main", weightKg: 100, reps: 3, rpe: null, skipped: false,
  prescribed: { authoredTest: rule }, ...over,
});

describe("DC-K4 authored test set selection", () => {
  it("picks the heaviest marked working set per movement", () => {
    const top = pickAuthoredTestSetsByMovement([set(), set({ id: "s2", weightKg: 105 }), set({ id: "s3", movementId: "m2" })]);
    expect(top.get("m1")?.id).toBe("s2");
    expect(top.get("m2")?.id).toBe("s3");
  });

  it("ignores unmarked, skipped, warm-up, empty and malformed sets", () => {
    const top = pickAuthoredTestSetsByMovement([
      set({ prescribed: { isAmrap: true } }), set({ prescribed: null }), set({ skipped: true }),
      set({ setKind: "warmup" }), set({ weightKg: 0 }), set({ reps: null }),
      set({ prescribed: { authoredTest: { after: "keep" } } }),
      set({ prescribed: { authoredTest: { after: "fixedIncrease" } } }),
    ]);
    expect(top.size).toBe(0);
  });

  it("carries a fixed-increase step", () => {
    const top = pickAuthoredTestSetsByMovement([set({ prescribed: { authoredTest: { after: "fixedIncrease", stepKg: 5 } } })]);
    expect(top.get("m1")?.rule).toEqual({ after: "fixedIncrease", stepKg: 5 });
  });
});

describe("DC-K4 authored test evaluation", () => {
  it("estimates the 1RM from the logged set and rounds to a plate step", () => {
    const result = evaluateAuthoredTest({ currentOneRmKg: 100, weightKg: 110, reps: 3, rule });
    expect(result).toMatchObject({ suggest: true });
    if (result.suggest) {
      expect(result.oneRmKg % 2.5).toBe(0);
      expect(result.oneRmKg).toBeGreaterThan(110);
      expect(result.formula).not.toBeNull();
    }
  });

  it("proposes a lower 1RM when the test came in below the stored value", () => {
    const result = evaluateAuthoredTest({ currentOneRmKg: 140, weightKg: 100, reps: 3, rule });
    expect(result.suggest && result.oneRmKg < 140).toBe(true);
  });

  it("stays quiet when the estimate is within one plate step of the stored value", () => {
    expect(evaluateAuthoredTest({ currentOneRmKg: 105, weightKg: 100, reps: 3, rule })).toEqual({ suggest: false, reason: "no-change" });
  });

  it("does not estimate from a high-rep set", () => {
    expect(evaluateAuthoredTest({ currentOneRmKg: 100, weightKg: 100, reps: 8, rule })).toEqual({ suggest: false, reason: "low-confidence" });
  });

  it("ignores out-of-range effort values instead of failing", () => {
    expect(evaluateAuthoredTest({ currentOneRmKg: 100, weightKg: 120, reps: 2, rpe: 3, rule }).suggest).toBe(true);
  });

  it("adds the authored step to the stored 1RM for a fixed increase", () => {
    expect(evaluateAuthoredTest({ currentOneRmKg: 100, weightKg: 1, reps: 20, rule: { after: "fixedIncrease", stepKg: 5 } }))
      .toEqual({ suggest: true, oneRmKg: 105, formula: null });
  });

  it("refuses a missing stored 1RM", () => {
    expect(evaluateAuthoredTest({ currentOneRmKg: 0, weightKg: 100, reps: 3, rule })).toEqual({ suggest: false, reason: "invalid-input" });
  });
});
