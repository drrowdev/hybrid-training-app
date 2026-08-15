/**
 * ADR 0070 — prescription fidelity.
 *
 * These pin the two rules that keep the surface honest: a missing snapshot is
 * "unknown" rather than "on plan", and declining a discretionary set is
 * autoregulation working, not a miss.
 */
import { describe, expect, it } from "vitest";
import {
  setFidelity,
  rollupFidelity,
  fidelitySummaryLine,
  FIDELITY_TOLERANCE,
  type FidelitySetInput,
} from "./prescription-fidelity";

const onPlan: FidelitySetInput = {
  weightKg: 100,
  reps: 5,
  skipped: false,
  targetWeightKg: 100,
  targetReps: 5,
};

describe("setFidelity", () => {
  it("reports no shortfall for a set that matched", () => {
    const f = setFidelity(onPlan);
    expect(f.loadShortfall).toBe(0);
    expect(f.repShortfall).toBe(0);
    expect(f.comparable).toBe(true);
  });

  it("measures a load pullback", () => {
    expect(setFidelity({ ...onPlan, weightKg: 90 }).loadShortfall).toBeCloseTo(0.1);
  });

  it("measures reps cut short", () => {
    expect(setFidelity({ ...onPlan, reps: 3 }).repShortfall).toBeCloseTo(0.4);
  });

  it("reports a negative shortfall when the lifter went heavier", () => {
    expect(setFidelity({ ...onPlan, weightKg: 110 }).loadShortfall!).toBeLessThan(0);
  });

  it("treats a skipped set as a total shortfall of what it prescribed", () => {
    const f = setFidelity({ ...onPlan, weightKg: 0, reps: 0, skipped: true });
    expect(f.loadShortfall).toBe(1);
    expect(f.repShortfall).toBe(1);
  });

  it("is not comparable without a snapshot", () => {
    const f = setFidelity({
      ...onPlan,
      targetWeightKg: null,
      targetReps: null,
    });
    expect(f.comparable).toBe(false);
    expect(f.loadShortfall).toBeNull();
  });

  it("compares reps alone when the movement has no prescribed load", () => {
    const f = setFidelity({ ...onPlan, targetWeightKg: null });
    expect(f.comparable).toBe(true);
    expect(f.loadShortfall).toBeNull();
    expect(f.repShortfall).toBe(0);
  });
});

describe("rollupFidelity", () => {
  it("returns no-data when nothing carries a snapshot", () => {
    const r = rollupFidelity([
      { ...onPlan, targetWeightKg: null, targetReps: null },
      { ...onPlan, targetWeightKg: null, targetReps: null },
    ]);
    expect(r.verdict).toBe("no-data");
    expect(r.comparableSets).toBe(0);
    expect(r.unknownSets).toBe(2);
  });

  it("never counts an un-snapshotted set as on-plan", () => {
    // The whole point: pre-migration history must not inflate adherence.
    const r = rollupFidelity([
      onPlan,
      { ...onPlan, targetWeightKg: null, targetReps: null },
    ]);
    expect(r.comparableSets).toBe(1);
    expect(r.onPlanSets).toBe(1);
    expect(r.unknownSets).toBe(1);
  });

  it("reads a clean session as on-plan", () => {
    const r = rollupFidelity([onPlan, onPlan, onPlan]);
    expect(r.verdict).toBe("on-plan");
    expect(r.onPlanSets).toBe(3);
  });

  it("reads a pullback as eased", () => {
    const r = rollupFidelity([onPlan, { ...onPlan, weightKg: 85 }]);
    expect(r.verdict).toBe("eased");
    expect(r.easedSets).toBe(1);
    expect(r.avgLoadShortfall).toBeCloseTo(0.075);
  });

  it("reads heavier work as pushed", () => {
    const r = rollupFidelity([{ ...onPlan, weightKg: 110 }]);
    expect(r.verdict).toBe("pushed");
  });

  it("reads both directions as mixed", () => {
    const r = rollupFidelity([
      { ...onPlan, weightKg: 85 },
      { ...onPlan, weightKg: 115 },
    ]);
    expect(r.verdict).toBe("mixed");
  });

  it("counts reps cut at full load as eased", () => {
    const r = rollupFidelity([{ ...onPlan, reps: 2 }]);
    expect(r.easedSets).toBe(1);
    expect(r.verdict).toBe("eased");
  });

  it("TB: a declined discretionary set is not a miss", () => {
    // "3-5 sets" — stopping at 3 is compliance. This must not read as eased,
    // and must not drag the verdict off on-plan.
    const r = rollupFidelity([
      onPlan,
      onPlan,
      onPlan,
      { ...onPlan, weightKg: 0, reps: 0, skipped: true, optional: true },
      { ...onPlan, weightKg: 0, reps: 0, skipped: true, optional: true },
    ]);
    expect(r.verdict).toBe("on-plan");
    expect(r.skippedOptional).toBe(2);
    expect(r.skippedRequired).toBe(0);
    expect(r.easedSets).toBe(0);
    expect(r.comparableSets).toBe(3);
  });

  it("a skipped REQUIRED set does count against fidelity", () => {
    const r = rollupFidelity([
      onPlan,
      { ...onPlan, weightKg: 0, reps: 0, skipped: true },
    ]);
    expect(r.skippedRequired).toBe(1);
    expect(r.verdict).toBe("eased");
  });

  it("ignores drift inside the plate-rounding tolerance", () => {
    const inside = 100 * (1 - FIDELITY_TOLERANCE / 2);
    const r = rollupFidelity([{ ...onPlan, weightKg: inside }]);
    expect(r.verdict).toBe("on-plan");
  });
});

describe("fidelitySummaryLine", () => {
  it("says nothing when there is no data", () => {
    expect(fidelitySummaryLine(rollupFidelity([]))).toBeNull();
  });

  it("confirms a clean session", () => {
    expect(fidelitySummaryLine(rollupFidelity([onPlan, onPlan]))).toBe(
      "Logged as prescribed",
    );
  });

  it("notes declined optional work without calling it a shortfall", () => {
    const line = fidelitySummaryLine(
      rollupFidelity([
        onPlan,
        { ...onPlan, weightKg: 0, reps: 0, skipped: true, optional: true },
      ]),
    );
    expect(line).toBe("Logged as prescribed · 1 set of optional work not taken");
  });

  it("describes a pullback without prescribing a response", () => {
    const line = fidelitySummaryLine(rollupFidelity([{ ...onPlan, weightKg: 90 }]))!;
    expect(line).toContain("1 set under target");
    expect(line).toContain("load down 10% on average");
    // Reflection, not instruction.
    expect(line).not.toMatch(/should|consider|try|recommend/i);
  });
});
