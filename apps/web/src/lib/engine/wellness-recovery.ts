/**
 * wellness-recovery — daily wellness slider → ceiling recoveryMultiplier.
 *
 * Audit J3 / B4: the Today-page check-in writes
 * `wellness.fatigue` + `wellness.soreness` (1–9 scale per
 * packages/db/src/schema/wellness.ts), but `getCeilingExplain` has been
 * pinning the ceiling's GRM at a hard-coded 1.0 — actual user data,
 * dead.
 *
 * This module is the pure mapping from a small window of check-ins
 * (today + the last week as a baseline) to a multiplier in [0.7, 1.1]
 * that the ceiling explainer multiplies into baseCeiling × confidenceBias.
 *
 * Scope is deliberately tight:
 *  - Inputs are POJOs (`WellnessSnapshot`), no DB I/O. Callers do the
 *    fetch; we do the math. Keeps the heuristic unit-testable.
 *  - We return `null` whenever the data isn't trustworthy enough
 *    (no check-in today; < 3 historical points). The caller falls back
 *    to 1.0 so users with no data see today's behaviour unchanged.
 *  - We do NOT touch `lib/engine/grm.ts`. That GRM is a *per-session*
 *    scalar driven by the pre-session sliders on the 1–5 scale and is
 *    consumed by deload + bump gates. This is a separate *daily* scalar
 *    on the 1–9 scale wired only into the ceiling explainer.
 *
 * The thresholds below are engineering defaults aligned with the audit
 * spec; they assume a ~1–10 scale and apply unchanged to the 1–9 slider
 * (the half-unit difference is below the band granularity).
 */

export type WellnessSnapshot = {
  /** ISO date YYYY-MM-DD. */
  date: string;
  /** User-input scale (1=fresh → 9=wrecked). null when the user skipped that slider. */
  fatigue: number | null;
  /** Same scale (1=none → 9=severe). null when skipped. */
  soreness: number | null;
};

export type RecoveryMultiplierInput = {
  /** Today's wellness check-in (if any). */
  today: WellnessSnapshot | null;
  /** Last 7 days of check-ins for a rolling baseline (today excluded; order doesn't matter). */
  recent: WellnessSnapshot[];
};

/** Minimum historical check-ins required before we trust the baseline. */
export const MIN_HISTORICAL_POINTS = 3;

/** Hard floor on the returned multiplier — never collapse the ceiling more than 30%. */
export const RECOVERY_MULTIPLIER_FLOOR = 0.7;
/** Hard cap — never inflate the ceiling more than 10% on freshness alone. */
export const RECOVERY_MULTIPLIER_CEILING = 1.1;

/**
 * Returns a multiplier in [0.7, 1.1] for use in the ceiling explainer:
 *   - 1.0  = fully recovered (baseline)
 *   - <1.0 = penalise ceiling (user is more fatigued than their own average)
 *   - >1.0 = small bonus (user is fresher than usual)
 *
 * Returns null when there's not enough data to compute reliably — no
 * check-in today, or fewer than {@link MIN_HISTORICAL_POINTS} historical
 * snapshots with usable scores. Callers should treat null as 1.0.
 */
export function computeRecoveryMultiplier(
  input: RecoveryMultiplierInput,
): number | null {
  const todayScore = snapshotScore(input.today);
  if (todayScore == null) return null;

  // De-dup by date in case the caller hands us today inside `recent`,
  // and drop any snapshot without a usable score.
  const todayDate = input.today?.date;
  const historicalScores: number[] = [];
  for (const snap of input.recent) {
    if (todayDate && snap.date === todayDate) continue;
    const s = snapshotScore(snap);
    if (s != null) historicalScores.push(s);
  }
  if (historicalScores.length < MIN_HISTORICAL_POINTS) return null;

  const avg =
    historicalScores.reduce((a, b) => a + b, 0) / historicalScores.length;
  const delta = todayScore - avg;
  return deltaToMultiplier(delta);
}

/**
 * Score for a single snapshot: mean of available {fatigue, soreness}.
 * Returns null when both are null/undefined.
 *
 * We tolerate one missing slider rather than discarding the whole row
 * because the Today-page UI lets users submit either slider on its own.
 */
function snapshotScore(snap: WellnessSnapshot | null): number | null {
  if (!snap) return null;
  const f = isFiniteNumber(snap.fatigue) ? snap.fatigue : null;
  const s = isFiniteNumber(snap.soreness) ? snap.soreness : null;
  if (f == null && s == null) return null;
  if (f == null) return s as number;
  if (s == null) return f;
  return (f + s) / 2;
}

function isFiniteNumber(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

/**
 * Map a today-vs-baseline delta (positive = worse than average) to the
 * multiplier band. Bands per audit spec:
 *
 *   delta ≤ -2.0 → 1.10  (much fresher than usual)
 *   delta ≤ -1.0 → 1.05
 *   delta <  1.0 → 1.00  (neutral)
 *   delta <  2.0 → 0.90
 *   delta <  3.0 → 0.80
 *   delta ≥  3.0 → 0.70  (much more fatigued than usual)
 */
function deltaToMultiplier(delta: number): number {
  if (delta <= -2.0) return RECOVERY_MULTIPLIER_CEILING; // 1.10
  if (delta <= -1.0) return 1.05;
  if (delta < 1.0) return 1.0;
  if (delta < 2.0) return 0.9;
  if (delta < 3.0) return 0.8;
  return RECOVERY_MULTIPLIER_FLOOR; // 0.70
}
