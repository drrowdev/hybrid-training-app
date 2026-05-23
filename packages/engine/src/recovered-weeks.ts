/**
 * DC-K1 — recovered-week qualification (canonical helper).
 *
 * A "recovered week" is the engine's go/no-go signal for whether a
 * given user-week is fit to enter the ceiling-base calculation
 * (DC-C9 — median dose of the last 3 recovered weeks). The full
 * constraint lives at `docs/knowledge/hybrid-training-design-constraints.md#DC-K1`.
 *
 * A week qualifies iff ALL of the following pass:
 *   1. Every planned session in the week was logged — no skipped
 *      rows, no missed-past-due rows.
 *   2. No logged session in the week had sRPE > 9 (the overreach
 *      signal from DC-A2 — sRPE is on a 0-10 scale).
 *   3. Average pre-session fatigue across the week's logged sessions
 *      is < 4 (1-5 scale per DC-P1; 4+ = elevated systemic stress).
 *   4. Average pre-session soreness across the week's logged sessions
 *      is < 4 (same scale).
 *   5. At least one session was logged in the week (informativeness
 *      guard — a no-data week is not "recovered", it's no-data).
 *
 * NULL-signal handling (deliberate policy):
 *   - `maxSrpe`, `avgFatigue`, `avgSoreness` may legitimately be NULL
 *     when the user just didn't fill in the corresponding slider.
 *   - We treat NULL as PASSING for that check rather than failing or
 *     blocking. Rationale: DC-K1 is a *qualifier*, not a *judge*. If
 *     we fail-closed on every absent input we'd starve the ceiling
 *     base (DC-C9 needs 3 recovered weeks) and force perpetual
 *     cold-start tiers for any user who doesn't religiously log
 *     fatigue / soreness. The downstream cold-start ladder in
 *     `getCeilingExplain` is the safety net for sparse data — see
 *     DC-C13 confidence bias. Tests pin this behaviour.
 *
 * Pure helper: no DB, no Date.now() reads. Inputs in → result out.
 * Lives in `@hta/engine` so the engine package and `apps/web` both
 * import the same identity (plan §6.9 single home for derived state).
 */

/** Per-week aggregates fed into the recovery rule. */
export type WeekRecoveryInput = {
  /** ISO Monday of the week, YYYY-MM-DD. */
  weekStart: string;
  /** Total planned sessions for the user in this week. */
  plannedSessions: number;
  /** Planned sessions with a non-null `completed_session_id`. */
  loggedSessions: number;
  /** Planned sessions with a non-null `skipped_at`. */
  skippedSessions: number;
  /** Planned sessions whose scheduled date is in the past, not logged, not skipped. */
  missedSessions: number;
  /** Max sRPE across logged sessions (NULL when no session in the week recorded sRPE). */
  maxSrpe: number | null;
  /** Average pre-session fatigue across logged sessions in the week (NULL when none recorded). */
  avgFatigue: number | null;
  /** Average pre-session soreness across logged sessions in the week (NULL when none recorded). */
  avgSoreness: number | null;
};

export type WeekRecoveryResult = {
  isRecovered: boolean;
  /** Human-readable explanation; rendered in the wellness/engine surfaces. */
  reason: string;
};

const OVERREACH_SRPE = 9;
const ELEVATED_STRESS = 4;

/**
 * Pure rule that decides whether one user-week qualifies as recovered.
 * See file header for the full DC-K1 specification + NULL-signal policy.
 */
export function isRecoveredWeek(week: WeekRecoveryInput): WeekRecoveryResult {
  // DC-K1 informativeness guard: a week with zero logged sessions
  // carries no positive signal. We don't reward "I didn't train this
  // week" as a recovered week — it's no-data, not recovered. This
  // matters most for brand-new users whose 12-week lookback is
  // otherwise vacuously "recovered" (no skips + null signals pass)
  // and would skip the cold-start ladder in `pickCeilingBase`.
  if (week.loggedSessions === 0) {
    return {
      isRecovered: false,
      reason: "no logged sessions",
    };
  }
  if (week.skippedSessions > 0) {
    return {
      isRecovered: false,
      reason: `${week.skippedSessions} session${week.skippedSessions === 1 ? "" : "s"} skipped`,
    };
  }
  if (week.missedSessions > 0) {
    return {
      isRecovered: false,
      reason: `${week.missedSessions} session${week.missedSessions === 1 ? "" : "s"} missed`,
    };
  }
  // NULL → "user didn't log sRPE" → treat as passing (DC-K1 NULL policy).
  if (week.maxSrpe != null && week.maxSrpe > OVERREACH_SRPE) {
    return {
      isRecovered: false,
      reason: `session sRPE peaked at ${formatNum(week.maxSrpe)}`,
    };
  }
  // Same NULL-passes policy on fatigue.
  if (week.avgFatigue != null && week.avgFatigue >= ELEVATED_STRESS) {
    return {
      isRecovered: false,
      reason: `avg fatigue ${formatNum(week.avgFatigue)}`,
    };
  }
  // Same NULL-passes policy on soreness.
  if (week.avgSoreness != null && week.avgSoreness >= ELEVATED_STRESS) {
    return {
      isRecovered: false,
      reason: `avg soreness ${formatNum(week.avgSoreness)}`,
    };
  }
  return {
    isRecovered: true,
    reason: "all sessions logged, no overreach",
  };
}

