/**
 * Assistance model — categories, prescription format/parse round-trips, label,
 * movement→category derivation, and plan resolution.
 */
import { describe, it, expect } from "vitest";
import {
  ASSISTANCE_CATEGORIES,
  formatAssistancePrescription,
  parseAssistancePrescription,
  assistanceLabel,
  categoryFromMovement,
  resolveAssistance,
  hasAssistanceOverride,
  type AssistanceEntry,
  type AssistancePlan,
} from "./assistance";

describe("assistance categories", () => {
  it("are the 5/3/1 push/pull/single-leg/core/carry buckets (+ accessory/other)", () => {
    expect(ASSISTANCE_CATEGORIES.map((c) => c.id)).toEqual([
      "push",
      "pull",
      "single-leg",
      "core",
      "carry",
      "accessory",
      "other",
    ]);
  });
});

describe("format ↔ parse round-trip", () => {
  const cases: Array<Partial<AssistanceEntry> & { sets: number; reps: number }> = [
    { sets: 3, reps: 10 },
    { sets: 3, reps: 8, repsMax: 10 },
    { sets: 3, reps: 30, unit: "sec" },
    { sets: 3, reps: 10, unit: "each-leg" },
    { sets: 5, reps: 8, isAmrap: true },
    { sets: 3, reps: 8, repsMax: 10, isAmrap: true },
  ];
  for (const c of cases) {
    it(`round-trips ${JSON.stringify(c)}`, () => {
      const str = formatAssistancePrescription(c);
      const parsed = parseAssistancePrescription(str);
      expect(parsed).not.toBeNull();
      expect(parsed!.sets).toBe(c.sets);
      expect(parsed!.reps).toBe(c.reps);
      expect(parsed!.repsMax).toBe(c.repsMax);
      expect(parsed!.unit).toBe(c.unit);
      expect(parsed!.isAmrap).toBe(c.isAmrap);
    });
  }

  it("tolerates messy input variations", () => {
    expect(parseAssistancePrescription("3X10")).toMatchObject({ sets: 3, reps: 10 });
    expect(parseAssistancePrescription("3 × 8–10")).toMatchObject({ sets: 3, reps: 8, repsMax: 10 });
    expect(parseAssistancePrescription("5 x 30 sec")).toMatchObject({ sets: 5, reps: 30, unit: "sec" });
    expect(parseAssistancePrescription("3x10 ea side")).toMatchObject({ unit: "each-side" });
  });

  it("returns null for unparseable / unknown-unit input", () => {
    expect(parseAssistancePrescription("garbage")).toBeNull();
    expect(parseAssistancePrescription("3x10 furlongs")).toBeNull();
  });
});

describe("assistanceLabel", () => {
  it("renders the full prescription + movement", () => {
    const e: AssistanceEntry = { id: "1", category: "pull", movementName: "Chinup", sets: 3, reps: 8, repsMax: 10 };
    expect(assistanceLabel(e)).toBe("3\u00d78\u201310 Chinup");
    const plank: AssistanceEntry = { id: "2", category: "core", movementName: "Plank", sets: 3, reps: 30, unit: "sec" };
    expect(assistanceLabel(plank)).toBe("3\u00d730 sec Plank");
  });
});

describe("categoryFromMovement", () => {
  it("maps pattern to category with single-leg keyword override", () => {
    expect(categoryFromMovement({ name: "DB Incline Press", pattern: "push-horizontal" })).toBe("push");
    expect(categoryFromMovement({ name: "Chinup", pattern: "pull-vertical" })).toBe("pull");
    expect(categoryFromMovement({ name: "Plank", pattern: "core" })).toBe("core");
    expect(categoryFromMovement({ name: "Farmer Carry", pattern: "carry" })).toBe("carry");
    // single-leg keyword overrides the hinge pattern
    expect(categoryFromMovement({ name: "Bulgarian Split Squat", pattern: "squat" })).toBe("single-leg");
    expect(categoryFromMovement({ name: "Single-leg RDL", pattern: "hinge" })).toBe("single-leg");
    // plain hinge/squat → accessory
    expect(categoryFromMovement({ name: "Good Morning", pattern: "hinge" })).toBe("accessory");
  });
});

describe("resolveAssistance + hasAssistanceOverride", () => {
  const plan: AssistancePlan = {
    perDay: { 0: [{ id: "a", category: "push", movementName: "Dips", sets: 3, reps: 10 }] },
    perWeekDay: { "deload|0": [{ id: "b", category: "push", movementName: "Push-up", sets: 2, reps: 10 }] },
  };

  it("per-week override wins, else per-day default, else empty", () => {
    expect(resolveAssistance(plan, 1, 0).map((e) => e.movementName)).toEqual(["Dips"]);
    expect(resolveAssistance(plan, "deload", 0).map((e) => e.movementName)).toEqual(["Push-up"]);
    expect(resolveAssistance(plan, 1, 9)).toEqual([]);
    expect(resolveAssistance(undefined, 1, 0)).toEqual([]);
  });

  it("hasAssistanceOverride detects per-week overrides only", () => {
    expect(hasAssistanceOverride(plan, "deload", 0)).toBe(true);
    expect(hasAssistanceOverride(plan, 1, 0)).toBe(false);
    expect(hasAssistanceOverride(undefined, 1, 0)).toBe(false);
  });
});
