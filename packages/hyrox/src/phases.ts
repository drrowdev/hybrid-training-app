/**
 * HYROX — the periodized phase grid (ADR 0050).
 *
 * Unlike Green Protocol (which hand-transcribes fixed week tables), HYROX has a
 * variable block length (10 / 12 / 16 weeks by experience) and a variable
 * sessions/week (3–8), so the grid is GENERATED deterministically from
 * (weeks, sessionsPerWeek, experience). The generator walks a Base → Build →
 * Specific → Taper periodization, inserts a deload every 4th work week, and places
 * sessions on fixed weekdays following an 80/20-ish easy:hard distribution.
 *
 * Calibration: the phase proportions, deload cadence, weekday spreads, and the
 * per-phase session pools below are all `[DEF]` programming-schedule defaults
 * (coach consensus — RoxLyfe / HYROX365 / Weersma), conservative and
 * user-overridable. They are NOT calibrated physiology and introduce no engine
 * constant. The only "science" the program leans on (sRPE load, 80/20, taper) is
 * the existing CP-2 engine, applied at prescribe/completion time. See ADR 0050.
 */
import type { HyroxExperience } from "./types";
import { getHyroxSession } from "./sessions";

/** One day in the grid. Mirrors GP's `DayCell` discriminated union. */
export type HyroxDayCell =
  | { kind: "rest" }
  | { kind: "deload" }
  | { kind: "session"; session: string; plus?: { session: string } }
  /** A partial/full race simulation — a benchmark-like field test. */
  | { kind: "sim"; session: string };

export type HyroxPhaseId = "base" | "build" | "specific" | "taper";

export const PHASE_NAME: Record<HyroxPhaseId, string> = {
  base: "Base",
  build: "Build",
  specific: "Race-prep",
  taper: "Taper",
};

export interface HyroxWeekPlan {
  /** 1-based week number within the block. */
  week: number;
  phase: HyroxPhaseId;
  isDeload: boolean;
  /** Exactly 7 cells, Day 1 … Day 7 (index 0 = Monday). */
  days: HyroxDayCell[];
}

// ─────────────────────────────────────────────────────────────────────────────
// `[DEF]` scheduling constants — coach-consensus programming, user-overridable.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Taper length in weeks by experience. `[DEF]` — within the Bosquet 2007 evidence
 * window (a 7–14 day taper preserves fitness while shedding fatigue); beginners
 * need less accumulated fatigue shed. The taper's volume-down/intensity-maintained
 * MATH is the existing ADR-0008 engine, not a new constant.
 */
const TAPER_WEEKS: Record<HyroxExperience, number> = {
  beginner: 1,
  intermediate: 2,
  advanced: 2,
};

/** Work-week split into Base / Build / Specific. `[DEF]` proportions (sum 1.0). */
const BASE_FRACTION = 0.4;
const BUILD_FRACTION = 0.33;
// Specific = remainder.

/** Insert a deload on every Nth work week (skipping week 1 and the taper). `[DEF]`. */
const DELOAD_EVERY = 4;

/** How many of the final Specific weeks carry a half simulation. `[DEF]`. */
const SIM_WEEKS: Record<HyroxExperience, number> = {
  beginner: 1,
  intermediate: 1,
  advanced: 2,
};

/**
 * Fixed weekday placement for N primary sessions (0 = Monday). Spreads load and
 * keeps recovery days between the hardest efforts. `[DEF]`.
 */
const SPREAD: Record<number, number[]> = {
  1: [0],
  2: [0, 3],
  3: [0, 2, 4],
  4: [0, 1, 3, 5],
  5: [0, 1, 2, 4, 5],
  6: [0, 1, 2, 3, 4, 5],
  7: [0, 1, 2, 3, 4, 5, 6],
};

/**
 * Per-phase ordered session pools. Taking the first N and zipping onto the
 * (ascending) weekday spread yields a hard/easy alternation with strength early.
 * `[DEF]` content selection — each id resolves to a `sessions.ts` template.
 *
 * ORDERING IS LOAD-BEARING (ADR 0053): because `buildWeekDays` takes the FIRST N
 * entries for an N-session budget, the HYROX essentials (strength, a functional
 * station, the long run, a quality run) MUST lead each pool so even a 3-session
 * week is a real HYROX week. The demoted off-feet ergs (`easy-ski`/`easy-row`)
 * sit at the BACK so they only fill genuinely leftover budget at high session
 * counts — never displacing a station or quality run in a small week.
 */
const PHASE_POOLS: Record<HyroxPhaseId, string[]> = {
  // Base: strength + station technique + long aerobic lead; quality + easy fill;
  // ergs leftover-only.
  base: [
    "strength-full",
    "station-intervals",
    "long-run",
    "threshold-run",
    "easy-run",
    "easy-ski",
    "easy-row",
  ],
  // Build: strength + station-endurance + quality lead; long + easy fill; second
  // strength day and erg leftover-only.
  build: [
    "strength-full",
    "se-circuit",
    "threshold-run",
    "long-run",
    "easy-run",
    "strength-lower",
    "easy-ski",
  ],
  // Race-prep: compromised running + stations + strength + VO2 lead (already
  // HYROX-specific); easy aerobic fills; erg leftover-only.
  specific: [
    "compromised-run",
    "station-intervals",
    "strength-full",
    "vo2-intervals",
    "se-circuit",
    "easy-run",
    "easy-ski",
  ],
  // Taper: reduced volume, intensity maintained (short, sharp).
  taper: ["easy-run", "vo2-intervals", "strength-full", "easy-ski", "threshold-run", "easy-row", "easy-run"],
};

