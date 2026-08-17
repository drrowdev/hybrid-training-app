/**
 * Modality-aware continuous concurrent-training interference scalar.
 *
 * Replaces the previous binary global 0.7× scalar
 * (cardioSessions >= 3 OR cardioMinutes >= 240) with a continuous,
 * modality-weighted dose curve.
 *
 * STRUCTURAL FORM (CP-5):
 *   per Wilson 2012 Med Sci Sports Exerc 44(11), HIGH — meta-analysis
 *   of 21 studies finding running-based concurrent training produces
 *   significant strength + hypertrophy decrements (ES strength -0.18,
 *   hypertrophy -0.35) while cycling-based does not. Confirmed by
 *   Chen 2024 Network Meta-analysis (40 studies, 841 participants)
 *   showing modality-dependent interference.
 *
 *   Dose-response continuity per Schumann 2021 Sports Med (43 studies)
 *   showing concurrent training has graded effects on adaptation.
 *
 * MAGNITUDES (CP-2):
 *   All numeric coefficients in this file are engineering defaults,
 *   calibrated to preserve continuity with the legacy binary scalar
 *   (a 300-min/week run-heavy week returns ~0.7×, matching the old
 *   trigger). Coefficient tuning is Stage B — pending prospective
 *   user-outcome data (planned: 12-week tracking of hypertrophy
 *   outcomes vs cardio modality mix, comparing predicted vs actual
 *   muscle-volume tolerance).
 *
 * INTENSITY DIMENSION (ADR 0025):
 *   The per-block contribution is additionally weighted by an
 *   intensity multiplier derived from time-in-zone, so a minute of
 *   Z5 VO2 work interferes more than a minute of easy Z2. The
 *   multiplier is anchored at the Z2 reference (=1.0) and reuses the
 *   existing `ZONE_INTENSITY_WEIGHTS` — no new intensity coefficients.
 *   Blocks with no objective HR-zone signal contribute at 1.0, so the
 *   legacy dose-only behaviour is preserved exactly.
 */

import {
  ZONE_INTENSITY_WEIGHTS,
  cardioIntensityScalar,
  normaliseHrZones,
  type HrZones,
} from "@/lib/engine/cardio-intensity";

/**
 * Per-modality interference coefficient. Higher value = more
 * interference cost per cardio minute.
 *
 * Canonical keys match the `cardio_logs.modality` enum used across
 * the cardio modality vocabulary (`run | bike | swim | walk | row | ski |
 * other_cardio`). Additional aliases (`ski_erg`, `ruck`, `other`)
 * are accepted defensively so callers that aggregate from
 * user-authored events / hand-entered modalities still resolve.
 *
 * Magnitudes are heuristic; structural ordering (run > swim > row >
 * bike, ruck > walk) is supported by Wilson 2012.
 */
export const MODALITY_INTERFERENCE: Record<string, number> = {
  // Wilson 2012 HIGH — running-based concurrent showed the largest
  // strength/hypertrophy decrements; baseline reference modality.
  run: 1.0,
  // CP-3 heuristic — no lower-body eccentric overlap, but a sizeable
  // systemic recovery cost; placed between bike and run by practitioner
  // consensus pending Stage B data.
  swim: 0.6,
  // Wilson 2012 HIGH — cycling-based concurrent training did NOT
  // produce significant decrements in the meta-analysis; lowest non-
  // walking modality.
  bike: 0.4,
  // CP-3 heuristic — pull-dominant + posterior chain; moderate.
  row: 0.5,
  // CP-3 heuristic — Nordic ski / double-poling: upper-body emphasis,
  // low knee/eccentric overlap with the squat/deadlift family.
  ski: 0.4,
  // CP-3 heuristic — forward-compat alias for upper-body ski-erg work
  // that may surface from event logging.
  ski_erg: 0.4,
  // CP-3 heuristic — low-impact, minimal eccentric load; the lowest
  // interference cost per minute of any modality we track.
  walk: 0.3,
  // CP-3 heuristic — loaded walking: axial loading + eccentric
  // step-down; sits between walk and run.
  ruck: 0.8,
  // CP-3 heuristic — unclassified imported activities and freeform
  // event modalities; conservative-moderate default.
  other_cardio: 0.7,
  // CP-3 heuristic — alias matching the `events.modality = "other"`
  // catch-all so freeform user events resolve to the same value.
  other: 0.7,
};

/**
 * Minutes threshold at which the run-equivalent (weighted) dose hits
 * the legacy 0.7× compression point. Chosen to match the old binary
 * trigger of `cardioMinutes >= 240` for run-heavy weeks scaled up
 * slightly (300 min) so the scalar reaches 0.70 — not just crosses
 * the binary threshold — when the user runs ~5 hours.
 */
