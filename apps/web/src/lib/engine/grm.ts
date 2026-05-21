/**
 * GRM — Global Recovery Multiplier
 *
 * Per research-v2 §3.4: a per-session scalar in [0.80, 1.00] that nudges
 * the prescribed top-set intensity based on the user's self-reported state.
 * v1 inputs are the two DC-P1 sliders only (fatigue + soreness 1-5).
 *
 * The math is intentionally conservative:
 * - A neutral check-in (3/3) returns 1.00 — no nudge.
 * - Maximum cooked (5/5) returns 0.90 — suggest ~10% pullback.
 * - Maximum fresh (1/1) is capped at 1.00 — we never recommend going ABOVE
 *   the planned dose. Going higher is the job of the PR + TM-progression
 *   feature (deferred).
 *
 * Coefficients are engineering defaults marked [DEF→cal] and will be tuned
 * once real data lands.
 */

export type GrmInput = {
  /** DC-P1: 1=fresh, 5=cooked. null/undefined => no check-in done (returns 1.00). */
  fatigue: number | null | undefined;
  /** DC-P1: 1=none, 5=severe. null/undefined => no check-in done (returns 1.00). */
  soreness: number | null | undefined;
};

export type GrmResult = {
  /** The clamped multiplier, [0.80, 1.00]. */
  value: number;
  /** True when both inputs were provided (i.e. the widget actually ran). */
  hasCheckIn: boolean;
};

/**
 * Compute GRM from a self-report. Returns 1.00 (no nudge) when either
 * input is missing so the planner falls back to the static prescription.
 */
export function computeGrm({ fatigue, soreness }: GrmInput): GrmResult {
  if (fatigue == null || soreness == null) {
    return { value: 1.0, hasCheckIn: false };
  }
  const fClamped = Math.max(1, Math.min(5, fatigue));
  const sClamped = Math.max(1, Math.min(5, soreness));
  // Center at 3 (neutral). Scale to roughly [-1, +1].
  const fatigueDelta = (3 - fClamped) / 2;
  const sorenessDelta = (3 - sClamped) / 2;
  const raw = 1.0 + 0.06 * fatigueDelta + 0.04 * sorenessDelta;
  const clamped = Math.max(0.8, Math.min(1.0, raw));
  // Round to 2 decimal places for stable display.
  return { value: Math.round(clamped * 100) / 100, hasCheckIn: true };
}

/**
 * Apply GRM to a planned %TM to get a recommended top-set %TM.
 * Returns the rounded integer percentage so the recommendation card can
 * show "87%" instead of "87.45%".
 */
export function applyGrmToPercent(plannedPercent: number, grm: number): number {
  return Math.round(plannedPercent * grm);
}

/**
 * Threshold under which we surface a recommendation card on the session
 * page. Above this we treat GRM as "close enough to 1.00" and stay quiet.
 *
 * 0.96 chosen so a 4/3 or 3/4 check-in stays silent (grm ~0.97), but a 4/4
 * or 5/3 triggers (grm ~0.94).
 */
export const GRM_RECOMMEND_THRESHOLD = 0.96;

/** Plain-language label for a GRM value — used in the recommendation card. */
export function grmLabel(grm: number): "fresh" | "good" | "neutral" | "tired" | "cooked" {
  if (grm >= 0.99) return "fresh";
  if (grm >= 0.97) return "good";
  if (grm >= 0.94) return "neutral";
  if (grm >= 0.90) return "tired";
  return "cooked";
}
