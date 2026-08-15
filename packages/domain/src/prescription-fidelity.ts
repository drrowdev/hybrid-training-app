/**
 * ADR 0070 — prescription fidelity: how closely logged work tracked what was
 * prescribed.
 *
 * The point of this module is REFLECTION, not instruction. Autoregulation is the
 * lifter's call — Tactical Barbell explicitly leaves set count to judgment. What
 * a person cannot do unaided is remember eight weeks of small decisions, so this
 * turns the per-set snapshot into a picture of what actually happened over time.
 *
 * Two rules shape every function here:
 *
 *   1. A missing snapshot is UNKNOWN, never "on plan". Rows logged before
 *      migration 0128, free-form logs, and uncorroborated submissions carry NULL
 *      targets; counting them as matches would invent adherence that was never
 *      measured.
 *   2. A skipped DISCRETIONARY set is not a miss. When a program prescribes
 *      "3–5 sets", stopping at 3 is compliance, not shortfall. Only required
 *      sets count against fidelity.
 *
 * Pure: no DB, no I/O, no React.
 */

/** One logged set, in the shape `set_logs` now stores. */
export type FidelitySetInput = {
  weightKg: number | null;
  reps: number | null;
  skipped: boolean;
  targetWeightKg: number | null;
  targetReps: number | null;
  /** From `prescribed.optional` — true for discretionary sets. */
  optional?: boolean;
};

export type SetFidelity = {
  /** Fraction under target (>0 under, <0 over), or null when not comparable. */
  loadShortfall: number | null;
  repShortfall: number | null;
  /** True when at least one dimension could be compared. */
  comparable: boolean;
};

/**
 * Deviation band for a single set. Plate rounding and rep-range midpoints make
 * exact equality meaningless, so anything inside the tolerance reads as on-plan.
 */
export const FIDELITY_TOLERANCE = 0.025; // 2.5%

function shortfall(actual: number | null, target: number | null): number | null {
  if (target == null || target <= 0) return null;
  if (actual == null) return null;
  return (target - actual) / target;
}

/** Compare one logged set against its snapshot. */
export function setFidelity(set: FidelitySetInput): SetFidelity {
  // A skipped set is a total shortfall of whatever it prescribed — but only
  // where a target exists to be short OF.
  if (set.skipped) {
    const load = set.targetWeightKg != null && set.targetWeightKg > 0 ? 1 : null;
    const reps = set.targetReps != null && set.targetReps > 0 ? 1 : null;
    return { loadShortfall: load, repShortfall: reps, comparable: load != null || reps != null };
  }
  const loadShortfall = shortfall(set.weightKg, set.targetWeightKg);
  const repShortfall = shortfall(set.reps, set.targetReps);
  return {
    loadShortfall,
    repShortfall,
    comparable: loadShortfall != null || repShortfall != null,
  };
}

export type FidelityVerdict =
  | "no-data"
  /** Everything comparable landed within tolerance. */
  | "on-plan"
  /** Meaningfully under prescription — the autoregulation signal. */
  | "eased"
  /** Meaningfully over prescription. */
  | "pushed"
  /** Both directions present. */
  | "mixed";

export type FidelityRollup = {
  /** Sets carrying a usable snapshot. Everything below is out of this count. */
  comparableSets: number;
  /** Logged sets with no snapshot — surfaced so a partial picture is visible. */
  unknownSets: number;
  onPlanSets: number;
  easedSets: number;
  pushedSets: number;
  /** Required sets that were skipped outright. */
  skippedRequired: number;
  /** Discretionary sets not taken — autoregulation working as designed. */
  skippedOptional: number;
  /** Mean load shortfall across comparable, non-skipped sets. Null when none. */
  avgLoadShortfall: number | null;
  verdict: FidelityVerdict;
};

const EMPTY_ROLLUP: FidelityRollup = {
  comparableSets: 0,
  unknownSets: 0,
  onPlanSets: 0,
  easedSets: 0,
  pushedSets: 0,
  skippedRequired: 0,
  skippedOptional: 0,
  avgLoadShortfall: null,
  verdict: "no-data",
};

/**
 * Roll a collection of sets (one session, one week, or a whole block) into a
 * fidelity picture.
 *
 * Discretionary skips are counted separately and never contribute to the
 * verdict: declining an optional 5th set is the program working, not a miss.
 */
export function rollupFidelity(sets: readonly FidelitySetInput[]): FidelityRollup {
  const out: FidelityRollup = { ...EMPTY_ROLLUP };
  const loadShortfalls: number[] = [];

  for (const set of sets) {
    if (set.skipped && set.optional === true) {
      out.skippedOptional += 1;
      continue;
    }

    const f = setFidelity(set);
    if (!f.comparable) {
      out.unknownSets += 1;
      continue;
    }
    out.comparableSets += 1;

    if (set.skipped) {
      out.skippedRequired += 1;
      out.easedSets += 1;
      continue;
    }

    if (f.loadShortfall != null) loadShortfalls.push(f.loadShortfall);

    // Worst dimension decides: cutting reps at full load is still easing.
    const worst = Math.max(f.loadShortfall ?? -Infinity, f.repShortfall ?? -Infinity);
    const best = Math.min(f.loadShortfall ?? Infinity, f.repShortfall ?? Infinity);
    if (worst > FIDELITY_TOLERANCE) out.easedSets += 1;
    else if (best < -FIDELITY_TOLERANCE) out.pushedSets += 1;
    else out.onPlanSets += 1;
  }

  out.avgLoadShortfall =
    loadShortfalls.length === 0
      ? null
      : loadShortfalls.reduce((a, b) => a + b, 0) / loadShortfalls.length;

  if (out.comparableSets === 0) {
    out.verdict = "no-data";
  } else if (out.easedSets > 0 && out.pushedSets > 0) {
    out.verdict = "mixed";
  } else if (out.easedSets > 0) {
    out.verdict = "eased";
  } else if (out.pushedSets > 0) {
    out.verdict = "pushed";
  } else {
    out.verdict = "on-plan";
  }
  return out;
}

/**
 * Neutral, non-instructive summary of a rollup. Describes what happened; never
 * tells the lifter what to do next.
 *
 * Returns null when there is nothing worth saying, so callers can render
 * nothing rather than an empty card.
 */
export function fidelitySummaryLine(r: FidelityRollup): string | null {
  if (r.verdict === "no-data") return null;

  const pct = (n: number) => `${Math.round(Math.abs(n) * 100)}%`;
  const sets = (n: number) => `${n} set${n === 1 ? "" : "s"}`;

  if (r.verdict === "on-plan") {
    const tail =
      r.skippedOptional > 0
        ? ` · ${sets(r.skippedOptional)} of optional work not taken`
        : "";
    return `Logged as prescribed${tail}`;
  }

  const parts: string[] = [];
  if (r.easedSets > 0) parts.push(`${sets(r.easedSets)} under target`);
  if (r.pushedSets > 0) parts.push(`${sets(r.pushedSets)} above target`);
  if (r.skippedRequired > 0) parts.push(`${sets(r.skippedRequired)} skipped`);
  if (r.skippedOptional > 0) parts.push(`${sets(r.skippedOptional)} optional not taken`);
  if (r.avgLoadShortfall != null && Math.abs(r.avgLoadShortfall) > FIDELITY_TOLERANCE) {
    parts.push(
      `load ${r.avgLoadShortfall > 0 ? "down" : "up"} ${pct(r.avgLoadShortfall)} on average`,
    );
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}