/** A deload week: a marker plus light optional aerobic. `[DEF]` (mirrors GP). */
function deloadWeekDays(): HyroxDayCell[] {
  const days: HyroxDayCell[] = Array.from({ length: 7 }, () => ({ kind: "rest" }));
  days[0] = { kind: "deload" };
  days[2] = { kind: "session", session: "easy-run" };
  days[4] = { kind: "session", session: "easy-ski" };
  return days;
}

function spreadFor(n: number): number[] {
  return SPREAD[Math.min(n, 7)] ?? SPREAD[7]!;
}

/** Effective primary sessions for a (non-deload) week of a given phase. */
function effectiveSessions(phase: HyroxPhaseId, sessionsPerWeek: number): number {
  // Taper sheds volume: cap at 4 sessions regardless of the block default.
  if (phase === "taper") return Math.min(sessionsPerWeek, 4);
  return sessionsPerWeek;
}

function buildWeekDays(
  phase: HyroxPhaseId,
  sessionsPerWeek: number,
  withSim: boolean,
): HyroxDayCell[] {
  const days: HyroxDayCell[] = Array.from({ length: 7 }, () => ({ kind: "rest" }));
  const total = effectiveSessions(phase, sessionsPerWeek);
  const primaryCount = Math.min(total, 7);
  const pool = PHASE_POOLS[phase];
  const wd = spreadFor(primaryCount);

  for (let i = 0; i < primaryCount; i++) {
    const session = pool[i % pool.length]!;
    days[wd[i]!] = { kind: "session", session };
  }

  // Two-a-day overflow (8 sessions/week): an easy second session on Monday.
  if (total > 7) {
    const d = days[wd[0]!]!;
    if (d.kind === "session") {
      days[wd[0]!] = { ...d, plus: { session: "easy-ski" } };
    }
  }

  // Race-prep simulation: the last placed session of the week becomes a half sim.
  if (withSim && primaryCount > 0) {
    days[wd[primaryCount - 1]!] = { kind: "sim", session: "sim-half" };
  }

  return days;
}

// ─────────────────────────────────────────────────────────────────────────────
// Grid generation
// ─────────────────────────────────────────────────────────────────────────────

export interface HyroxGridInput {
  weeks: number;
  sessionsPerWeek: number;
  experience: HyroxExperience;
}

/**
 * Assign each 1-based week to a periodization phase. Base/Build/Specific fill the
 * "work" weeks (everything before the taper); the final `TAPER_WEEKS` are taper.
 */
function phaseForWeek(week: number, weeks: number, experience: HyroxExperience): HyroxPhaseId {
  const taperWeeks = Math.min(TAPER_WEEKS[experience], Math.max(1, weeks - 1));
  const workWeeks = weeks - taperWeeks;
  if (week > workWeeks) return "taper";
  const baseWeeks = Math.max(1, Math.round(workWeeks * BASE_FRACTION));
  const buildWeeks = Math.max(1, Math.round(workWeeks * BUILD_FRACTION));
  if (week <= baseWeeks) return "base";
  if (week <= baseWeeks + buildWeeks) return "build";
  return "specific";
}

/** The full periodized grid for a HYROX block. */
export function buildHyroxGrid(input: HyroxGridInput): HyroxWeekPlan[] {
  const weeks = Math.max(1, Math.floor(input.weeks));
  const sessionsPerWeek = Math.max(1, Math.floor(input.sessionsPerWeek));
  const { experience } = input;

  // First pass: assign phases + deload flags.
  const phases: HyroxPhaseId[] = [];
  for (let w = 1; w <= weeks; w++) phases.push(phaseForWeek(w, weeks, experience));

  const isDeload = (w: number): boolean => {
    const phase = phases[w - 1]!;
    // Deloads belong in the accumulation phases. The Specific (race-prep) block is
    // short and the taper follows soon after, so we never interrupt those — that
    // would collapse race-prep to nothing (esp. for beginners). `[DEF]`.
    return (phase === "base" || phase === "build") && w > 1 && w % DELOAD_EVERY === 0;
  };

  // Identify which Specific weeks (non-deload) carry a simulation: the last K.
  const specificWeeks: number[] = [];
  for (let w = 1; w <= weeks; w++) {
    if (phases[w - 1] === "specific" && !isDeload(w)) specificWeeks.push(w);
  }
  const simWeekSet = new Set(specificWeeks.slice(-SIM_WEEKS[experience]));

  const plan: HyroxWeekPlan[] = [];
  for (let w = 1; w <= weeks; w++) {
    const phase = phases[w - 1]!;
    const deload = isDeload(w);
    const days = deload
      ? deloadWeekDays()
      : buildWeekDays(phase, sessionsPerWeek, simWeekSet.has(w));
    plan.push({ week: w, phase, isDeload: deload, days });
  }
  return plan;
}

/** All distinct session ids referenced by a grid (for catalog/seed validation). */
export function sessionsInGrid(plan: HyroxWeekPlan[]): string[] {
  const seen = new Set<string>();
  for (const week of plan) {
    for (const cell of week.days) {
      if (cell.kind === "session") {
        seen.add(cell.session);
        if (cell.plus) seen.add(cell.plus.session);
      } else if (cell.kind === "sim") {
        seen.add(cell.session);
      }
    }
  }
  return [...seen];
}

/** True iff every session id referenced in the grid resolves in the vocabulary. */
export function gridSessionsResolve(plan: HyroxWeekPlan[]): boolean {
  return sessionsInGrid(plan).every((id) => getHyroxSession(id) !== undefined);
}
