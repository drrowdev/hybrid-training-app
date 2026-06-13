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

