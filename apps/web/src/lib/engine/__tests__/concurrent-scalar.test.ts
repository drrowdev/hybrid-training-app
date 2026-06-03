/**
 * Tests for the modality-aware continuous concurrent-training scalar.
 *
 * Pins the continuity properties documented in
 * `lib/engine/concurrent-scalar.ts` — these are the load-bearing
 * guarantees that the legacy binary 0.7× trigger remains a special
 * case of the new continuous formula, and that the modality ordering
 * (run > swim > row > bike, ruck > walk) is encoded in the math.
 */
import { describe, it, expect } from "vitest";

import {
  MODALITY_INTERFERENCE,
  computeConcurrentScalar,
  computeConcurrentScalarFromBlocks,
  isConcurrentScaled,
} from "../concurrent-scalar";

describe("computeConcurrentScalar — continuity pins", () => {
  it("zero cardio returns 1.0 (no compression)", () => {
    expect(computeConcurrentScalar({})).toBe(1.0);
    expect(computeConcurrentScalar({ run: 0, bike: 0 })).toBe(1.0);
  });

  it("300 min run-only ≈ 0.70 (matches legacy binary trigger)", () => {
    expect(computeConcurrentScalar({ run: 300 })).toBeCloseTo(0.70, 3);
  });

  it("600 min run-only saturates at the 0.60 floor", () => {
    expect(computeConcurrentScalar({ run: 600 })).toBeCloseTo(0.60, 3);
  });

  it("1000 min run-only stays pinned at the floor (no underflow)", () => {
    expect(computeConcurrentScalar({ run: 1000 })).toBeCloseTo(0.60, 3);
  });
});

describe("computeConcurrentScalar — modality differential", () => {
  it("bike 300 min is materially less compressive than run 300 min", () => {
    const bike = computeConcurrentScalar({ bike: 300 });
    const run = computeConcurrentScalar({ run: 300 });
    // bike coef 0.4 → weighted 120 → 1.0 - 0.30 * (120/300) = 0.88.
    expect(bike).toBeCloseTo(0.88, 3);
    expect(run).toBeCloseTo(0.70, 3);
    // "Materially": at least 0.15 scalar gap at the legacy trigger point.
    expect(bike - run).toBeGreaterThanOrEqual(0.15);
  });

  it("swim 250 min is no more compressive than run 150 min", () => {
    // swim coef 0.6 × 250 = 150 weighted; run coef 1.0 × 150 = 150
    // weighted. The two tie at the legacy spec'd test values — the
    // important contract is the modality direction, not strict
    // inequality at this exact pair. We additionally pin a strict-
    // inequality case below where minutes are slightly lower.
    const swim = computeConcurrentScalar({ swim: 250 });
    const run = computeConcurrentScalar({ run: 150 });
    expect(swim).toBeGreaterThanOrEqual(run);
  });

  it("swim 200 min is strictly less compressive than run 150 min", () => {
    // Extra explicit guard against the modality ordering collapsing.
    const swim = computeConcurrentScalar({ swim: 200 });
    const run = computeConcurrentScalar({ run: 150 });
    expect(swim).toBeGreaterThan(run);
  });

  it("walk is the lowest-interference modality per minute", () => {
    expect(MODALITY_INTERFERENCE.walk).toBeLessThan(MODALITY_INTERFERENCE.bike);
    expect(MODALITY_INTERFERENCE.walk).toBeLessThan(MODALITY_INTERFERENCE.swim);
    expect(MODALITY_INTERFERENCE.walk).toBeLessThan(MODALITY_INTERFERENCE.run);
  });

  it("ruck sits between walk and run (loaded carry)", () => {
    expect(MODALITY_INTERFERENCE.ruck).toBeGreaterThan(MODALITY_INTERFERENCE.walk);
    expect(MODALITY_INTERFERENCE.ruck).toBeLessThan(MODALITY_INTERFERENCE.run);
  });
});

