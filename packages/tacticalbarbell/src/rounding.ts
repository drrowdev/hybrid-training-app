/**
 * Round to the nearest plate increment (e.g. 2.5 kg). Tactical Barbell working
 * weights are a percentage of the 1RM, then rounded to a loadable weight.
 */
export function roundToIncrement(weightKg: number, incrementKg: number): number {
  if (incrementKg <= 0) throw new Error("incrementKg must be > 0");
  return Math.round(weightKg / incrementKg) * incrementKg;
}

/**
 * Floor to a plate increment — used for warm-up loads so a warm-up never rounds
 * UP past the working weight it ramps toward.
 */
export function floorToIncrement(weightKg: number, incrementKg: number): number {
  if (incrementKg <= 0) throw new Error("incrementKg must be > 0");
  return Math.max(0, Math.floor(weightKg / incrementKg) * incrementKg);
}
