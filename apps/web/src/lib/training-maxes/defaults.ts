/**
 * Conservative TM seed defaults for the onboarding "I don't know yet" path.
 *
 * Pure module — no DB, no React, no I/O. Tested in defaults.test.ts.
 *
 * Heuristic (DC-G5 cold-start, owner-approved during onboarding spec):
 * a user who can't quote a 1RM gets a deliberately low seed so their first
 * block grossly under-prescribes rather than over-prescribes. Numbers are
 * fractions of bodyweight, picked to land roughly at "untrained novice"
 * standards for each lift.
 *
 * Per-sex ratios fall back to the gender-neutral ratios when sex is null.
 * Numbers are intentionally below "intermediate" thresholds — the user
 * will recalibrate via the TM-history nudge after a few weeks.
 */
import type { StrengthRole } from "@/lib/planner/archetypes";

export type Sex = "male" | "female" | null;

/** Fallback bodyweight if the profile has none — yields a usable lower bound. */
export const FALLBACK_BODYWEIGHT_KG = 75;

/**
 * 1RM-as-fraction-of-bodyweight for each main role. Spec-provided
 * gender-neutral defaults: 1.0× BW squat, 0.75× BW bench, 1.25× BW dead,
 * 0.5× BW OHP. Per-sex columns nudge female ratios down ~25% in line with
 * untrained-novice ExRx standards.
 */
export const DEFAULT_BW_RATIOS: Record<StrengthRole, { male: number; female: number; neutral: number }> = {
  squat:            { male: 1.10, female: 0.80, neutral: 1.00 },
  horizontal_press: { male: 0.85, female: 0.55, neutral: 0.75 },
  deadlift:         { male: 1.40, female: 1.00, neutral: 1.25 },
  vertical_press:   { male: 0.55, female: 0.40, neutral: 0.50 },
};

/**
 * Returns a 1RM in kg for the given role using a conservative bodyweight
 * ratio. Always returns a positive, plate-friendly number.
 */
export function seedDefaultOneRm(opts: {
  role: StrengthRole;
  bodyweightKg?: number | null;
  sex?: Sex;
}): number {
  const bw =
    opts.bodyweightKg && opts.bodyweightKg > 0 ? opts.bodyweightKg : FALLBACK_BODYWEIGHT_KG;
  const ratios = DEFAULT_BW_RATIOS[opts.role];
  const ratio =
    opts.sex === "male" ? ratios.male : opts.sex === "female" ? ratios.female : ratios.neutral;
  const raw = bw * ratio;
  // Round to 2.5 kg plate to match the rest of the app.
  return Math.max(2.5, Math.round(raw / 2.5) * 2.5);
}

/**
 * Convenience: produce the full {role → 1RM} map for the four main lifts.
 * Useful when the user clicks "I don't know yet" for every role at once.
 */
export function seedAllDefaultOneRm(opts: {
  bodyweightKg?: number | null;
  sex?: Sex;
}): Record<StrengthRole, number> {
  return {
    squat: seedDefaultOneRm({ role: "squat", ...opts }),
    horizontal_press: seedDefaultOneRm({ role: "horizontal_press", ...opts }),
    deadlift: seedDefaultOneRm({ role: "deadlift", ...opts }),
    vertical_press: seedDefaultOneRm({ role: "vertical_press", ...opts }),
  };
}
