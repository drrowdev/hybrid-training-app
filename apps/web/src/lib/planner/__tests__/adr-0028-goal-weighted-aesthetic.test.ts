import { describe, it, expect } from "vitest";
import {
  applyGoalWeightToTargets,
  AESTHETIC_GOAL_WEIGHT,
  PHYSIQUE_TRIAD,
  PERFORMANCE_PRIMARY_ARCHETYPES,
} from "../aesthetic-goal-weight";

/**
 * ADR 0028 — goal-weighted aesthetic profile. The physique triad
 * (side delts / biceps / calves) is down-weighted ×0.5 on
 * performance-primary archetypes, with two override hatches.
 */

// A representative no-focus aesthetic target map (every muscle at the
// MEV-floor default of 6), mirroring `defaultMuscleTargets()`.
const baseTargets = (): Record<string, number> => ({
  side_delts: 6,
  rear_delts: 6,
  biceps: 6,
  triceps: 6,
  calves: 6,
  abs: 6,
  upper_chest: 6,
  lats: 6,
  mid_back: 6,
  hamstrings: 6,
  forearms: 6,
});

describe("ADR 0028 — physique-triad classification", () => {
  it("triad is exactly side_delts, biceps, calves", () => {
    expect([...PHYSIQUE_TRIAD].sort()).toEqual(
      ["biceps", "calves", "side_delts"].sort(),
    );
  });

  it("performance primaries are exactly strength / concurrent / endurance", () => {
    expect([...PERFORMANCE_PRIMARY_ARCHETYPES].sort()).toEqual(
      ["concurrent_hybrid", "endurance_anchor", "strength_anchor"].sort(),
    );
  });

  it("the down-weight constant is a halving", () => {
    expect(AESTHETIC_GOAL_WEIGHT).toBe(0.5);
  });
});

describe("ADR 0028 — down-weight on performance primaries", () => {
  for (const archetypeId of ["strength_anchor", "concurrent_hybrid", "endurance_anchor"]) {
    it(`halves the triad and leaves all other muscles unchanged (${archetypeId})`, () => {
      const out = applyGoalWeightToTargets(baseTargets(), {
        archetypeId,
        secondaryMuscleHonored: false,
      });
      // Triad halved 6 → 3.
      expect(out.side_delts).toBe(3);
      expect(out.biceps).toBe(3);
      expect(out.calves).toBe(3);
      // Everything else byte-identical.
      expect(out.rear_delts).toBe(6);
      expect(out.triceps).toBe(6);
      expect(out.abs).toBe(6);
      expect(out.upper_chest).toBe(6);
      expect(out.lats).toBe(6);
      expect(out.mid_back).toBe(6);
      expect(out.hamstrings).toBe(6);
      expect(out.forearms).toBe(6);
    });
  }

  it("returns a new object (does not mutate the input)", () => {
    const input = baseTargets();
    const out = applyGoalWeightToTargets(input, {
      archetypeId: "strength_anchor",
      secondaryMuscleHonored: false,
    });
    expect(out).not.toBe(input);
    expect(input.biceps).toBe(6); // input untouched
  });

  it("floors a positive triad target at 1 rather than dropping it to 0", () => {
    const out = applyGoalWeightToTargets(
      { biceps: 1, triceps: 6 },
      { archetypeId: "strength_anchor", secondaryMuscleHonored: false },
    );
    expect(out.biceps).toBe(1); // floor(1*0.5)=0 → clamps up to 1
    expect(out.triceps).toBe(6);
  });
});

describe("ADR 0028 — identity (no down-weight) cases", () => {
  it("hypertrophy_anchor is untouched (the triad is the goal)", () => {
    const out = applyGoalWeightToTargets(baseTargets(), {
      archetypeId: "hypertrophy_anchor",
      secondaryMuscleHonored: false,
    });
    expect(out).toEqual(baseTargets());
  });

  for (const archetypeId of ["rebuild", "maintenance"]) {
    it(`lifecycle archetype is untouched (${archetypeId})`, () => {
      const out = applyGoalWeightToTargets(baseTargets(), {
        archetypeId,
        secondaryMuscleHonored: false,
      });
      expect(out).toEqual(baseTargets());
    });
  }

  it("an honoured muscle secondary cancels the down-weight entirely", () => {
    const out = applyGoalWeightToTargets(baseTargets(), {
      archetypeId: "strength_anchor",
      secondaryMuscleHonored: true,
    });
    expect(out).toEqual(baseTargets());
  });

  it("ADR 0045 — a high-volume block cancels the down-weight entirely", () => {
    const out = applyGoalWeightToTargets(baseTargets(), {
      archetypeId: "concurrent_hybrid",
      secondaryMuscleHonored: false,
      highVolume: true,
    });
    expect(out).toEqual(baseTargets());
  });

  it("ADR 0045 — omitted highVolume still down-weights (regression guard)", () => {
    const withFlag = applyGoalWeightToTargets(baseTargets(), {
      archetypeId: "strength_anchor",
      secondaryMuscleHonored: false,
      highVolume: false,
    });
    const without = applyGoalWeightToTargets(baseTargets(), {
      archetypeId: "strength_anchor",
      secondaryMuscleHonored: false,
    });
    expect(withFlag).toEqual(without);
    // And the triad is genuinely halved (the down-weight really ran).
    expect(withFlag.side_delts).toBeLessThan(baseTargets().side_delts);
  });
});

describe("ADR 0028 — explicit focus pick override", () => {
  it("a triad muscle chosen as a focus muscle is NOT down-weighted", () => {
    const focusElevated: Record<string, number> = { ...baseTargets(), biceps: 14 }; // focus pull
    const out = applyGoalWeightToTargets(focusElevated, {
      archetypeId: "strength_anchor",
      secondaryMuscleHonored: false,
      focusMuscles: ["biceps"],
    });
    // biceps preserved (explicit pick wins), the other triad members still halved.
    expect(out.biceps).toBe(14);
    expect(out.side_delts).toBe(3);
    expect(out.calves).toBe(3);
  });
});
