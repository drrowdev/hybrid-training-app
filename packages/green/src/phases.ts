/**
 * Green Protocol — phase grids (the 7-day週 blueprints).
 *
 * Each phase is a sequence of weeks; each week is exactly 7 day-cells (Day 1…7).
 * A cell is rest, a deload marker, a strength session (delegated to a Tactical
 * Barbell template), or a conditioning session (from the vocabulary, with an
 * optional duration/distance target range).
 *
 * Transcribed from Green Protocol's Continuation tables. This first slice covers
 * the two everyday Continuation baselines:
 *   - Hybrid (14 weeks): an Operator strength-emphasis half, deload, a Fighter
 *     running-emphasis half, deload.
 *   - Hybrid/Op (6 weeks + deload): a 50/50 Operator + conditioning block.
 */
import type { ConditioningUnit } from "./conditioning";

/** Which Tactical Barbell strength template a strength cell delegates to. */
export type GreenStrength = "OP" | "FT" | "ZULU_HT";

export type DayCell =
  | { kind: "rest" }
  | { kind: "deload" }
  | { kind: "strength"; strength: GreenStrength }
  | {
      kind: "conditioning";
      /** Conditioning session id (see conditioning.ts). */
      session: string;
      /** Optional target range (low/high) in the session's unit. */
      min?: number;
      max?: number;
      /** Override the session's default unit if the grid prescribes another. */
      unit?: ConditioningUnit;
    };

export interface GreenWeek {
  /** Exactly 7 cells, Day 1 … Day 7. */
  days: DayCell[];
}

export interface GreenBenchmark {
  id: string;
  name: string;
  target: string;
}

export interface GreenPhase {
  id: string;
  name: string;
  summary: string;
  /** Foundation phases are benchmark-gated, sequential builders; Continuation phases repeat indefinitely. */
  category: "foundation" | "continuation";
  weeks: GreenWeek[];
  /** Field test gating progression (Foundation only). */
  benchmark?: GreenBenchmark;
  notes: string[];
}

// ── cell constructors ────────────────────────────────────────────────────────
const rest: DayCell = { kind: "rest" };
const deload: DayCell = { kind: "deload" };
const op: DayCell = { kind: "strength", strength: "OP" };
const ft: DayCell = { kind: "strength", strength: "FT" };
function cond(session: string, min?: number, max?: number): DayCell {
  return {
    kind: "conditioning",
    session,
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {}),
  };
}
/** A full deload week (one marker, the rest is recovery / optional light work). */
const deloadWeek: GreenWeek = { days: [deload, rest, rest, rest, rest, rest, rest] };

// ── Hybrid (14 weeks) ────────────────────────────────────────────────────────
// Weeks 1–6: Operator strength emphasis (lift Day 1/3/5; condition Day 2/4/6).
// Week 7: deload. Weeks 8–13: Fighter running emphasis. Week 14: deload.
const HYBRID_OP_WEEK = (mid: DayCell): GreenWeek => ({
  days: [op, mid, op, cond("lss", 30, 60), op, cond("long-run"), rest],
});
const HYBRID_FT_WEEK: GreenWeek = {
  days: [ft, cond("hill"), cond("lss", 30, 60), ft, cond("speed"), cond("long-run"), rest],
};

const HYBRID: GreenPhase = {
  id: "hybrid",
  name: "Hybrid",
  category: "continuation",
  summary:
    "Green Protocol's flagship indefinite baseline: an Operator strength-emphasis half, then a Fighter running-emphasis half. Lift and run, periodised so each phase complements the other.",
  weeks: [
    HYBRID_OP_WEEK(cond("hill")),
    HYBRID_OP_WEEK(cond("speed")),
    HYBRID_OP_WEEK(cond("hill")),
    HYBRID_OP_WEEK(cond("speed")),
    HYBRID_OP_WEEK(cond("hill")),
    HYBRID_OP_WEEK(cond("speed")),
    deloadWeek,
    HYBRID_FT_WEEK,
    HYBRID_FT_WEEK,
    HYBRID_FT_WEEK,
    HYBRID_FT_WEEK,
    HYBRID_FT_WEEK,
    HYBRID_FT_WEEK,
    deloadWeek,
  ],
  notes: [
    "During the Operator half, emphasise strength — extra sets, push the gym work; keep conditioning manageable.",
    "During the Fighter half, prioritise running — extend distance/duration; let lifting take a temporary backseat.",
    "LSS may replace any Hill or Speed session, and may be programmed by time or distance.",
    "Designed for the baseline/detour model — run it most of the year and take training detours as needed.",
  ],
};

// ── Hybrid/Op (6 weeks + deload) ─────────────────────────────────────────────
// A 50/50 Operator + conditioning block, no Fighter half. Repeats indefinitely.
const HYBRID_OP_50: GreenPhase = {
  id: "hybrid-op",
  name: "Hybrid/Op",
  category: "continuation",
  summary:
    "A 50/50 split of Operator strength and conditioning with no Fighter half — a fit for roles with a lighter endurance demand (e.g. police special operations).",
  weeks: [
    { days: [op, cond("hill"), op, cond("lss", 30, 60), op, cond("fartlek"), rest] },
    { days: [op, cond("speed"), op, cond("lss", 30, 60), op, cond("long-run"), rest] },
    { days: [op, cond("hill"), op, cond("lss", 30, 60), op, cond("fartlek"), rest] },
    { days: [op, cond("speed"), op, cond("lss", 30, 60), op, cond("long-run"), rest] },
    { days: [op, cond("hill"), op, cond("lss", 30, 60), op, cond("fartlek"), rest] },
    { days: [op, cond("speed"), op, cond("lss", 30, 60), op, cond("long-run"), rest] },
    deloadWeek,
  ],
  notes: [
    "A 50/50 strength/conditioning split — keep both modalities progressing.",
    "Can be compressed to fewer days via AM/PM splits (lift AM, run PM) or by doing LSS after an Operator session.",
  ],
};

export const GREEN_PHASES: GreenPhase[] = [HYBRID, HYBRID_OP_50];

export function getGreenPhase(id: string): GreenPhase | undefined {
  return GREEN_PHASES.find((p) => p.id === id);
}

/** The strength templates a phase references (for seeding TB instances). */
export function strengthTemplatesInPhase(phase: GreenPhase): GreenStrength[] {
  const seen = new Set<GreenStrength>();
  for (const week of phase.weeks) {
    for (const cell of week.days) {
      if (cell.kind === "strength") seen.add(cell.strength);
    }
  }
  return [...seen];
}
