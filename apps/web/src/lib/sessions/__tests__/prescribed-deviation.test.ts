/**
 * ADR 0070 / DC-K4 — prescribed-vs-actual deviation semantics.
 *
 * The engine's override audit records skips and swaps, but until now a set
 * performed at a reduced load or rep count was indistinguishable from one
 * executed as written. These cases pin the semantics the stored snapshot must
 * support, using the shape `set_logs` rows now carry.
 */
import { describe, expect, it } from "vitest";
import { resolvePrescribedSnapshot } from "@hta/domain";

type Row = {
  weight_kg: number | null;
  reps: number | null;
  skipped: boolean;
  target_weight_kg: number | null;
  target_reps: number | null;
};

/**
 * Load shortfall as a fraction of the prescribed load, or null when no
 * comparison is possible. NULL targets (pre-0070 rows, free-form logs,
 * uncorroborated submissions) must never be read as "on target".
 */
function loadShortfall(row: Row): number | null {
  if (row.target_weight_kg == null || row.target_weight_kg <= 0) return null;
  if (row.weight_kg == null) return null;
  return (row.target_weight_kg - row.weight_kg) / row.target_weight_kg;
}

function repShortfall(row: Row): number | null {
  if (row.target_reps == null || row.target_reps <= 0) return null;
  if (row.reps == null) return null;
  return (row.target_reps - row.reps) / row.target_reps;
}

const base: Row = {
  weight_kg: 100,
  reps: 5,
  skipped: false,
  target_weight_kg: 100,
  target_reps: 5,
};

describe("DC-K4 — a reduced-load set is recorded as a deviation", () => {
  it("detects a load pullback that was previously invisible", () => {
    const row: Row = { ...base, weight_kg: 90 };
    expect(loadShortfall(row)).toBeCloseTo(0.1);
  });

  it("detects reps cut short", () => {
    const row: Row = { ...base, reps: 3 };
    expect(repShortfall(row)).toBeCloseTo(0.4);
  });

  it("reports no shortfall when the set landed as programmed", () => {
    expect(loadShortfall(base)).toBe(0);
    expect(repShortfall(base)).toBe(0);
  });

  it("reports a negative shortfall when the user went heavier", () => {
    const row: Row = { ...base, weight_kg: 105 };
    expect(loadShortfall(row)!).toBeLessThan(0);
  });

  it("treats a skip as a whole-set deviation, not a missing row", () => {
    // Skipped rows persist as 0/0 but KEEP their snapshot, so the magnitude of
    // the deviation is exactly the prescribed set.
    const row: Row = { ...base, weight_kg: 0, reps: 0, skipped: true };
    expect(loadShortfall(row)).toBe(1);
    expect(repShortfall(row)).toBe(1);
  });
});

describe("NULL snapshots degrade to 'unknown', never to 'on target'", () => {
  it("returns null for a pre-migration row", () => {
    const row: Row = { ...base, target_weight_kg: null, target_reps: null };
    expect(loadShortfall(row)).toBeNull();
    expect(repShortfall(row)).toBeNull();
  });

  it("returns null for a free-form log with no prescription", () => {
    const row: Row = {
      weight_kg: 60,
      reps: 12,
      skipped: false,
      target_weight_kg: null,
      target_reps: null,
    };
    expect(loadShortfall(row)).toBeNull();
  });

  it("returns null for an unanchored movement with reps but no prescribed load", () => {
    const row: Row = { ...base, target_weight_kg: null };
    expect(loadShortfall(row)).toBeNull();
    expect(repShortfall(row)).toBe(0);
  });
});

describe("Tactical Barbell cluster sets — required vs discretionary", () => {
  // The motivating case: "3 sets minimum, up to 5". Sets beyond the minimum are
  // materialised as `optional`, and skipping one is a legitimate autoregulatory
  // choice — NOT a missed set. Without the snapshot the engine cannot tell them
  // apart, which is what blocked the feature.
  const required = { kind: "main", percentTm: 75, reps: 5, setRange: { min: 3, max: 5 } };
  const discretionary = { ...required, optional: true };

  it("marks a discretionary set so a skip is not read as a miss", () => {
    const r = resolvePrescribedSnapshot(required, { tmKg: 100 });
    const d = resolvePrescribedSnapshot(discretionary, { tmKg: 100 });
    expect(r.prescribed?.optional).toBeUndefined();
    expect(d.prescribed?.optional).toBe(true);
  });

  it("preserves the cluster range so the engine knows the minimum was met", () => {
    const d = resolvePrescribedSnapshot(discretionary, { tmKg: 100 });
    expect(d.prescribed?.setRange).toEqual({ min: 3, max: 5 });
  });

  it("keeps the prescribed load on every set of the cluster", () => {
    const d = resolvePrescribedSnapshot(discretionary, { tmKg: 100 });
    expect(d.targetWeightKg).toBe(75);
  });
});