describe("computeConcurrentScalar — monotonicity", () => {
  it("scalar is non-increasing in run minutes", () => {
    let prev = Infinity;
    for (let m = 0; m <= 800; m += 50) {
      const s = computeConcurrentScalar({ run: m });
      expect(s).toBeLessThanOrEqual(prev + 1e-9);
      prev = s;
    }
  });

  it("scalar is non-increasing across mixed-modality dose sweeps", () => {
    let prev = Infinity;
    for (let m = 0; m <= 400; m += 25) {
      const s = computeConcurrentScalar({ run: m, bike: m, swim: m });
      expect(s).toBeLessThanOrEqual(prev + 1e-9);
      prev = s;
    }
  });

  it("adding cardio never raises the scalar", () => {
    const a = computeConcurrentScalar({ run: 100, bike: 50 });
    const b = computeConcurrentScalar({ run: 100, bike: 50, swim: 80 });
    expect(b).toBeLessThanOrEqual(a);
  });
});

describe("computeConcurrentScalar — mixed modalities", () => {
  it("sums weighted contributions across modalities", () => {
    // run 150 * 1.0 + bike 150 * 0.4 = 150 + 60 = 210 weighted
    // → 1.0 - 0.30 * (210/300) = 0.79
    expect(computeConcurrentScalar({ run: 150, bike: 150 })).toBeCloseTo(0.79, 3);
  });

  it("mixes correctly into the post-knee region", () => {
    // run 300 + bike 300 = 300 + 120 = 420 weighted
    // → 0.7 - 0.10 * ((420 - 300) / 300) = 0.7 - 0.04 = 0.66
    expect(computeConcurrentScalar({ run: 300, bike: 300 })).toBeCloseTo(0.66, 3);
  });
});

describe("computeConcurrentScalar — unknown modality fallback", () => {
  it("falls back to the `other` coefficient (0.7)", () => {
    // pickleball not in table → 0.7 × 300 = 210 weighted → 0.79
    const unknown = computeConcurrentScalar({ pickleball: 300 });
    const explicitOther = computeConcurrentScalar({ other: 300 });
    expect(unknown).toBeCloseTo(0.79, 3);
    expect(unknown).toBeCloseTo(explicitOther, 6);
  });

  it("empty-string and whitespace-only keys are treated as 'other'", () => {
    const blank = computeConcurrentScalar({ "  ": 300 });
    const explicitOther = computeConcurrentScalar({ other: 300 });
    expect(blank).toBeCloseTo(explicitOther, 6);
  });
});

describe("isConcurrentScaled", () => {
  it("true for any scalar materially below 1.0", () => {
    expect(isConcurrentScaled(0.70)).toBe(true);
    expect(isConcurrentScaled(0.88)).toBe(true);
    expect(isConcurrentScaled(0.60)).toBe(true);
  });

  it("false at 1.0 (no cardio)", () => {
    expect(isConcurrentScaled(1.0)).toBe(false);
  });
});

describe("computeConcurrentScalarFromBlocks — back-compat & continuity", () => {
  it("blocks with no zones reduce to the legacy dose curve", () => {
    // run 300 min, no intensity signal → identical to the record path.
    expect(
      computeConcurrentScalarFromBlocks([
        { modality: "run", minutes: 300, hrZones: null, rpe: null },
      ]),
    ).toBeCloseTo(0.70, 3);
  });

  it("matches the modality-record entry point block-for-block", () => {
    const fromRecord = computeConcurrentScalar({ run: 150, bike: 150 });
    const fromBlocks = computeConcurrentScalarFromBlocks([
      { modality: "run", minutes: 150 },
      { modality: "bike", minutes: 150 },
    ]);
    expect(fromBlocks).toBeCloseTo(fromRecord, 6);
    expect(fromBlocks).toBeCloseTo(0.79, 3);
  });

  it("empty block list returns 1.0", () => {
    expect(computeConcurrentScalarFromBlocks([])).toBe(1.0);
  });

  it("rpe-only blocks (no hr zones) are NOT adjusted — intensity ignored", () => {
    // Deliberate Stage-B exclusion: rpe must not move the scalar.
    const withRpe = computeConcurrentScalarFromBlocks([
      { modality: "run", minutes: 300, hrZones: null, rpe: 9 },
    ]);
    expect(withRpe).toBeCloseTo(0.70, 3);
  });
});

