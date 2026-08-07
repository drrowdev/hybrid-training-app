/**
 * Shared effort-label helpers for prescription display.
 *
 * RPE 10/10 is the conventional "max intent" marker the engine attaches to
 * plyometric / power accessories (box jumps, broad jumps). It encodes
 * *maximal explosive intent with full recovery* — NOT a set ground to failure
 * (Behm & Sale 1993; the adaptation is neural / rate-of-force, not metabolic).
 * Rendering it as a bare "RPE 10" makes both the user and session recap misread
 * a jump as a grind-to-failure set. Surfaces that have a richer rep readout
 * (the live set logger, the day card) already special-case this; these helpers
 * give server-side formatters and exports the same treatment from one source
 * of truth.
 */

/** The user-facing label for a max-intent (RPE 10/10) effort target. */
export const MAX_INTENT_LABEL = "Max intent";

/** True when an effort target is the plyometric/power max-intent marker (RPE 10/10). */
export function isMaxIntentRpe(
  range: { min: number; max: number } | null | undefined,
): boolean {
  return !!range && range.min === 10 && range.max === 10;
}
