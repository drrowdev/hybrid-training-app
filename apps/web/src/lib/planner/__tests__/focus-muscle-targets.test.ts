/**
 * Tests for the focus-muscle bias engine (`defaultMuscleTargets`).
 *
 * THE critical correctness property is the substitution invariant:
 * the sum of returned per-muscle targets equals the sum of an unbiased
 * baseline over the SAME key set, within ±1 set rounding. This
 * guarantees the engine's stress budget is preserved — focus pulls
 * volume from non-focus muscles rather than adding it on top.
 *
 * If this breaks the engine's stress budget silently overflows by
 * ~11–22 sets/week and the concurrent_modifier (~0.7×) is bypassed
 * for the focus group(s).
 *
 * See `apps/web/src/lib/planner/focus-muscle-targets.ts` for the
 * implementation and the CP-2 row in
 * `hybrid-training-design-constraints.md` for the citations.
 */
import { describe, expect, it } from "vitest";
import {
  AESTHETIC_TARGET_MUSCLES,
  DEFAULT_MUSCLE_TARGET,
  defaultMuscleTargets,
  FOCUS_LANDMARKS,
  FOREARM_GATE_ATL_THRESHOLD,
} from "../focus-muscle-targets";
import { FOCUS_MUSCLE_ALLOWLIST } from "../focus-muscles";

function sum(o: Record<string, number>): number {
  return Object.values(o).reduce((acc, v) => acc + v, 0);
}

/**
 * Reference baseline for a given focus set: a no-bias map over the
 * union of AESTHETIC_TARGET_MUSCLES and the focus muscles. Every key
 * carries `DEFAULT_MUSCLE_TARGET` so the comparison is apples-to-apples
 * regardless of whether the focus muscle is in the aesthetic universe
 * (e.g. quads / glutes / front_delts / traps are NOT, but the bias
 * model still has to preserve total sets over the wider key set).
 */
function referenceBaselineTotal(focus: readonly string[]): number {
  const keys = new Set<string>(AESTHETIC_TARGET_MUSCLES);
  for (const m of focus) keys.add(m);
  return keys.size * DEFAULT_MUSCLE_TARGET;
}

describe("defaultMuscleTargets — baseline regression guard", () => {
  it("returns the pre-PR baseline exactly when no focus muscles are set", () => {
    const out = defaultMuscleTargets();
    for (const m of AESTHETIC_TARGET_MUSCLES) {
      expect(out.targetsByMuscle[m]).toBe(DEFAULT_MUSCLE_TARGET);
    }
    expect(out.substituted).toBe(false);
    expect(out.forearmGateActive).toBe(false);
  });

  it("empty focusMuscles array matches the no-arg baseline byte-for-byte", () => {
    const noArg = defaultMuscleTargets();
    const empty = defaultMuscleTargets({ focusMuscles: [] });
    expect(empty.targetsByMuscle).toEqual(noArg.targetsByMuscle);
    expect(empty.substituted).toBe(false);
    expect(empty.forearmGateActive).toBe(false);
  });
});

describe("defaultMuscleTargets — ADR 0045 high-volume baseline", () => {
  it("raises every aesthetic muscle to its productive landmark when highVolume", () => {
    const out = defaultMuscleTargets({ highVolume: true });
    for (const m of AESTHETIC_TARGET_MUSCLES) {
      expect(out.targetsByMuscle[m]).toBe(
        FOCUS_LANDMARKS[m]?.productive ?? DEFAULT_MUSCLE_TARGET,
      );
    }
  });

  it("highVolume baseline is strictly higher than the MEV baseline in aggregate", () => {
    const mev = defaultMuscleTargets();
    const high = defaultMuscleTargets({ highVolume: true });
    const sumMev = sum(mev.targetsByMuscle);
    const sumHigh = sum(high.targetsByMuscle);
    expect(sumHigh).toBeGreaterThan(sumMev);
  });

  it("omitted highVolume is byte-identical to the MEV baseline (regression guard)", () => {
    const omitted = defaultMuscleTargets();
    const explicitFalse = defaultMuscleTargets({ highVolume: false });
    expect(explicitFalse.targetsByMuscle).toEqual(omitted.targetsByMuscle);
  });
});

