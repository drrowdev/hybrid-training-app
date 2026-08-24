/**
 * Bounds for a user-chosen recovery percentage.
 *
 * Their own module so the preview control can import them without pulling every
 * program engine into the browser bundle — `recovery-week-policy` imports all
 * four engines to resolve a block's policy, which the client never needs.
 */

export const RECOVERY_PERCENT_MIN = 30;
export const RECOVERY_PERCENT_MAX = 85;

/** Clamp a user-chosen recovery percentage to something loggable. */
export function clampRecoveryPercent(percent: number): number {
  return Math.min(
    RECOVERY_PERCENT_MAX,
    Math.max(RECOVERY_PERCENT_MIN, Math.round(percent)),
  );
}