/**
 * Median of a (possibly small) numeric list. Returns 0 for an empty
 * list — callers that care about cold-start branch on `xs.length`
 * before consulting the median.
 */
export function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function formatNum(n: number): string {
  // One decimal place when fractional, integer when whole. Matches
  // the human-readable surfaces (wellness tile, engine explainer).
  return Number.isInteger(n) ? String(n) : (Math.round(n * 10) / 10).toFixed(1);
}

// ───────────────────────────────────────────────────────────────────
// Ceiling-base selection (DC-C9) given a sorted-desc rollup
// ───────────────────────────────────────────────────────────────────

/**
 * Outcome of the recovered-week → ceiling-base reduction. The three
 * formula tiers correspond to DC-C9 (median of 3) and the DC-C13
 * cold-start ladder that kicks in when recovered weeks are sparse.
 */
export type CeilingBaseFormula =
  | "median_of_recovered"
  | "cold_start_partial"
  | "cold_start_conservative";

export type CeilingBasisWeek = {
  weekStart: string;
  volume: number;
  /** True if the week contributed to the median, false if shown only for context. */
  included: boolean;
};

export type CeilingBaseResult = {
  baseCeiling: number;
  confidenceBias: number;
  basisWeeks: CeilingBasisWeek[];
  formula: CeilingBaseFormula;
};

/**
 * Pick the ceiling base from a recovered-week rollup, applying the
 * cold-start ladder for sparse data:
 *   - ≥3 recovered weeks      → median of the most recent 3        (bias 1.00)
 *   - 1-2 recovered weeks     → median of however many you have    (bias 0.80)
 *   - 0 recovered weeks       → lowest volume in last 4 weeks × 0.9 (bias 0.80)
 *
 * `rollup` is expected sorted-desc by weekStart (most recent first),
 * which mirrors how `getWeeklyRecoveryRollup` returns the rows.
 *
 * `weeklyVolume(weekStart)` is injected so the pure helper does not
 * depend on the DB layer — callers wire it to their volume source.
 */
export function pickCeilingBase(
  rollup: readonly WeekRecoveryInput[],
  weeklyVolume: (weekStart: string) => number,
): CeilingBaseResult {
  const recovered = rollup.filter((w) => isRecoveredWeek(w).isRecovered);

  if (recovered.length >= 3) {
    const top3 = recovered.slice(0, 3);
    const top3Set = new Set(top3.map((w) => w.weekStart));
    const volumes = top3.map((w) => weeklyVolume(w.weekStart));
    const basisWeeks: CeilingBasisWeek[] = top3
      .map((w) => ({
        weekStart: w.weekStart,
        volume: weeklyVolume(w.weekStart),
        included: top3Set.has(w.weekStart),
      }));
    return {
      baseCeiling: median(volumes),
      confidenceBias: 1.0,
      basisWeeks,
      formula: "median_of_recovered",
    };
  }

  if (recovered.length >= 1) {
    const volumes = recovered.map((w) => weeklyVolume(w.weekStart));
    const basisWeeks: CeilingBasisWeek[] = recovered.map((w) => ({
      weekStart: w.weekStart,
      volume: weeklyVolume(w.weekStart),
      included: true,
    }));
    return {
      baseCeiling: median(volumes),
      // DC-C13: sparse data → compress the ceiling so we project
      // conservatively rather than pretending the user is fresh.
      confidenceBias: 0.8,
      basisWeeks,
      formula: "cold_start_partial",
    };
  }

  // 0 recovered weeks → very conservative — signal "we don't trust
  // the data yet". Use the lowest volume in the last 4 weeks × 0.9
  // (the lowest week is the most defensible floor; the 0.9 multiplier
  // is the published cold-start headroom-collapse from DC-C13).
  const last4 = rollup.slice(0, 4);
  const last4Volumes = last4.map((w) => weeklyVolume(w.weekStart));
  const floor = last4Volumes.length === 0 ? 0 : Math.min(...last4Volumes);
  const basisWeeks: CeilingBasisWeek[] = last4.map((w) => ({
    weekStart: w.weekStart,
    volume: weeklyVolume(w.weekStart),
    included: false,
  }));
  return {
    baseCeiling: floor * 0.9,
    confidenceBias: 0.8,
    basisWeeks,
    formula: "cold_start_conservative",
  };
}