describe("defaultMuscleTargets — substitution invariant", () => {
  // 1-of-1 focus
  for (const m of FOCUS_MUSCLE_ALLOWLIST) {
    it(`single focus "${m}" preserves total set count within ±1 set`, () => {
      const r = defaultMuscleTargets({ focusMuscles: [m] });
      const total = sum(r.targetsByMuscle);
      expect(Math.abs(total - referenceBaselineTotal([m]))).toBeLessThanOrEqual(1);
    });
  }

  // 2-of-2 — sample a representative cross-section so the test stays fast.
  const pairs: Array<[string, string]> = [
    ["biceps", "triceps"],
    ["side_delts", "rear_delts"],
    ["quads", "hamstrings"],
    ["upper_chest", "front_delts"],
    ["forearms", "calves"],
    ["glutes", "traps"],
  ];
  for (const [a, b] of pairs) {
    it(`dual focus "${a}" + "${b}" preserves total set count within ±1 set`, () => {
      const r = defaultMuscleTargets({ focusMuscles: [a, b] });
      const total = sum(r.targetsByMuscle);
      expect(Math.abs(total - referenceBaselineTotal([a, b]))).toBeLessThanOrEqual(1);
      expect(r.substituted).toBe(true);
    });
  }

  it("never pulls a muscle below its maintenance floor once substitution starts (muscles already below baseline are left alone)", () => {
    const r = defaultMuscleTargets({ focusMuscles: ["side_delts", "biceps"] });
    const baseline = defaultMuscleTargets();
    for (const [m, sets] of Object.entries(r.targetsByMuscle)) {
      const lm = FOCUS_LANDMARKS[m];
      if (!lm) continue;
      const baselineSets = baseline.targetsByMuscle[m] ?? DEFAULT_MUSCLE_TARGET;
      // If the baseline already starts at or above maintenance, the
      // result must never dip below maintenance. If baseline starts
      // below maintenance (e.g. lats/mid_back where DEFAULT < maint),
      // we just guarantee no further pull below that already-low
      // baseline.
      if (baselineSets >= lm.maintenance) {
        expect(sets).toBeGreaterThanOrEqual(lm.maintenance);
      } else {
        expect(sets).toBeGreaterThanOrEqual(baselineSets);
      }
    }
  });
});

describe("defaultMuscleTargets — forearm tendon-gate", () => {
  it("does NOT trigger when ATL ratio is at or below threshold", () => {
    const r = defaultMuscleTargets({
      focusMuscles: ["forearms"],
      elbowForearmAtlRatio: FOREARM_GATE_ATL_THRESHOLD,
    });
    expect(r.forearmGateActive).toBe(false);
    // Forearm target should be the unbiased MAV-ish target.
    expect(r.targetsByMuscle.forearms).toBeGreaterThan(FOCUS_LANDMARKS.forearms.building);
  });

  it("triggers and caps forearm target at MEV (building) when ATL ratio > 1.25", () => {
    const r = defaultMuscleTargets({
      focusMuscles: ["forearms"],
      elbowForearmAtlRatio: 1.5, // well above threshold
    });
    expect(r.forearmGateActive).toBe(true);
    expect(r.targetsByMuscle.forearms).toBeLessThanOrEqual(
      FOCUS_LANDMARKS.forearms.building,
    );
  });

  it("does NOT trigger when forearms is not a focus muscle even if ATL is spiking", () => {
    const r = defaultMuscleTargets({
      focusMuscles: ["biceps"],
      elbowForearmAtlRatio: 2.0,
    });
    expect(r.forearmGateActive).toBe(false);
  });
});

