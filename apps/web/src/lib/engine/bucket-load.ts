/**
 * Per-bucket load contribution (DC-A3 six-bucket model, v2 §3).
 *
 * Each working set + cardio block contributes weighted load to the six
 * global stress buckets. The weights are functions of movement metadata
 * (axial_load, high_strain_tendon, modality) and per-set intensity (RPE,
 * %TM). Loads aggregate per day, then 7d EWMA -> ATL_b and 28d EWMA ->
 * CTL_b, mirroring the region-freshness pipeline (DC-A5 / DC-C14).
 *
 * Citations:
 *   - DC-A3 (Bucket taxonomy)
 *   - Pareja-Blanco 2017/2020 (proximity-to-failure damage premium)
 *   - Gabbett 2016 (ACWR ratios)
 *   - Wilson 2012 (modality-specific interference)
 *
 * Bucket definitions (engine-internal labels stay technical; user-facing
 * surfaces translate via BUCKET_DISPLAY in bucket-state-queries.ts):
 *   neural     — CNS / max recruitment demand (heavy %TM, low reps)
 *   mechanical — Muscle damage / tonnage (sets × reps × weight)
 *   metabolic  — Glycolytic / lactate (high-rep, short-rest, hard cardio)
 *   impact     — Eccentric pounding (running, plyo, heavy eccentrics)
 *   axial      — Spinal compression (squats, deadlifts, OHP, carries)
 *   tissue     — Connective / tendon (heavy isometrics, very-heavy lifts, running)
 */
import type { Bucket } from "@hta/domain";

export const ALL_BUCKETS: readonly Bucket[] = [
  "neural",
  "mechanical",
  "metabolic",
  "impact",
  "axial",
  "tissue",
] as const;

export type BucketLoad = Record<Bucket, number>;

export const ZERO_BUCKET_LOAD: BucketLoad = {
  neural: 0,
  mechanical: 0,
  metabolic: 0,
  impact: 0,
  axial: 0,
  tissue: 0,
};

function rpeMultiplier(rpe: number | null | undefined): number {
  if (rpe == null) return 0.5;
  if (rpe >= 10) return 1.0;
  if (rpe >= 9) return 0.85;
  if (rpe >= 8) return 0.7;
  if (rpe >= 7) return 0.55;
  if (rpe >= 6) return 0.4;
  return 0.3;
}

/**
 * Rep-aware intensity proxy (%1RM-ish) when an explicit percentTm wasn't
 * logged. Per Helms 2016 / Zourdos 2016 RPE chart, %1RM at a given RPE
 * drops as reps go up: 1 rep @ RPE 8 ≈ 92%, 5 reps @ RPE 8 ≈ 80%, 12
 * reps @ RPE 8 ≈ 64%. Approximate with a linear ~2% per extra rep slope.
 *
 * Used only to gate the neural bucket band (heavy / mid / light).
 */
function intensityFromRpeAndReps(rpe: number | null | undefined, reps: number): number {
  const baseAt1Rep =
    rpe == null
      ? 0.82
      : rpe >= 10
        ? 1.0
        : rpe >= 9
          ? 0.96
          : rpe >= 8
            ? 0.92
            : rpe >= 7
              ? 0.88
              : rpe >= 6
                ? 0.84
                : 0.8;
  const decay = 0.02 * Math.max(0, reps - 1);
  return Math.max(0.5, baseAt1Rep - decay);
}

const AXIAL_WEIGHT: Record<string, number> = {
  low: 0.0,
  moderate: 0.5,
  high: 1.0,
};

export type SetInput = {
  reps: number;
  weightKg: number;
  rpe?: number | null;
  percentTm?: number | null;
};

export type SetMovementMeta = {
  axialLoad: string | null;
  highStrainTendon: boolean;
};

/**
 * Per-set bucket contribution. Returns a Record<Bucket, number> in kg-load
 * units (same magnitude as set-load.ts so cardio and strength stay
 * comparable). Warmup sets should be filtered upstream — this function
 * does not look at set_kind.
 */
export function setBucketLoad(set: SetInput, movement: SetMovementMeta): BucketLoad {
  if (set.reps <= 0 || set.weightKg <= 0) return { ...ZERO_BUCKET_LOAD };
  const tonnage = set.reps * set.weightKg;
  const rpeMul = rpeMultiplier(set.rpe);
  const baseLoad = tonnage * rpeMul;
  const intensity = set.percentTm != null ? set.percentTm / 100 : intensityFromRpeAndReps(set.rpe, set.reps);
  const axialMul = AXIAL_WEIGHT[movement.axialLoad ?? "low"] ?? 0;
  const tendon = movement.highStrainTendon;

  // Neural bands: heavy (>=85% TM) = full credit, mid = partial, light = trace.
  const neuralMul = intensity >= 0.85 ? 1.0 : intensity >= 0.7 ? 0.5 : 0.15;
  // Metabolic: high-rep work + sub-maximal weight drives lactate.
  const metabolicMul = set.reps >= 12 ? 0.85 : set.reps >= 8 ? 0.55 : 0.2;
  // Impact: only high-strain-tendon strength work (heavy DLs, Nordics, plyo).
  const impactMul = tendon ? 0.5 : 0.05;
  // Tissue: very-heavy or tendon-strain work.
  const tissueMul = tendon ? 0.8 : intensity >= 0.85 ? 0.4 : 0.15;

  return {
    neural: baseLoad * neuralMul,
    mechanical: baseLoad, // direct tonnage proxy
    metabolic: baseLoad * metabolicMul,
    impact: baseLoad * impactMul,
    axial: baseLoad * axialMul,
    tissue: baseLoad * tissueMul,
  };
}

export type CardioInput = {
  durationSec: number;
  rpe?: number | null;
  modality: string | null;
};

const CARDIO_SCALAR = 8; // matches region-ledger so magnitudes line up

/**
 * Per-cardio-block bucket contribution. Running is the heavy hitter for
 * impact + tissue; cycling/rowing/swimming stay in metabolic primarily.
 */
export function cardioBucketLoad(cardio: CardioInput): BucketLoad {
  const minutes = cardio.durationSec / 60;
  if (minutes <= 0) return { ...ZERO_BUCKET_LOAD };
  const rpeFactor = cardio.rpe == null ? 0.5 : Math.min(1.0, Number(cardio.rpe) / 10);
  const baseLoad = minutes * rpeFactor * CARDIO_SCALAR;

  const modality = (cardio.modality ?? "").toLowerCase();
  const isRunning = modality === "run";
  const isImpactCardio = isRunning || modality === "walk";
  const hardEffort = rpeFactor >= 0.8;

  return {
    neural: baseLoad * (hardEffort ? 0.4 : 0.1),
    mechanical: 0,
    metabolic: baseLoad * 1.0,
    impact: baseLoad * (isRunning ? 0.8 : isImpactCardio ? 0.3 : 0.05),
    axial: 0,
    tissue: baseLoad * (isRunning ? 0.4 : 0.05),
  };
}

/** Pointwise sum of two bucket loads. */
export function addBucketLoads(a: BucketLoad, b: BucketLoad): BucketLoad {
  return {
    neural: a.neural + b.neural,
    mechanical: a.mechanical + b.mechanical,
    metabolic: a.metabolic + b.metabolic,
    impact: a.impact + b.impact,
    axial: a.axial + b.axial,
    tissue: a.tissue + b.tissue,
  };
}
