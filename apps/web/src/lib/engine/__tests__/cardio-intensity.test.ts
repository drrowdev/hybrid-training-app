import { describe, it, expect } from "vitest";
import {
  cardioIntensityScalar,
  normaliseHrZones,
  ZONE_INTENSITY_WEIGHTS,
  CARDIO_INTENSITY_MIN,
  CARDIO_INTENSITY_MAX,
  type HrZones,
} from "../cardio-intensity";
import { cardioBucketLoad } from "../bucket-load";

const fullyZ = (zone: keyof HrZones, sec: number): HrZones => {
  const z: HrZones = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 };
  z[zone] = sec;
  return z;
};

describe("cardioIntensityScalar — HR-zone driven path", () => {
  it("fully-Z2 session returns the Z2 weight (0.8)", () => {
    const s = cardioIntensityScalar({
      hrZones: fullyZ("z2", 1800),
      durationSec: 1800,
      rpe: 5,
    });
    expect(s).toBeCloseTo(ZONE_INTENSITY_WEIGHTS.z2, 6);
    expect(s).toBeCloseTo(0.8, 6);
  });

  it("fully-Z5 session returns the Z5 weight (2.2)", () => {
    const s = cardioIntensityScalar({
      hrZones: fullyZ("z5", 600),
      durationSec: 600,
      rpe: 9,
    });
    expect(s).toBeCloseTo(ZONE_INTENSITY_WEIGHTS.z5, 6);
    expect(s).toBeCloseTo(2.2, 6);
  });

  it("80/20 polarised (Z2 + Z5) returns the weighted mean", () => {
    const total = 3600;
    const z2sec = Math.round(total * 0.8);
    const z5sec = total - z2sec;
    const zones: HrZones = { z1: 0, z2: z2sec, z3: 0, z4: 0, z5: z5sec };
    const expected =
      (z2sec * ZONE_INTENSITY_WEIGHTS.z2 + z5sec * ZONE_INTENSITY_WEIGHTS.z5) /
      total;
    const s = cardioIntensityScalar({
      hrZones: zones,
      durationSec: total,
      rpe: 7,
    });
    expect(s).toBeCloseTo(expected, 6);
    // Sanity: 0.8*0.8 + 0.2*2.2 = 0.64 + 0.44 = 1.08
    expect(s).toBeCloseTo(1.08, 2);
  });

  it("ignores rpe entirely when hrZones is present (HR is ground truth)", () => {
    const z2 = fullyZ("z2", 1800);
    const withLowRpe = cardioIntensityScalar({
      hrZones: z2,
      durationSec: 1800,
      rpe: 2,
    });
    const withHighRpe = cardioIntensityScalar({
      hrZones: z2,
      durationSec: 1800,
      rpe: 10,
    });
    expect(withLowRpe).toBeCloseTo(withHighRpe, 6);
    expect(withLowRpe).toBeCloseTo(0.8, 6);
  });

  it("zones with all-zero seconds falls back to rpe path", () => {
    const empty: HrZones = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 };
    const s = cardioIntensityScalar({
      hrZones: empty,
      durationSec: 1800,
      rpe: 6,
    });
    expect(s).toBeCloseTo(0.6, 6);
  });

  it("clamps to [0.3, 2.5] in pathological all-Z5 cases (never breaches cap)", () => {
    const s = cardioIntensityScalar({
      hrZones: fullyZ("z5", 60),
      durationSec: 60,
      rpe: 10,
    });
    expect(s).toBeGreaterThanOrEqual(CARDIO_INTENSITY_MIN);
    expect(s).toBeLessThanOrEqual(CARDIO_INTENSITY_MAX);
  });
});

