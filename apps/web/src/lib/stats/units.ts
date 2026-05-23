/**
 * Weight unit display helper for the Stats surface.
 *
 * All weights persist in kg — the column is `weight_kg` everywhere
 * (set_logs, profiles.bodyweight_kg, training_maxes.one_rm_kg, etc).
 * When a user picks `profiles.units = "imperial"` we convert at the
 * read boundary.
 *
 * Kept tiny on purpose: no rounding strategy other than the conversion
 * factor, callers handle their own digit precision.
 */
export type WeightUnit = "metric" | "imperial";

const KG_TO_LB = 2.2046226218;

export function displayWeight(kg: number, units: WeightUnit): number {
  if (units === "imperial") return kg * KG_TO_LB;
  return kg;
}

export function weightUnitLabel(units: WeightUnit): "kg" | "lb" {
  return units === "imperial" ? "lb" : "kg";
}
