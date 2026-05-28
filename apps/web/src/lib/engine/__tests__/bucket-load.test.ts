import { describe, it, expect } from "vitest";
import {
  ALL_BUCKETS,
  setBucketLoad,
  cardioBucketLoad,
  addBucketLoads,
  ZERO_BUCKET_LOAD,
} from "../bucket-load";
import { rpeMultiplier } from "../set-load";

const SQUAT = { axialLoad: "high", highStrainTendon: false };
const DL = { axialLoad: "high", highStrainTendon: true };
const CURL = { axialLoad: "low", highStrainTendon: false };

describe("setBucketLoad", () => {
  it("zero-out for invalid inputs", () => {
    expect(setBucketLoad({ reps: 0, weightKg: 100, rpe: 8 }, SQUAT)).toEqual(ZERO_BUCKET_LOAD);
    expect(setBucketLoad({ reps: 5, weightKg: 0, rpe: 8 }, SQUAT)).toEqual(ZERO_BUCKET_LOAD);
  });

  it("heavy squat (5 reps @ RPE 9) loads neural + axial heavily", () => {
    const b = setBucketLoad({ reps: 5, weightKg: 150, rpe: 9 }, SQUAT);
    // baseLoad = 5*150*0.85 = 637.5
    expect(b.mechanical).toBeCloseTo(637.5, 1);
    // Neural fully credited at >=85% intensity (RPE 9 ≈ 92%).
    expect(b.neural).toBeCloseTo(637.5, 1);
    // Axial high -> baseLoad * 1.0.
    expect(b.axial).toBeCloseTo(637.5, 1);
    // Tissue (no tendon flag, high intensity) -> baseLoad * 0.4.
    expect(b.tissue).toBeCloseTo(637.5 * 0.4, 1);
    // Impact tiny without tendon flag.
    expect(b.impact).toBeCloseTo(637.5 * 0.05, 1);
  });

  it("high-strain-tendon deadlift adds impact + tissue heavily", () => {
    const b = setBucketLoad({ reps: 3, weightKg: 200, rpe: 9 }, DL);
    expect(b.impact).toBeGreaterThan(b.mechanical * 0.4);
    expect(b.tissue).toBeGreaterThan(b.mechanical * 0.5);
  });

  it("high-rep curl is metabolic but not axial / neural / impact", () => {
    const b = setBucketLoad({ reps: 15, weightKg: 20, rpe: 8 }, CURL);
    // metabolicMul = 0.85 for reps >= 12
    expect(b.metabolic).toBeGreaterThan(b.neural);
    expect(b.axial).toBe(0);
    expect(b.impact).toBeLessThan(b.mechanical * 0.1);
  });

  it("light recovery wave at low intensity loads neural lightly", () => {
    const heavy = setBucketLoad({ reps: 5, weightKg: 100, rpe: 9 }, SQUAT);
    const light = setBucketLoad({ reps: 5, weightKg: 60, rpe: 6 }, SQUAT);
    expect(light.neural / light.mechanical).toBeLessThan(heavy.neural / heavy.mechanical);
  });

  it("percentTm overrides RPE-derived intensity when present", () => {
    const explicit = setBucketLoad({ reps: 5, weightKg: 100, rpe: 6, percentTm: 90 }, SQUAT);
    const rpeOnly = setBucketLoad({ reps: 5, weightKg: 100, rpe: 6 }, SQUAT);
    // RPE 6 -> intensity 0.74 (mid band, neuralMul 0.5)
    // percentTm 90 -> intensity 0.9 (heavy band, neuralMul 1.0)
    expect(explicit.neural).toBeGreaterThan(rpeOnly.neural);
  });
});

describe("cardioBucketLoad", () => {
  it("zero-out for zero duration", () => {
    expect(cardioBucketLoad({ durationSec: 0, modality: "run", rpe: 7 })).toEqual(ZERO_BUCKET_LOAD);
  });

  it("run dominates impact + tissue; metabolic is universal", () => {
    const run = cardioBucketLoad({ durationSec: 1800, modality: "run", rpe: 7 });
    const ride = cardioBucketLoad({ durationSec: 1800, modality: "bike", rpe: 7 });
    expect(run.impact).toBeGreaterThan(ride.impact * 10);
    expect(run.tissue).toBeGreaterThan(ride.tissue * 5);
    expect(run.metabolic).toBeCloseTo(ride.metabolic, 1);
  });

  it("cycling: high metabolic, almost zero impact + tissue", () => {
    const b = cardioBucketLoad({ durationSec: 3600, modality: "bike", rpe: 7 });
    expect(b.metabolic).toBeGreaterThan(b.impact * 10);
    expect(b.axial).toBe(0);
    expect(b.mechanical).toBe(0);
  });

  it("hard effort cardio (RPE >= 8) gets a neural premium", () => {
    const easy = cardioBucketLoad({ durationSec: 1800, modality: "run", rpe: 5 });
    const hard = cardioBucketLoad({ durationSec: 1800, modality: "run", rpe: 9 });
    expect(hard.neural / hard.metabolic).toBeGreaterThan(easy.neural / easy.metabolic);
  });
});

describe("addBucketLoads", () => {
  it("sums every bucket pointwise", () => {
    const a = { neural: 1, mechanical: 2, metabolic: 3, impact: 4, axial: 5, tissue: 6 };
    const b = { neural: 10, mechanical: 20, metabolic: 30, impact: 40, axial: 50, tissue: 60 };
    const out = addBucketLoads(a, b);
    for (const k of ALL_BUCKETS) {
      expect(out[k]).toBe(a[k] + b[k]);
    }
  });
});

describe("invariant: bucket-load uses the same RPE scale as set-load", () => {
  // Before the consolidation, bucket-load.ts redefined `rpeMultiplier`
  // byte-identically to set-load.ts's. After consolidation it imports
  // the canonical version. Pin the contract so a future tweak of the
  // multiplier in set-load.ts propagates into bucket-load without
  // silently drifting.
  it("mechanical bucket at known RPEs equals reps × weight × shared rpeMultiplier", () => {
    const SQUAT = { axialLoad: "high" as const, highStrainTendon: false };
    for (const rpe of [6, 7, 8, 9, 10]) {
      const b = setBucketLoad({ reps: 5, weightKg: 100, rpe }, SQUAT);
      expect(b.mechanical).toBeCloseTo(5 * 100 * rpeMultiplier(rpe), 6);
    }
  });

  it("missing RPE uses the same 0.5 default as set-load", () => {
    const SQUAT = { axialLoad: "high" as const, highStrainTendon: false };
    const b = setBucketLoad({ reps: 5, weightKg: 100 }, SQUAT);
    expect(b.mechanical).toBeCloseTo(5 * 100 * rpeMultiplier(null), 6);
    expect(b.mechanical).toBeCloseTo(250, 6);
  });
});
