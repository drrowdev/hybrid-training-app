/**
 * Weight unit display helpers.
 *
 * All weights persist in kg — the column is `weight_kg` everywhere
 * (set_logs, profiles.bodyweight_kg, training_maxes.one_rm_kg, etc).
 * When a user picks `profiles.units = "imperial"` we convert at the
 * read boundary for display, and back to kg at the write boundary.
 *
 * Kept tiny on purpose: callers handle their own digit precision beyond
 * the `round*` helpers here.
 */
export type WeightUnit = "metric" | "imperial";

const KG_TO_LB = 2.2046226218;
const KG_PER_LB = 0.45359237;

export function displayWeight(kg: number, units: WeightUnit): number {
  if (units === "imperial") return kg * KG_TO_LB;
  return kg;
}

export function weightUnitLabel(units: WeightUnit): "kg" | "lb" {
  return units === "imperial" ? "lb" : "kg";
}

/**
 * Round a value already expressed in the DISPLAY unit: whole pounds for
 * imperial, nearest 0.5 kg for metric (the loadable plate granularity).
 */
export function roundDisplayWeight(displayValue: number, units: WeightUnit): number {
  return units === "imperial"
    ? Math.round(displayValue)
    : Math.round(displayValue * 2) / 2;
}

/**
 * Convert a value the user entered in their DISPLAY unit back to kg for
 * storage, snapped to the nearest 0.5 kg so stored maxes stay clean.
 */
export function toKg(displayValue: number, units: WeightUnit): number {
  const kg = units === "imperial" ? displayValue * KG_PER_LB : displayValue;
  return Math.round(kg * 2) / 2;
}

/** Epley estimated 1RM (kg or display unit — unit-agnostic): weight × (1 + reps/30). */
export function epleyOneRm(weight: number, reps: number): number {
  if (!Number.isFinite(weight) || !Number.isFinite(reps) || weight <= 0 || reps <= 0) {
    return 0;
  }
  return weight * (1 + reps / 30);
}

/**
 * Format a kg value for display in the user's unit, e.g. `87.5 kg` / `193 lb`.
 * Pass `withUnit: false` for just the number (when the caller renders its own
 * unit label). Used across the session logger so weights read consistently.
 */
export function formatWeight(
  kg: number,
  units: WeightUnit,
  opts: { withUnit?: boolean } = {},
): string {
  const n = roundDisplayWeight(displayWeight(kg, units), units);
  return opts.withUnit === false ? `${n}` : `${n} ${weightUnitLabel(units)}`;
}

/**
 * A stepper increment expressed in both units. Callers that know which
 * implement is being loaded pass an implement-specific step (see
 * `lib/sessions/load-increment.ts`); everything else gets the plate default.
 */
export type WeightStep = { kg: number; lb: number };

/**
 * Plate-loaded default: the smallest pair of plates on a bar. Also the
 * fallback for machines / cables / anything we can't identify.
 */
export const DEFAULT_WEIGHT_STEP: WeightStep = { kg: 2.5, lb: 5 };

/** The weight-stepper increment in the DISPLAY unit: 2.5 kg / 5 lb by default. */
export function weightStepDisplay(
  units: WeightUnit,
  step: WeightStep = DEFAULT_WEIGHT_STEP,
): number {
  return units === "imperial" ? step.lb : step.kg;
}

/**
 * Step a kg weight up/down by `deltaSteps` display-unit increments and return the
 * new kg value. Works in the display unit so the user sees clean 2.5 kg / 5 lb
 * jumps, then snaps back to kg for storage. `floorAtZero` clamps to ≥ 0.
 * `step` overrides the default increment (e.g. dumbbells step 1 kg, not 2.5).
 */
export function stepWeightKg(
  kg: number,
  units: WeightUnit,
  deltaSteps: number,
  opts: { floorAtZero?: boolean; step?: WeightStep } = {},
): number {
  const stepD = weightStepDisplay(units, opts.step);
  const currentD = roundDisplayWeight(displayWeight(kg, units), units);
  let nextD = currentD + deltaSteps * stepD;
  if (opts.floorAtZero !== false) nextD = Math.max(0, nextD);
  return toKg(nextD, units);
}


