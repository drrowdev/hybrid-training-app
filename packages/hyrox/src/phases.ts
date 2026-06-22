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
 * Category of a weekly session "slot" — the quota vocabulary (ADR 0053). The
 * week builder fills a session budget by walking a per-phase ORDERED slot list
 * and resolving each slot to a concrete `sessions.ts` id, so the HYROX essentials
 * always lead and a real HYROX week is guaranteed at any budget (3–8) and every
 * experience level — not an artifact of where a session happened to sit in a pool.
 */
type HyroxSlotCat =
  | "strength"
  | "station" // functional-station work (intervals / SE circuit)
  | "quality" // threshold / VO2 running
  | "compromised" // run-under-fatigue, the signature HYROX skill
  | "long"
  | "easy"
  | "cross"; // off-feet ergs (ski/row) — leftover-only, never displaces an essential

/**
 * Per-phase ORDERED slot priority — the ADR 0053 quota model. Taking the first N
 * slots for an N-session budget guarantees the HYROX-essential categories first
 * (strength + a functional station every week; quality running; compromised
 * running from Build onward; the long aerobic run). `cross` (off-feet ergs) sits
 * LAST so it only fills genuinely leftover budget at high session counts and
 * never displaces a station or quality run in a small week. `[DEF]` coach-
 * consensus weekly dosing — see ADR 0050 §Calibration / ADR 0053.
 */
const PHASE_SLOTS: Record<HyroxPhaseId, HyroxSlotCat[]> = {
  // Base: aerobic foundation, but a station + the long run lead so even a
  // 3-session week trains the race; quality + easy fill; ergs leftover-only.
  base: ["strength", "station", "long", "quality", "easy", "cross", "easy"],
  // Build: strength + station-endurance + quality lead; compromised running
  // enters here (ADR 0053); long + easy fill; a second (split) strength day last.
  build: ["strength", "station", "quality", "compromised", "long", "easy", "strength"],
  // Race-prep: compromised + stations + strength + VO2 lead (race-specific);
  // long + easy fill; erg leftover-only.
  specific: ["compromised", "station", "strength", "quality", "long", "easy", "cross"],
  // Taper: reduced volume (capped at 4), intensity maintained — short, sharp,
  // with a station touch; no filler erg unless budget is high.
  taper: ["strength", "station", "quality", "easy", "quality", "cross", "easy"],
};

/**
 * Resolve a slot category to a concrete `sessions.ts` id, given the phase and how
 * many times this category has already been placed in the week (`occ`, 0-based).
 * Second occurrences vary the stimulus (a split strength day; the other erg/
 * station modality; a sharper VO2 over threshold).
 */
function sessionForSlot(phase: HyroxPhaseId, cat: HyroxSlotCat, occ: number): string {
  switch (cat) {
    case "strength":
      // First strength day is full-body; a second (high-budget) day splits to
      // lower/posterior so the week isn't a single monolithic session.
      return occ === 0 ? "strength-full" : "strength-lower";
    case "station":
      // Base/race-prep lead with station intervals (technique/pacing); Build
      // leans on the strength-endurance circuit. A second station slot uses the
      // other modality.
      if (phase === "build") return occ === 0 ? "se-circuit" : "station-intervals";
      return occ === 0 ? "station-intervals" : "se-circuit";
    case "quality":
      // Race-prep sharpens with VO2; earlier phases build threshold first, then
      // VO2 on any second quality slot.
      if (phase === "specific") return "vo2-intervals";
      return occ === 0 ? "threshold-run" : "vo2-intervals";
    case "compromised":
      return "compromised-run";
    case "long":
      return "long-run";
    case "easy":
      return "easy-run";
    case "cross":
      return occ === 0 ? "easy-ski" : "easy-row";
  }
}

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
  const slots = PHASE_SLOTS[phase];
  const wd = spreadFor(primaryCount);

  // Walk the phase's priority-ordered slots, taking the first `primaryCount`.
  // `occ` tracks per-category occurrences so a repeated category varies its
  // concrete session (split strength, the other erg, VO2 over threshold).
  const occ: Partial<Record<HyroxSlotCat, number>> = {};
  for (let i = 0; i < primaryCount; i++) {
    const cat = slots[i % slots.length]!;
    const n = occ[cat] ?? 0;
    occ[cat] = n + 1;
    const session = sessionForSlot(phase, cat, n);
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