describe("defaultMuscleTargets — concurrent-stress cap", () => {
  it("keeps focus target under MRV × concurrentLoadMod when concurrent load is high", () => {
    const concurrentLoadMod = 0.7; // matches the existing concurrent scalar at the legacy knee
    const r = defaultMuscleTargets({
      focusMuscles: ["side_delts"],
      concurrentLoadMod,
    });
    const lm = FOCUS_LANDMARKS.side_delts;
    const cap = Math.round(lm.limit * concurrentLoadMod);
    expect(r.targetsByMuscle.side_delts).toBeLessThanOrEqual(Math.max(cap, lm.maintenance));
    expect(r.targetsByMuscle.side_delts).toBeLessThanOrEqual(lm.productive);
  });
});

describe("defaultMuscleTargets — focus muscle gets MORE sets than baseline", () => {
  it("biceps focus yields a biceps target strictly above the baseline default", () => {
    const baseline = defaultMuscleTargets();
    const biased = defaultMuscleTargets({ focusMuscles: ["biceps"] });
    expect(biased.targetsByMuscle.biceps).toBeGreaterThan(
      baseline.targetsByMuscle.biceps ?? DEFAULT_MUSCLE_TARGET,
    );
  });

  it("at least one non-focus aesthetic muscle gets pulled DOWN from baseline", () => {
    const baseline = defaultMuscleTargets();
    const biased = defaultMuscleTargets({ focusMuscles: ["quads"] });
    const nonFocus = AESTHETIC_TARGET_MUSCLES.filter((m) => m !== "quads");
    const anyPulled = nonFocus.some(
      (m) => biased.targetsByMuscle[m] < baseline.targetsByMuscle[m],
    );
    expect(anyPulled).toBe(true);
  });
});

describe("defaultMuscleTargets — input hardening", () => {
  it("ignores focus muscles beyond the first 2 (DB CHECK is the final guard)", () => {
    const r = defaultMuscleTargets({
      focusMuscles: ["biceps", "triceps", "quads"],
    });
    // Only the first two should be picked up; quads should NOT have
    // been added to the target map at all.
    expect(r.targetsByMuscle.quads).toBeUndefined();
    // biceps + triceps should have been escalated.
    expect(r.targetsByMuscle.biceps).toBeGreaterThan(DEFAULT_MUSCLE_TARGET);
    expect(r.targetsByMuscle.triceps).toBeGreaterThan(DEFAULT_MUSCLE_TARGET);
  });

  it("treats non-finite concurrentLoadMod as 1.0", () => {
    const r = defaultMuscleTargets({
      focusMuscles: ["biceps"],
      concurrentLoadMod: NaN,
    });
    // Should match the 1.0 path.
    const r2 = defaultMuscleTargets({
      focusMuscles: ["biceps"],
      concurrentLoadMod: 1.0,
    });
    expect(r.targetsByMuscle).toEqual(r2.targetsByMuscle);
  });

  it("treats non-finite elbowForearmAtlRatio as 1.0 (no gate)", () => {
    const r = defaultMuscleTargets({
      focusMuscles: ["forearms"],
      elbowForearmAtlRatio: NaN,
    });
    expect(r.forearmGateActive).toBe(false);
  });
});


