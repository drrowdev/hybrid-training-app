/**
 * The system-load conversion and the shared target-load resolver.
 *
 * These two functions are what stop a bodyweight-inclusive 1RM from being
 * prescribed as a belt load. Three separate surfaces used to answer "what
 * weight is this set?" with their own copy of `tm × percent`, which is how a
 * 110 kg weighted-pull-up max became 77 kg hanging off a dip belt.
 */
import { describe, it, expect } from "vitest";
import { addedLoadFromSystemLoad } from "./system-load";
import { resolveTargetLoadKg } from "./target-load";

const toPlate = (kg: number) => Math.round(kg / 2.5) * 2.5;

describe("addedLoadFromSystemLoad", () => {
  it("takes bodyweight off the total", () => {
    expect(addedLoadFromSystemLoad(110, 85)).toBe(25);
  });

  it("rounds the added portion, not the total", () => {
    // 103 − 85 = 18 → 17.5 kg of plates. Rounding 103 first would leave 20 −
    // 84.5, a number no plate set can make.
    expect(addedLoadFromSystemLoad(103, 85, toPlate)).toBe(17.5);
  });

  it("floors at bodyweight instead of going negative", () => {
    expect(addedLoadFromSystemLoad(77, 85, toPlate)).toBe(0);
    expect(addedLoadFromSystemLoad(85, 85, toPlate)).toBe(0);
  });

  it("treats missing numbers as no load rather than NaN", () => {
    expect(addedLoadFromSystemLoad(Number.NaN, 85)).toBe(0);
    expect(addedLoadFromSystemLoad(110, Number.NaN)).toBe(0);
  });
});

describe("resolveTargetLoadKg", () => {
  const percentItem = { percentTm: 70 };

  it("resolves a plain percentage against the working max", () => {
    expect(resolveTargetLoadKg(percentItem, { tmKg: 200, roundKg: toPlate })).toBe(140);
  });

  it("treats a system-load percentage as a total and subtracts bodyweight", () => {
    expect(
      resolveTargetLoadKg(percentItem, {
        tmKg: 140,
        isSystemLoad: true,
        bodyweightKg: 85,
        roundKg: toPlate,
      }),
      // 70% of 140 = 98 kg of system load − 85 kg = 13 → 12.5 kg on the belt.
    ).toBe(12.5);
  });

  it("resolves to a bodyweight set when the percentage lands under bodyweight", () => {
    expect(
      resolveTargetLoadKg(percentItem, {
        tmKg: 110,
        isSystemLoad: true,
        bodyweightKg: 85,
        roundKg: toPlate,
      }),
    ).toBe(0);
  });

  it("refuses to resolve a system load with no bodyweight on file", () => {
    expect(
      resolveTargetLoadKg(percentItem, { tmKg: 110, isSystemLoad: true, roundKg: toPlate }),
    ).toBeNull();
    expect(
      resolveTargetLoadKg(percentItem, {
        tmKg: 110,
        isSystemLoad: true,
        bodyweightKg: 0,
        roundKg: toPlate,
      }),
    ).toBeNull();
  });

  it("keeps a 0 kg system-load target — it is a bodyweight set, not a missing one", () => {
    expect(
      resolveTargetLoadKg({ targetWeightKg: 0 }, { isSystemLoad: true, roundKg: toPlate }),
    ).toBe(0);
    // Without the system-load flag a 0 still means "nothing prescribed".
    expect(resolveTargetLoadKg({ targetWeightKg: 0 }, { roundKg: toPlate })).toBeNull();
  });

  it("leaves a hand-entered absolute load alone unless asked to round it", () => {
    expect(resolveTargetLoadKg({ targetWeightKg: 7 }, { roundKg: toPlate })).toBe(7);
    expect(
      resolveTargetLoadKg({ targetWeightKg: 7 }, { roundKg: toPlate, roundAbsoluteKg: toPlate }),
    ).toBe(7.5);
  });

  it("returns null when nothing determines a load", () => {
    expect(resolveTargetLoadKg({}, { tmKg: 200 })).toBeNull();
    expect(resolveTargetLoadKg(percentItem, {})).toBeNull();
    expect(resolveTargetLoadKg(null)).toBeNull();
  });
});
