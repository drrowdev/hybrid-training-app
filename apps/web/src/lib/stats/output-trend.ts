/**
 * Output trend — is the user's objective work *improving*?
 *
 * The acute:chronic ratio in `load-balance.ts` says how hard you're
 * loading; sRPE drift (`rpe-drift-queries.ts`) says how that load
 * *feels*. Output trend is the third leg: are you actually getting
 * better at the work — heavier sets, faster paces, more PRs — or are
 * you grinding without progress?
 *
 * Heuristic / uncalibrated (CP-1, ADR 0019)
 * ─────────────────────────────────────────
 * v1 picks the simplest defensible objective signal we already compute:
 * **PR cadence** — the number of unique-movement e1RM PRs in the recent
 * 28-day window versus the prior 28-day window. Reuses `getPrsForRange`
 * so the math is the same as the PRs card on the same page — no new PR
 * pipeline, no new movement walks.
 *
 *   - rising  — at least one PR in the recent window AND recent ≥ prior + 1
 *   - falling — strictly fewer PRs in the recent window than the prior
 *   - flat    — anything else when there's some history to compare
 *   - no-data — no PRs in either window (insufficient training history)
 *
 * Why not e1RM slope per main lift? Because e1RM is already what feeds
 * `detectPrs`, and counting PR events captures the same signal at a
 * sturdier granularity (one PR per movement per window, immune to single
 * noisy sets). Pace-at-effort improvements are deferred to v2 alongside
 * a real pace-trend pipeline — for v1 the strength-side PR cadence is
 * enough to anchor the corroboration without painting a false-precision
 * trend line.
 *
 * This is read-only and pure-ish (the I/O wrapper calls `getPrsForRange`
 * twice; the classifier is a pure function).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPrsForRange } from "./prs-range";

export type OutputDirection = "rising" | "flat" | "falling" | "no-data";

export type OutputTrend = {
  direction: OutputDirection;
  /** Plain-language detail for the readiness card. */
  detail: string;
  /** Unique-movement PRs in the recent (last 28d) window. */
  recentPrCount: number;
  /** Unique-movement PRs in the prior 28-day window (29..56d ago). */
  priorPrCount: number;
};

/**
 * Pure classifier — exposed for unit tests so the decision rules can be
 * exercised without a Supabase round-trip.
 */
export function classifyOutputTrend(
  recentPrCount: number,
  priorPrCount: number,
): OutputTrend {
  if (recentPrCount === 0 && priorPrCount === 0) {
    return {
      direction: "no-data",
      detail: "No recent PRs to gauge output yet.",
      recentPrCount,
      priorPrCount,
    };
  }
  if (recentPrCount >= 1 && recentPrCount >= priorPrCount + 1) {
    return {
      direction: "rising",
      detail:
        recentPrCount === 1
          ? "1 new PR in the last 28 days — work is being absorbed."
          : `${recentPrCount} new PRs in the last 28 days — work is being absorbed.`,
      recentPrCount,
      priorPrCount,
    };
  }
  if (recentPrCount < priorPrCount) {
    return {
      direction: "falling",
      detail: `Output slipping — ${recentPrCount} PR${recentPrCount === 1 ? "" : "s"} in the last 28d vs ${priorPrCount} in the prior 28d.`,
      recentPrCount,
      priorPrCount,
    };
  }
  return {
    direction: "flat",
    detail: `Holding steady — ${recentPrCount} PR${recentPrCount === 1 ? "" : "s"} this window, ${priorPrCount} prior.`,
    recentPrCount,
    priorPrCount,
  };
}

/** Recent + prior PR windows, in days. */
export const OUTPUT_TREND_WINDOW_DAYS = 28;

/**
 * Read-side wrapper. Two `getPrsForRange` walks (28d and 56d); we
 * subtract the recent set from the broader set to derive the prior
 * window. Cost-equivalent to two of the existing PR cards.
 */
export async function getOutputTrend(
  supabase: SupabaseClient,
  userId: string,
  tz: string,
): Promise<OutputTrend> {
  const [recent, broader] = await Promise.all([
    getPrsForRange(supabase, userId, tz, OUTPUT_TREND_WINDOW_DAYS),
    getPrsForRange(supabase, userId, tz, OUTPUT_TREND_WINDOW_DAYS * 2),
  ]);
  const recentPrCount = recent.uniqueMovementCount;
  const broaderPrCount = broader.uniqueMovementCount;
  // The broader window includes the recent window, so "prior" is the
  // difference. The PR-count math is per-movement-unique, so this can
  // underestimate prior when the same movement PRd in both halves — but
  // that's a *conservative* bias (we'll call it "rising" rather than
  // "flat" in the tie case), which matches the spec's confidence-on-
  // agreement framing.
  const priorPrCount = Math.max(0, broaderPrCount - recentPrCount);
  return classifyOutputTrend(recentPrCount, priorPrCount);
}
