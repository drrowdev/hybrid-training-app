import { describe, it, expect } from "vitest";
import { computeSetLoad, isCountableSet, rpeMultiplier, PRIMARY_REGION_WEIGHT, SECONDARY_REGION_WEIGHT } from "../set-load";

describe("rpeMultiplier", () => {
  it("RPE 10 (0 RIR) = 1.0 — maximum damage stimulus", () => {
    expect(rpeMultiplier(10)).toBe(1.0);
  });

  it("RPE 9 = 0.85", () => {
    expect(rpeMultiplier(9)).toBe(0.85);
  });

  it("RPE 8 = 0.70", () => {
    expect(rpeMultiplier(8)).toBe(0.7);
  });

  it("RPE 7 = 0.55", () => {
    expect(rpeMultiplier(7)).toBe(0.55);
  });

  it("RPE 6 = 0.40", () => {
    expect(rpeMultiplier(6)).toBe(0.4);
  });

  it("RPE ≤5 floors at 0.30", () => {
    expect(rpeMultiplier(5)).toBe(0.3);
    expect(rpeMultiplier(3)).toBe(0.3);
  });

  it("Missing RPE defaults to 0.50 (conservative midpoint)", () => {
    expect(rpeMultiplier(null)).toBe(0.5);
    expect(rpeMultiplier(undefined)).toBe(0.5);
  });

  it("Higher RPE always yields higher multiplier (monotonic)", () => {
    const ladder = [6, 7, 8, 9, 10].map((r) => rpeMultiplier(r));
    for (let i = 1; i < ladder.length; i++) {
      expect(ladder[i]).toBeGreaterThan(ladder[i - 1]!);
    }
  });
});

describe("computeSetLoad", () => {
  it("returns 0 for non-positive inputs (no contribution)", () => {
    expect(computeSetLoad({ sets: 0, reps: 5, weightKg: 100 })).toBe(0);
    expect(computeSetLoad({ sets: 1, reps: 0, weightKg: 100 })).toBe(0);
    expect(computeSetLoad({ sets: 1, reps: 5, weightKg: 0 })).toBe(0);
  });

  it("100 kg × 5 reps @ RPE 8 = 100 × 5 × 0.7 = 350 kg-load", () => {
    expect(computeSetLoad({ sets: 1, reps: 5, weightKg: 100, rpe: 8 })).toBe(350);
  });

  it("Same tonnage at higher RPE yields higher load (proximity-to-failure premium)", () => {
    const rpe7 = computeSetLoad({ sets: 1, reps: 5, weightKg: 100, rpe: 7 });
    const rpe9 = computeSetLoad({ sets: 1, reps: 5, weightKg: 100, rpe: 9 });
    expect(rpe9).toBeGreaterThan(rpe7);
  });

  it("Missing RPE matches the conservative default (0.5)", () => {
    expect(computeSetLoad({ sets: 1, reps: 5, weightKg: 100 })).toBe(250);
  });

  it("Multiple sets multiply linearly", () => {
    const one = computeSetLoad({ sets: 1, reps: 5, weightKg: 100, rpe: 8 });
    const three = computeSetLoad({ sets: 3, reps: 5, weightKg: 100, rpe: 8 });
    expect(three).toBe(one * 3);
  });
});

describe("Region weight constants", () => {
  it("Primary region weight = 1.0, secondary = 0.5", () => {
    expect(PRIMARY_REGION_WEIGHT).toBe(1.0);
    expect(SECONDARY_REGION_WEIGHT).toBe(0.5);
    expect(PRIMARY_REGION_WEIGHT / SECONDARY_REGION_WEIGHT).toBe(2);
  });
});

describe("isCountableSet — shared skip/warmup rule", () => {
  it("counts a normal main set", () => {
    expect(isCountableSet({ setKind: "main", isSkipped: false })).toBe(true);
  });

  it("does not count warmup", () => {
    expect(isCountableSet({ setKind: "warmup", isSkipped: false })).toBe(false);
  });

  it("does not count skipped sets even when not warmup", () => {
    expect(isCountableSet({ setKind: "main", isSkipped: true })).toBe(false);
  });

  it("counts back_off / accessory / tendon as work", () => {
    expect(isCountableSet({ setKind: "back_off", isSkipped: false })).toBe(true);
    expect(isCountableSet({ setKind: "accessory", isSkipped: false })).toBe(true);
    expect(isCountableSet({ setKind: "tendon", isSkipped: false })).toBe(true);
  });

  it("treats null/undefined isSkipped as not skipped", () => {
    expect(isCountableSet({ setKind: "main", isSkipped: null })).toBe(true);
    expect(isCountableSet({ setKind: "main" })).toBe(true);
  });

  it("treats null setKind as countable (legacy rows with no kind)", () => {
    expect(isCountableSet({ setKind: null, isSkipped: false })).toBe(true);
    expect(isCountableSet({ isSkipped: false })).toBe(true);
  });
});
