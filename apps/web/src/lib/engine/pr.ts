/**
 * PR detection — three kinds per logged main-lift set.
 *
 *   weight         — heaviest weight ever lifted on this movement (any reps)
 *   reps_at_weight — most reps ever at exactly this weight
 *   e1rm           — highest estimated 1RM across all sets for this movement
 *
 * Design: docs/design/prs-and-tm-progression.md §6
 *
 * Pure functions; the I/O wrapper that queries Supabase lives in
 * lib/stats/pr-queries.ts so this file stays testable in isolation.
 */
import { bestEstimateOneRm, type OneRmInput } from "./one-rm";

export type PrKind = "weight" | "reps_at_weight" | "e1rm";

export type HistoricalSet = {
  weight: number;
  reps: number;
  rpe?: number | null;
  performed_at: string;
};

export type NewSet = {
  weight: number;
  reps: number;
  rpe?: number | null;
  /** RPE 10 grinders are excluded from PR detection — too noisy / risky to celebrate. */
};

export type PrHit = {
  kind: PrKind;
  /** The user-facing value for this kind: weight in kg, reps count, or kg 1RM. */
  value: number;
  /** Previous best in the same kind, when one exists. */
  previousBest: number | null;
  /** Number of days since the previous PR of this kind. null = first ever. */
  daysSincePrevious: number | null;
};

export type PrDetectionResult = {
  hits: PrHit[];
};

/** Threshold under which a set isn't a credible PR (grinder territory). */
const GRINDER_RPE = 10;

/**
 * Run PR detection for one new set against the movement's logged history.
 *
 * History should be all completed sets for the same (user, movement_id),
 * NOT including the new set itself. Empty history means everything is a
 * first-ever PR.
 */
export function detectPrs(newSet: NewSet, history: HistoricalSet[]): PrDetectionResult {
  // Grinder guard: RPE 10 sets are excluded from celebration. They might
  // still be PRs by the raw numbers — but we don't want to encourage
  // grinding to game the metric.
  if (newSet.rpe != null && newSet.rpe >= GRINDER_RPE) {
    return { hits: [] };
  }
  if (newSet.weight <= 0 || newSet.reps < 1) {
    return { hits: [] };
  }

  const hits: PrHit[] = [];
  const now = Date.now();

  // ── Weight PR ──────────────────────────────────────────────────────
  const heaviestPrior = history.reduce<HistoricalSet | null>((max, s) => {
    if (max == null) return s;
    return s.weight > max.weight ? s : max;
  }, null);
  if (heaviestPrior == null) {
    hits.push({ kind: "weight", value: newSet.weight, previousBest: null, daysSincePrevious: null });
  } else if (newSet.weight > heaviestPrior.weight) {
    hits.push({
      kind: "weight",
      value: newSet.weight,
      previousBest: heaviestPrior.weight,
      daysSincePrevious: daysBetween(heaviestPrior.performed_at, now),
    });
  }

  // ── Reps-at-weight PR ──────────────────────────────────────────────
  const sameWeightPrior = history.filter((s) => Math.abs(s.weight - newSet.weight) < 0.01);
  const mostRepsAtWeight = sameWeightPrior.reduce<HistoricalSet | null>((max, s) => {
    if (max == null) return s;
    return s.reps > max.reps ? s : max;
  }, null);
  if (sameWeightPrior.length === 0) {
    // First time at this weight — not a "reps-at-weight" PR, that's a
    // weight PR (already handled above).
  } else if (mostRepsAtWeight && newSet.reps > mostRepsAtWeight.reps) {
    hits.push({
      kind: "reps_at_weight",
      value: newSet.reps,
      previousBest: mostRepsAtWeight.reps,
      daysSincePrevious: daysBetween(mostRepsAtWeight.performed_at, now),
    });
  }

  // ── e1RM PR ────────────────────────────────────────────────────────
  const newEstimate = bestEstimateOneRm({
    weight: newSet.weight,
    reps: newSet.reps,
    rpe: newSet.rpe ?? null,
  } satisfies OneRmInput);
  if (newEstimate != null) {
    let bestPrior: { value: number; performed_at: string } | null = null;
    for (const s of history) {
      const est = bestEstimateOneRm({
        weight: s.weight,
        reps: s.reps,
        rpe: s.rpe ?? null,
      } satisfies OneRmInput);
      if (est == null) continue;
      if (bestPrior == null || est > bestPrior.value) {
        bestPrior = { value: est, performed_at: s.performed_at };
      }
    }
    if (bestPrior == null) {
      hits.push({ kind: "e1rm", value: round1(newEstimate), previousBest: null, daysSincePrevious: null });
    } else if (newEstimate > bestPrior.value + 0.05) {
      // Tiny floor avoids "PR fires every set due to floating point".
      hits.push({
        kind: "e1rm",
        value: round1(newEstimate),
        previousBest: round1(bestPrior.value),
        daysSincePrevious: daysBetween(bestPrior.performed_at, now),
      });
    }
  }

  return { hits };
}

/** Plain-language label per PR kind. */
export const PR_KIND_LABEL: Record<PrKind, string> = {
  weight: "Weight PR",
  reps_at_weight: "Reps PR",
  e1rm: "Estimated 1RM PR",
};

/** A short suffix that explains what the PR's value means. */
export function prValueSuffix(kind: PrKind): string {
  switch (kind) {
    case "weight": return "kg";
    case "reps_at_weight": return "reps";
    case "e1rm": return "kg est.";
  }
}

function daysBetween(isoOrDate: string | Date | number, nowMs: number): number {
  const t = typeof isoOrDate === "number" ? isoOrDate : new Date(isoOrDate).getTime();
  return Math.floor((nowMs - t) / 86_400_000);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
