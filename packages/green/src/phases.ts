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
    }
  | {
      /** A benchmark field test (Foundation phases) — gates progression. */
      kind: "test";
      session: string;
      min?: number;
      max?: number;
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
function cond(session: string, min?: number, max?: number, unit?: ConditioningUnit): DayCell {
  return {
    kind: "conditioning",
    session,
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {}),
    ...(unit !== undefined ? { unit } : {}),
  };
}
/** Conditioning prescribed in miles (overrides the session's default unit). */
function condMi(session: string, min?: number, max?: number): DayCell {
  return cond(session, min, max, "miles");
}
/** A benchmark field test cell (Foundation phases). */
function test(session: string, min: number, unit: ConditioningUnit): DayCell {
  return { kind: "test", session, min, unit };
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

// ── Capacity (Foundation, 12 weeks) ──────────────────────────────────────────
// Operator strength 3×/wk + LSS running (50/50). Deload every 4th week. LSS in
// minutes, escalating across the three 4-week mesocycles. Benchmark: 6-mile run.
const CAP_EARLY = (): GreenWeek => ({
  days: [op, cond("lss", 30, 60), op, cond("lss", 30, 60), op, cond("lss", 60, 90), rest],
});
const CAP_MID = (): GreenWeek => ({
  days: [op, cond("lss", 60, 90), op, cond("lss", 60, 90), op, cond("lss", 90, 120), rest],
});
const CAP_LATE = (): GreenWeek => ({
  days: [op, cond("lss", 60, 120), op, cond("lss", 60, 120), op, cond("lss", 120), rest],
});
const CAP_DELOAD: GreenWeek = {
  days: [deload, cond("lss", 30), rest, cond("lss", 30), rest, cond("lss", 30), rest],
};

const CAPACITY: GreenPhase = {
  id: "capacity",
  name: "Capacity",
  category: "foundation",
  summary:
    "The Foundation base-builder: Operator strength 3×/wk plus easy LSS running in a 50/50 split, escalating volume over 12 weeks. Builds raw strength and aerobic base.",
  weeks: [
    CAP_EARLY(),
    CAP_EARLY(),
    CAP_EARLY(),
    CAP_DELOAD,
    CAP_MID(),
    CAP_MID(),
    CAP_MID(),
    CAP_DELOAD,
    CAP_LATE(),
    CAP_LATE(),
    CAP_LATE(),
    { days: [rest, cond("lss", 30), rest, cond("lss", 30), rest, test("long-run", 6, "miles"), rest] },
  ],
  benchmark: { id: "capacity-6mile", name: "6-Mile Run", target: "6 miles in 60 minutes or less" },
  notes: [
    "Keep LSS strictly easy (lower aerobic range, flat terrain); it doubles as active recovery.",
    "Can be cut to 8 weeks for those who've already done significant base training and can meet the benchmark.",
    "Pass the 6-mile benchmark (≤ 60 min) to progress to Velocity; if not, extend Capacity.",
  ],
};

// ── Velocity (Foundation, 17 weeks) ──────────────────────────────────────────
// Fighter strength 2×/wk + 4 runs/wk (LSS in miles, a rotating speed/hill/800
// slot, and an escalating weekly Long Run with periodic back-to-backs). The last
// mesocycle swaps heavy Fighter for Strength-Endurance, then a taper. Deload
// every 4th week. Benchmark: 20-mile off-road run.
const VELOCITY: GreenPhase = {
  id: "velocity",
  name: "Velocity",
  category: "foundation",
  summary:
    "The Foundation endurance-builder: Fighter strength 2×/wk plus four runs a week (LSS, speed/hill/intervals, and an escalating Long Run with back-to-backs), converting to Strength-Endurance before a taper. Benchmark: a 20-mile off-road run.",
  weeks: [
    { days: [ft, condMi("lss", 5), cond("tempo", 3, 5), ft, condMi("lss", 3), condMi("long-run", 8), rest] },
    { days: [ft, condMi("lss", 6), cond("hill", 30, 120), ft, condMi("lss", 3), condMi("long-run", 9), rest] },
    { days: [ft, condMi("lss", 6), cond("intervals-800", 3, 5), ft, condMi("lss", 3), condMi("long-run", 10), rest] },
    { days: [deload, condMi("lss", 3), rest, condMi("lss", 3), rest, condMi("lss", 3), rest] },
    { days: [ft, condMi("lss", 6), cond("tempo", 3, 5), ft, condMi("lss", 4), condMi("long-run", 11), rest] },
    { days: [ft, condMi("lss", 8), cond("hill", 30, 120), ft, condMi("lss", 4), condMi("long-run", 12), rest] },
    { days: [ft, condMi("lss", 8), cond("intervals-800", 3, 5), ft, rest, condMi("long-run", 13), condMi("back-to-back-lr", 8)] },
    { days: [deload, condMi("lss", 4), rest, condMi("lss", 4), rest, condMi("lss", 4), rest] },
    { days: [ft, condMi("lss", 7), cond("tempo", 3, 5), ft, condMi("lss", 5), condMi("long-run", 14), rest] },
    { days: [ft, condMi("lss", 10), cond("hill", 30, 120), ft, condMi("lss", 5), condMi("long-run", 15), rest] },
    { days: [ft, condMi("lss", 10), cond("intervals-800", 5, 8), ft, rest, condMi("long-run", 16), condMi("back-to-back-lr", 10)] },
    { days: [deload, condMi("lss", 5), rest, condMi("lss", 5), rest, condMi("lss", 5), rest] },
    { days: [cond("se"), condMi("lss", 8), cond("tempo", 3, 5), cond("se"), condMi("lss", 6), condMi("long-run", 17), rest] },
    { days: [cond("se"), condMi("lss", 12), cond("hill", 30, 120), cond("se"), condMi("lss", 6), condMi("long-run", 18), rest] },
    { days: [cond("se"), condMi("lss", 12), cond("intervals-800", 5, 8), cond("se"), rest, condMi("long-run", 19), condMi("back-to-back-lr", 12)] },
    { days: [deload, condMi("lss", 2), rest, condMi("lss", 2), rest, condMi("lss", 3), rest] },
    { days: [rest, condMi("lss", 3), rest, condMi("lss", 2), condMi("lss", 2), test("long-run", 20, "miles"), rest] },
  ],
  benchmark: { id: "velocity-20mile", name: "20-Mile Off-Road Run", target: "20 miles off-road in 8 hours or less (challenge: 27 miles in 11 hours)" },
  notes: [
    "Fighter handles strength while mileage builds; the final mesocycle swaps it for Strength-Endurance, which taxes the CNS less under peak mileage.",
    "Back-to-Back Long Runs (weeks 7/11/15) are a potent endurance stimulus — use them as written, not more often.",
    "Experienced runners can start later (e.g. week 5). Deload sessions are recommendations — do less if needed.",
    "Pass the 20-mile benchmark to progress; if not, take a week off and restart around week 9.",
  ],
};

export const GREEN_PHASES: GreenPhase[] = [HYBRID, HYBRID_OP_50, CAPACITY, VELOCITY];

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
