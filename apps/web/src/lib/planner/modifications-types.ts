/**
 * Pure types + default constant for engine-side prescription
 * modifications. Split from `modifications.ts` so client-bundled
 * code (archetypes.ts → buildPrescription) never transitively pulls
 * in `@/lib/supabase/server`, which would break the Next.js build.
 */

export type ActiveModifications = {
  /** Volume multiplier from a taper snapshot (1.0 = no taper). */
  volumeScale: number;
  /** Intensity action from a taper snapshot. */
  intensityAction: "hold" | "minimal" | null;
  /** Strength + tendon items multiplier. 0 = drop, 1 = unchanged. */
  strengthLoadScale: number;
  /** Cardio durationMin multiplier. */
  cardioLoadScale: number;
  /** Which kind of modification produced the scales. */
  source: "taper" | "recovery" | null;
};

export const NO_ACTIVE_MODIFICATIONS: ActiveModifications = {
  volumeScale: 1,
  intensityAction: null,
  strengthLoadScale: 1,
  cardioLoadScale: 1,
  source: null,
};