describe("defaultMuscleTargets — forearm tendon-gate", () => {
  it("does NOT trigger when ATL ratio is at or below threshold", () => {
    const r = defaultMuscleTargets({
      focusMuscles: ["forearms"],
      elbowForearmAtlRatio: FOREARM_GATE_ATL_THRESHOLD,
    });
    expect(r.forearmGateActive).toBe(false);
    // Forearm target should be the unbiased MAV-ish target.
    expect(r.targetsByMuscle.forearms).toBeGreaterThan(FOCUS_LANDMARKS.forearms.building);
  });

  it("triggers and caps forearm target at MEV (building) when ATL ratio > 1.25", () => {
    const r = defaultMuscleTargets({
      focusMuscles: ["forearms"],
      elbowForearmAtlRatio: 1.5, // well above threshold
    });
    expect(r.forearmGateActive).toBe(true);
    expect(r.targetsByMuscle.forearms).toBeLessThanOrEqual(
      FOCUS_LANDMARKS.forearms.building,
    );
  });

  it("does NOT trigger when forearms is not a focus muscle even if ATL is spiking", () => {
    const r = defaultMuscleTargets({
      focusMuscles: ["biceps"],
      elbowForearmAtlRatio: 2.0,
    });
    expect(r.forearmGateActive).toBe(false);
  });
});

describe("defaultMuscleTargets — concurrent-stress cap", () => {
  it("keeps focus target under MRV × concurrentLoadMod when concurrent load is high", () => {
    const concurrentLoadMod = 0.7; // matches the existing concurrent scalar at the legacy knee
    const r = defaultMuscleTargets({
      focusMuscles: ["side_delts"],
      concurrentLoadMod,
    });
    const lm = FOCUS_LANDMARKS.side_delts;
    const cap = Math.round(lm.limit * concurrentLoadMod);
    expect(r.targetsByMuscle.side_delts).toBeLessThanOrEqual(Math.max(cap, lm.maintenance));
    expect(r.targetsByMuscle.side_delts).toBeLessThanOrEqual(lm.productive);
  });
});

describe("defaultMuscleTargets — focus muscle gets MORE sets than baseline", () => {
  it("biceps focus yields a biceps target strictly above the baseline default", () => {
    const baseline = defaultMuscleTargets();
    const biased = defaultMuscleTargets({ focusMuscles: ["biceps"] });
    expect(biased.targetsByMuscle.biceps).toBeGreaterThan(
      baseline.targetsByMuscle.biceps ?? DEFAULT_MUSCLE_TARGET,
    );
  });

  it("at least one non-focus aesthetic muscle gets pulled DOWN from baseline", () => {
    const baseline = defaultMuscleTargets();
    const biased = defaultMuscleTargets({ focusMuscles: ["quads"] });
    const nonFocus = AESTHETIC_TARGET_MUSCLES.filter((m) => m !== "quads");
    const anyPulled = nonFocus.some(
      (m) => biased.targetsByMuscle[m] < baseline.targetsByMuscle[m],
    );
    expect(anyPulled).toBe(true);
  });
});

describe("defaultMuscleTargets — input hardening", () => {
  it("ignores focus muscles beyond the first 2 (DB CHECK is the final guard)", () => {
    const r = defaultMuscleTargets({
      focusMuscles: ["biceps", "triceps", "quads"],
    });
    // Only the first two should be picked up; quads should NOT have
    // been added to the target map at all.
    expect(r.targetsByMuscle.quads).toBeUndefined();
    // biceps + triceps should have been escalated.
    expect(r.targetsByMuscle.biceps).toBeGreaterThan(DEFAULT_MUSCLE_TARGET);
    expect(r.targetsByMuscle.triceps).toBeGreaterThan(DEFAULT_MUSCLE_TARGET);
  });

  it("treats non-finite concurrentLoadMod as 1.0", () => {
    const r = defaultMuscleTargets({
      focusMuscles: ["biceps"],
      concurrentLoadMod: NaN,
    });
    // Should match the 1.0 path.
    const r2 = defaultMuscleTargets({
      focusMuscles: ["biceps"],
      concurrentLoadMod: 1.0,
    });
    expect(r.targetsByMuscle).toEqual(r2.targetsByMuscle);
  });

  it("treats non-finite elbowForearmAtlRatio as 1.0 (no gate)", () => {
    const r = defaultMuscleTargets({
      focusMuscles: ["forearms"],
      elbowForearmAtlRatio: NaN,
    });
    expect(r.forearmGateActive).toBe(false);
  });
});