describe("computeConcurrentScalarFromBlocks — intensity dimension (ADR 0025)", () => {
  it("fully-Z2 zones equal the no-signal reference (Z2 is the anchor)", () => {
    const z2 = computeConcurrentScalarFromBlocks([
      { modality: "run", minutes: 300, hrZones: { z2: 3600 } },
    ]);
    const noSignal = computeConcurrentScalarFromBlocks([
      { modality: "run", minutes: 300, hrZones: null },
    ]);
    expect(z2).toBeCloseTo(noSignal, 6);
    expect(z2).toBeCloseTo(0.70, 3);
  });

  it("fully-Z5 intervals compress more than the same Z2 minutes", () => {
    const z5 = computeConcurrentScalarFromBlocks([
      { modality: "run", minutes: 120, hrZones: { z5: 3600 } },
    ]);
    const z2 = computeConcurrentScalarFromBlocks([
      { modality: "run", minutes: 120, hrZones: { z2: 3600 } },
    ]);
    expect(z5).toBeLessThan(z2);
  });

  it("recovery-zone (Z1) work compresses less than the Z2 reference", () => {
    const z1 = computeConcurrentScalarFromBlocks([
      { modality: "run", minutes: 200, hrZones: { z1: 3600 } },
    ]);
    const z2 = computeConcurrentScalarFromBlocks([
      { modality: "run", minutes: 200, hrZones: { z2: 3600 } },
    ]);
    expect(z1).toBeGreaterThan(z2);
  });

  it("a hard-intervals week compresses more than an easy week of equal minutes/modality", () => {
    // Same total run minutes, same modality — only the zone mix differs.
    const hard = computeConcurrentScalarFromBlocks([
      { modality: "run", minutes: 200, hrZones: { z2: 3600 } },
      { modality: "run", minutes: 40, hrZones: { z5: 3600 } },
    ]);
    const easy = computeConcurrentScalarFromBlocks([
      { modality: "run", minutes: 200, hrZones: { z2: 3600 } },
      { modality: "run", minutes: 40, hrZones: { z2: 3600 } },
    ]);
    expect(hard).toBeLessThan(easy);
  });

  it("intensity premium is bounded — pure Z5 caps at the 2.75× anchor", () => {
    // 30 min run, pure Z5 → 30 × 1.0 × 2.75 = 82.5 weighted
    // → 1.0 - 0.30 × (82.5/300) = 0.9175. (Not driven to the floor by
    // a single short hard session.)
    const scalar = computeConcurrentScalarFromBlocks([
      { modality: "run", minutes: 30, hrZones: { z5: 3600 } },
    ]);
    expect(scalar).toBeCloseTo(0.9175, 3);
  });

  it("low modality coefficient still dampens a high-intensity block", () => {
    // bike (coef 0.4) Z5: 60 × 0.4 × 2.75 = 66 weighted vs run (coef 1.0)
    // Z5: 60 × 1.0 × 2.75 = 165 weighted — modality ordering survives
    // the intensity weighting.
    const bikeZ5 = computeConcurrentScalarFromBlocks([
      { modality: "bike", minutes: 60, hrZones: { z5: 3600 } },
    ]);
    const runZ5 = computeConcurrentScalarFromBlocks([
      { modality: "run", minutes: 60, hrZones: { z5: 3600 } },
    ]);
    expect(bikeZ5).toBeGreaterThan(runZ5);
  });

  it("unusable zone payloads fall back to the reference (no crash)", () => {
    const garbage = computeConcurrentScalarFromBlocks([
      { modality: "run", minutes: 300, hrZones: { foo: 1 } as unknown },
    ]);
    expect(garbage).toBeCloseTo(0.70, 3);
  });
});
