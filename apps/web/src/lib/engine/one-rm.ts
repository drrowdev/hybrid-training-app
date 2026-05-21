/**
 * One-rep-max estimation.
 *
 * Two formulas, picked by signal quality:
 *   - Epley (default): 1RM = w * (1 + reps/30). Validated for reps in 1..12.
 *   - RPE-based: Helms / Zourdos chart maps (reps, rpe) -> %1RM. Used only
 *     when an RPE is logged (otherwise we lack the "could you have done
 *     more?" signal that makes RPE estimation meaningful).
 *
 * For PR detection we take the CONSERVATIVE pick of both — the lower of
 * Epley and RPE-based — so PRs are hard to fake on a grinder set where
 * the lifter underestimates RPE.
 *
 * Hard cap at reps > 12: the formula error in published meta-analyses
 * (Wood 2002; Reynolds 2006; Mayhew 1995) climbs sharply above ~10 reps
 * in trained populations. We return null so callers can route these to
 * the reps-at-weight PR kind instead.
 */

export type OneRmInput = {
  weight: number;
  reps: number;
  /** Reps-in-Reserve-equivalent self-report, 6.0 .. 10.0 in 0.5 steps. Optional. */
  rpe?: number | null;
};

const REPS_MAX = 12;

/** Epley: 1RM ≈ weight × (1 + reps / 30). Returns null outside the valid window. */
export function epleyOneRm(weight: number, reps: number): number | null {
  if (!Number.isFinite(weight) || !Number.isFinite(reps)) return null;
  if (weight <= 0 || reps < 1 || reps > REPS_MAX) return null;
  return weight * (1 + reps / 30);
}

/**
 * Helms / Zourdos RPE chart (reps x RPE -> %1RM).
 *
 * Rows = reps 1..12. Cols = RPE 6.0, 6.5, 7.0, 7.5, 8.0, 8.5, 9.0, 9.5, 10.0.
 * Values are decimal fractions of 1RM. Published widely by Helms (Muscle &
 * Strength Pyramids) and Zourdos et al. (2016); the table here is the
 * standard powerlifting-RPE chart, calibrated by practitioner consensus.
 *
 * Cells marked -1 are below the chart's published floor (the chart only
 * goes down to RPE 6 in places); we treat those as unmeasurable.
 */
const RPE_CHART: Record<number, Record<number, number>> = {
  1:  { 6.0: 0.860, 6.5: 0.867, 7.0: 0.880, 7.5: 0.893, 8.0: 0.910, 8.5: 0.925, 9.0: 0.955, 9.5: 0.978, 10.0: 1.000 },
  2:  { 6.0: 0.838, 6.5: 0.846, 7.0: 0.860, 7.5: 0.872, 8.0: 0.886, 8.5: 0.910, 9.0: 0.925, 9.5: 0.955, 10.0: 0.978 },
  3:  { 6.0: 0.815, 6.5: 0.824, 7.0: 0.838, 7.5: 0.851, 8.0: 0.864, 8.5: 0.886, 9.0: 0.910, 9.5: 0.925, 10.0: 0.955 },
  4:  { 6.0: 0.794, 6.5: 0.803, 7.0: 0.815, 7.5: 0.829, 8.0: 0.840, 8.5: 0.860, 9.0: 0.886, 9.5: 0.910, 10.0: 0.925 },
  5:  { 6.0: 0.774, 6.5: 0.783, 7.0: 0.794, 7.5: 0.806, 8.0: 0.819, 8.5: 0.840, 9.0: 0.860, 9.5: 0.886, 10.0: 0.910 },
  6:  { 6.0: 0.756, 6.5: 0.762, 7.0: 0.774, 7.5: 0.788, 8.0: 0.799, 8.5: 0.819, 9.0: 0.840, 9.5: 0.860, 10.0: 0.886 },
  7:  { 6.0: 0.737, 6.5: 0.744, 7.0: 0.756, 7.5: 0.770, 8.0: 0.781, 8.5: 0.799, 9.0: 0.819, 9.5: 0.840, 10.0: 0.860 },
  8:  { 6.0: 0.720, 6.5: 0.727, 7.0: 0.737, 7.5: 0.750, 8.0: 0.763, 8.5: 0.781, 9.0: 0.799, 9.5: 0.819, 10.0: 0.840 },
  9:  { 6.0: 0.704, 6.5: 0.711, 7.0: 0.720, 7.5: 0.733, 8.0: 0.746, 8.5: 0.763, 9.0: 0.781, 9.5: 0.799, 10.0: 0.819 },
  10: { 6.0: 0.688, 6.5: 0.695, 7.0: 0.704, 7.5: 0.717, 8.0: 0.730, 8.5: 0.746, 9.0: 0.763, 9.5: 0.781, 10.0: 0.799 },
  11: { 6.0: 0.673, 6.5: 0.680, 7.0: 0.688, 7.5: 0.701, 8.0: 0.714, 8.5: 0.730, 9.0: 0.746, 9.5: 0.763, 10.0: 0.781 },
  12: { 6.0: 0.659, 6.5: 0.665, 7.0: 0.673, 7.5: 0.685, 8.0: 0.698, 8.5: 0.714, 9.0: 0.730, 9.5: 0.746, 10.0: 0.763 },
};

/** Snap an RPE input to the chart's 0.5 grid; null when out of range. */
function snapRpe(rpe: number): number | null {
  if (!Number.isFinite(rpe)) return null;
  const snapped = Math.round(rpe * 2) / 2;
  if (snapped < 6.0 || snapped > 10.0) return null;
  return snapped;
}

/**
 * RPE-based 1RM estimate. Returns null when reps or RPE fall outside the
 * chart's published range.
 */
export function rpeOneRm(weight: number, reps: number, rpe: number): number | null {
  if (!Number.isFinite(weight) || weight <= 0) return null;
  if (!Number.isInteger(reps) || reps < 1 || reps > REPS_MAX) return null;
  const snapped = snapRpe(rpe);
  if (snapped == null) return null;
  const repRow = RPE_CHART[reps];
  if (!repRow) return null;
  const pct = repRow[snapped];
  if (pct == null || pct <= 0) return null;
  return weight / pct;
}

/**
 * Conservative dispatcher.
 *
 * Returns the LOWER of Epley and RPE-based when both are available, so
 * PRs are hard to fake on a grinder set where the lifter underestimates
 * RPE. Falls back to Epley alone when no RPE is logged; returns null
 * when the inputs are out of the formula's valid window.
 */
export function bestEstimateOneRm(input: OneRmInput): number | null {
  const epley = epleyOneRm(input.weight, input.reps);
  if (epley == null) return null;
  if (input.rpe == null) return epley;
  const rpeBased = rpeOneRm(input.weight, input.reps, input.rpe);
  if (rpeBased == null) return epley;
  return Math.min(epley, rpeBased);
}

/**
 * Apply Wendler's "new TM = 90% of estimated 1RM" rule. Rounded to the
 * nearest plate-friendly increment (2.5 kg by default).
 */
export function tmFromOneRm(oneRm: number, plateIncrement = 2.5): number {
  const target = oneRm * 0.9;
  return Math.round(target / plateIncrement) * plateIncrement;
}