// heuristic, magnitude chosen for continuity with the legacy binary scalar
const DOSE_KNEE_MIN = 300;

/**
 * Upper saturation point — beyond this weighted dose the scalar is
 * pinned at the floor and additional cardio cannot compress volume
 * further. Avoids the formula spiralling to nonsensical values on
 * ultra-endurance weeks.
 */
// heuristic, no calibration data — magnitude chosen for continuity
const DOSE_SATURATION_MIN = 600;

/**
 * Lower floor on the scalar. The engine never compresses building/
 * productive/limit landmarks below 60% of base regardless of how
 * much cardio the user logs.
 */
// heuristic, no calibration data — magnitude chosen for continuity
const SCALAR_FLOOR = 0.6;

/**
 * Compression at the knee point — should match the legacy 0.7× scalar
 * so a 300-min/week run-only week sees the same volume pull-back the
 * old binary trigger produced.
 */
// heuristic, no calibration data — magnitude chosen for continuity
const SCALAR_AT_KNEE = 0.7;

/**
 * Slope from zero to the knee. With DOSE_KNEE_MIN=300 and
 * SCALAR_AT_KNEE=0.7 this is exactly (1 - 0.7) = 0.30 over the first
 * 300 weighted minutes.
 */
// heuristic, no calibration data — magnitude chosen for continuity
const SLOPE_BEFORE_KNEE = 0.30;

/**
 * Slope from the knee to saturation. With SCALAR_AT_KNEE=0.7 and
 * SCALAR_FLOOR=0.6 this is (0.7 - 0.6) = 0.10 over the next 300
 * weighted minutes — a deliberately shallower decay than the pre-knee
 * region (the marginal interference cost of additional cardio shrinks
 * once the user is already deeply concurrent).
 */
// heuristic, no calibration data — magnitude chosen for continuity
const SLOPE_AFTER_KNEE = 0.10;

/**
 * Intensity-aware interference (ADR 0025).
 *
 * The modality coefficient answers "how much does a MINUTE of this
 * activity interfere?" — but a minute of Z5 VO2 work is not the same
 * stimulus as a minute of easy Z2. We refine each block's contribution
 * by an intensity multiplier derived from time-in-zone, reusing the
 * existing `ZONE_INTENSITY_WEIGHTS` (so NO new intensity coefficients
 * enter the engine).
 *
 * The multiplier is normalised to the Z2 reference so the legacy
 * dose-only behaviour is preserved exactly:
 *   - Z2 (the reference endurance intensity) → 1.0   (no change)
 *   - threshold / VO2 work                   → > 1.0 (premium)
 *   - recovery-zone work                     → < 1.0 (discount)
 *   - NO objective HR-zone signal            → 1.0   (continuity)
 *
 * Only objective time-in-zone data earns an adjustment. RPE-only and
 * no-data blocks fall back to 1.0, so every existing stats output and
 * every continuity pin stays byte-identical. RPE is a deliberate
 * Stage-B exclusion — a single subjective number is too coarse to
 * anchor an interference premium against the Z2 reference.
 *
 * CP-4 note: this scalar is consumed by stats only
 * (`getWeeklyMuscleVolume`); it does NOT enter the prescription ceiling
 * chain, so it adds no forbidden `interference_modifier`. Magnitudes
 * are heuristic, Stage-B (calibrate vs predicted-vs-actual hypertrophy
 * tolerance on intensity-mixed weeks).
 */
// reference endurance intensity — Z2 is the "bread and butter" zone the
// modality coefficients were implicitly calibrated against.
const INTENSITY_REFERENCE = ZONE_INTENSITY_WEIGHTS.z2;
// derived bounds: a fully-Z1 session (pure recovery) and a fully-Z5
// session (pure VO2) are the natural extremes of the time-in-zone
// average; the clamp is purely defensive against degenerate inputs and
// never binds for real zone mixes.
const INTENSITY_MULT_MIN = ZONE_INTENSITY_WEIGHTS.z1 / INTENSITY_REFERENCE; // 0.625
const INTENSITY_MULT_MAX = ZONE_INTENSITY_WEIGHTS.z5 / INTENSITY_REFERENCE; // 2.75

/**
 * A single logged cardio block. `hrZones` is the raw `cardio_logs.hr_zones`
 * jsonb (coerced via `normaliseHrZones`); `rpe` is accepted for shape
 * completeness but intentionally NOT used for the interference multiplier.
 */
export type CardioInterferenceBlock = {
  modality: string;
  minutes: number;
  hrZones?: HrZones | unknown | null;
  rpe?: number | null;
};