describe("cardioIntensityScalar — RPE fall-back path (no hr_zones)", () => {
  it("rpe=6 → 0.6 (matches legacy clamp(rpe/10) path)", () => {
    const s = cardioIntensityScalar({
      hrZones: null,
      durationSec: 1800,
      rpe: 6,
    });
    expect(s).toBeCloseTo(0.6, 6);
  });

  it("rpe=null → 0.5 (legacy default for missing rpe)", () => {
    const s = cardioIntensityScalar({
      hrZones: null,
      durationSec: 1800,
      rpe: null,
    });
    expect(s).toBeCloseTo(0.5, 6);
  });

  it("rpe=10 → 1.0 (legacy upper bound)", () => {
    const s = cardioIntensityScalar({
      hrZones: null,
      durationSec: 1800,
      rpe: 10,
    });
    expect(s).toBeCloseTo(1.0, 6);
  });

  it("very high rpe still clamps at 1.0 (never exceeds legacy ceiling without HR data)", () => {
    const s = cardioIntensityScalar({
      hrZones: null,
      durationSec: 1800,
      rpe: 15,
    });
    expect(s).toBeCloseTo(1.0, 6);
  });

  it("durationSec=0 returns 0 (guards against divide-by-zero callers)", () => {
    const s = cardioIntensityScalar({
      hrZones: fullyZ("z5", 0),
      durationSec: 0,
      rpe: 9,
    });
    expect(s).toBe(0);
  });

  it("negative durationSec returns 0", () => {
    expect(
      cardioIntensityScalar({
        hrZones: null,
        durationSec: -10,
        rpe: 7,
      }),
    ).toBe(0);
  });
});

describe("normaliseHrZones", () => {
  it("accepts lowercase keys (the historical import shape)", () => {
    const z = normaliseHrZones({ z1: 60, z2: 1200, z3: 300, z4: 200, z5: 40 });
    expect(z).toEqual({ z1: 60, z2: 1200, z3: 300, z4: 200, z5: 40 });
  });

  it("accepts uppercase keys defensively", () => {
    const z = normaliseHrZones({ Z1: 60, Z2: 1200, Z3: 300, Z4: 200, Z5: 40 });
    expect(z).toEqual({ z1: 60, z2: 1200, z3: 300, z4: 200, z5: 40 });
  });

  it("returns null for empty / all-zero / non-object input", () => {
    expect(normaliseHrZones(null)).toBeNull();
    expect(normaliseHrZones(undefined)).toBeNull();
    expect(normaliseHrZones("not an object")).toBeNull();
    expect(normaliseHrZones({ z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 })).toBeNull();
  });

  it("treats missing keys as zero seconds", () => {
    const z = normaliseHrZones({ z2: 1000 });
    expect(z).toEqual({ z1: 0, z2: 1000, z3: 0, z4: 0, z5: 0 });
  });
});

describe("cardioBucketLoad regression — fall-back path unchanged when hr_zones is null", () => {
  // Legacy formula varied by site: bucket-load + region-ledger used
  // `Math.min(1.0, rpe/10)` (no floor), while muscle-freshness used
  // `clamp(rpe/10, 0.3, 1.0)` (with floor). PR #167 unifies all three on
  // the 0.3 floor — the muscle-freshness behaviour wins because counting
  // an RPE-1 cardio session as 10% intensity is almost certainly wrong
  // (it makes a 60-min walk weigh less than the same person's warm-up).
  //
  // For RPE >= 3 the unified scalar equals the legacy bucket-load
  // scalar bit-for-bit, so loads match. For RPE 1-2 the floor activates
  // (covered in the explicit-floor block below).
  const legacyIntensity = (rpe: number | null): number =>
    rpe == null ? 0.5 : Math.min(1.0, rpe / 10);

  for (const rpe of [3, 5, 6, 7, 8, 9, 10, null] as const) {
    it(`run, RPE=${rpe ?? "null"} → same metabolic as legacy formula`, () => {
      const minutes = 30;
      const durationSec = minutes * 60;
      const before = minutes * legacyIntensity(rpe) * 8;
      const b = cardioBucketLoad({
        durationSec,
        rpe,
        modality: "run",
        hrZones: null,
      });
      // metabolic = baseLoad * 1.0 → must equal old baseLoad
      expect(b.metabolic).toBeCloseTo(before, 6);
    });
  }

  it("absent hrZones field (undefined) is treated as fall-back", () => {
    const b = cardioBucketLoad({
      durationSec: 1800,
      rpe: 7,
      modality: "bike",
    });
    // legacy: 30 * 0.7 * 8 = 168 → metabolic = 168
    expect(b.metabolic).toBeCloseTo(168, 6);
  });
});