function clampLocal(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Per-block intensity multiplier, normalised to the Z2 reference.
 * Returns 1.0 (no adjustment) unless the block carries usable
 * time-in-zone data.
 */
function intensityMultiplier(block: CardioInterferenceBlock): number {
  const zones = normaliseHrZones(block.hrZones ?? null);
  if (!zones) return 1.0;
  const minutes = Number.isFinite(block.minutes) ? block.minutes : 0;
  const intensity = cardioIntensityScalar({
    hrZones: zones,
    durationSec: Math.max(1, minutes * 60),
    rpe: null,
  });
  if (!Number.isFinite(intensity) || intensity <= 0) return 1.0;
  return clampLocal(
    intensity / INTENSITY_REFERENCE,
    INTENSITY_MULT_MIN,
    INTENSITY_MULT_MAX,
  );
}

/**
 * Map a weighted dose to the scalar via the piecewise-linear curve.
 * Shared by both the block and modality-record entry points.
 */
function doseToScalar(weightedDose: number): number {
  if (weightedDose <= 0) return 1.0;
  if (weightedDose >= DOSE_SATURATION_MIN) return SCALAR_FLOOR;
  if (weightedDose <= DOSE_KNEE_MIN) {
    return 1.0 - SLOPE_BEFORE_KNEE * (weightedDose / DOSE_KNEE_MIN);
  }
  return (
    SCALAR_AT_KNEE -
    SLOPE_AFTER_KNEE * ((weightedDose - DOSE_KNEE_MIN) / DOSE_KNEE_MIN)
  );
}

/**
 * Intensity-aware concurrent scalar from per-block cardio data
 * (ADR 0025). Each block contributes
 * `minutes × modalityCoef × intensityMultiplier`. Blocks without
 * time-in-zone data contribute at intensity 1.0, so a week of
 * modality-only data reduces exactly to the legacy dose curve.
 */
export function computeConcurrentScalarFromBlocks(
  blocks: ReadonlyArray<CardioInterferenceBlock>,
): number {
  let weightedDose = 0;
  for (const block of blocks) {
    const minutes = block.minutes;
    if (!Number.isFinite(minutes) || minutes <= 0) continue;
    const key = block.modality.toLowerCase().trim();
    const coef =
      MODALITY_INTERFERENCE[key] ?? MODALITY_INTERFERENCE.other ?? 0.7;
    weightedDose += minutes * coef * intensityMultiplier(block);
  }
  return doseToScalar(weightedDose);
}

/**
 * Compute the concurrent-training scalar from per-modality cardio
 * minutes for a single week.
 *
 * Continuity properties (test-pinned):
 *  - zero cardio          → 1.00 (no compression)
 *  - 300 min run-only     → ~0.70 (matches old binary trigger)
 *  - 300 min bike-only    → ~0.88 (cycling materially less impactful)
 *  - 600 min run-only     → 0.60 (floor)
 *  - monotonically non-increasing in total weighted dose
 *
 * Formula (CP-3 heuristic, magnitudes chosen for continuity):
 *   weightedDose = sum(minutes_m * MODALITY_INTERFERENCE[m])
 *   if weightedDose <= 0:        scalar = 1.0
 *   elif weightedDose >= 600:    scalar = 0.6   // floor
 *   elif weightedDose <= 300:    scalar = 1.0 - 0.30 * (weightedDose / 300)
 *   else:                        scalar = 0.7 - 0.10 * ((weightedDose - 300) / 300)
 *
 * The piecewise-linear shape is the simplest form satisfying the
 * three continuity properties without introducing extra parameters.
 * Replace with a fitted curve once Stage B has data.
 *
 * Unknown modality keys fall back to the `other` coefficient (0.7)
 * so freeform user-authored modalities still compress volume rather
 * than silently bypassing the scaler.
 *
 * Intensity-blind back-compat entry point: delegates to
 * `computeConcurrentScalarFromBlocks`, treating each modality bucket as
 * a block with no intensity signal (multiplier 1.0). All legacy
 * continuity pins therefore hold byte-identical.
 */
export function computeConcurrentScalar(
  minutesByModality: Record<string, number>,
): number {
  const blocks: CardioInterferenceBlock[] = [];
  for (const [modality, minutes] of Object.entries(minutesByModality)) {
    blocks.push({ modality, minutes, hrZones: null, rpe: null });
  }
  return computeConcurrentScalarFromBlocks(blocks);
}

/**
 * Convenience: true when the computed scalar materially compresses
 * volume (i.e. is below 1.0 by a non-trivial margin). Used by the UI
 * info pill that previously read `isConcurrentWeek`.
 */
export function isConcurrentScaled(scalar: number): boolean {
  // 0.99 chosen to ignore floating-point noise near zero-dose weeks.
  return scalar < 0.99;
}