describe("cardioBucketLoad — RPE 1-2 floor (intentional unification)", () => {
  // Pre-#167 behaviour was inconsistent:
  //   bucket-load.ts     → no floor → RPE 1 = 0.1 intensity
  //   region-ledger.ts   → no floor → RPE 1 = 0.1 intensity
  //   muscle-freshness.ts → floor 0.3 → RPE 1 = 0.3 intensity
  // PR #167 unifies on 0.3 across all three. These tests pin the new
  // contract so a future regression that drops the floor is caught.
  for (const rpe of [1, 2] as const) {
    it(`RPE=${rpe} fall-back floors at 0.3 (was ${rpe / 10} in bucket-load pre-#167)`, () => {
      const minutes = 30;
      const b = cardioBucketLoad({
        durationSec: minutes * 60,
        rpe,
        modality: "run",
        hrZones: null,
      });
      // Unified: minutes * 0.3 * 8 = 72  (was minutes * rpe/10 * 8)
      expect(b.metabolic).toBeCloseTo(minutes * 0.3 * 8, 6);
    });
  }
});

describe("cardioBucketLoad — HR-aware path differs from RPE fall-back", () => {
  it("same duration, two sessions: Z2-heavy vs Z5-heavy → very different loads", () => {
    const dur = 3600; // 1 hour
    const easy = cardioBucketLoad({
      durationSec: dur,
      rpe: 6,
      modality: "bike",
      hrZones: fullyZ("z2", dur),
    });
    const hard = cardioBucketLoad({
      durationSec: dur,
      rpe: 6,
      modality: "bike",
      hrZones: fullyZ("z5", dur),
    });
    // 60 min * 0.8 * 8 = 384  vs  60 min * 2.2 * 8 = 1056
    expect(easy.metabolic).toBeCloseTo(384, 4);
    expect(hard.metabolic).toBeCloseTo(1056, 4);
    expect(hard.metabolic / easy.metabolic).toBeCloseTo(2.2 / 0.8, 3);
  });

  it("Z5 work flips the neural premium even at low logged RPE", () => {
    // Imported rows can carry a low rpe for short hard intervals;
    // when HR zones say Z5, the neural premium should still trigger.
    const z5 = cardioBucketLoad({
      durationSec: 1200,
      rpe: 4, // low logged RPE — would NOT have hit hardEffort under legacy
      modality: "run",
      hrZones: fullyZ("z5", 1200),
    });
    // hardEffort = intensity (2.2) >= 0.8 → neural mul 0.4
    // baseLoad = 20 * 2.2 * 8 = 352 → neural = 352 * 0.4 = 140.8
    expect(z5.neural).toBeCloseTo(140.8, 3);
  });

  it("Z2-dominant session with same RPE keeps neural muted", () => {
    const z2 = cardioBucketLoad({
      durationSec: 1800,
      rpe: 7,
      modality: "bike",
      hrZones: fullyZ("z2", 1800),
    });
    // intensity 0.8 → hardEffort just barely true; neural * 0.4
    // baseLoad = 30 * 0.8 * 8 = 192 → neural = 192 * 0.4 = 76.8
    expect(z2.neural).toBeCloseTo(76.8, 3);
    // Running-only buckets should be zero for bike modality.
    expect(z2.axial).toBe(0);
    expect(z2.mechanical).toBe(0);
  });
});
