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
  /** Taper sub-kind for taper weeks (`null` otherwise) — drives the conditioning
   *  volume taper in prescription (ADR 0065). */
  taperKind: TaperKind;
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

/**
 * No-race (ADR 0060) Base-intro length, in weeks. `[DEF]` — a SHORT settle-in, not the
 * proportional race-mode base. Grounded in annual-plan practice (Friel): a long base
 * is for building a peak from a reduced state; the between-goals Transition is only
 * ~3–4 weeks, and a maintained athlete shouldn't re-base every re-created block. Held
 * deliberately short so the block spends almost all its time in the Build steady state.
 */
const NO_RACE_BASE_WEEKS = 4;

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
  | "cross"; // off-feet easy aerobic (bike/row) — leftover-only, never an essential

/**
 * Per-phase ORDERED slot priority — the ADR 0053 quota model. Taking the first N
 * slots for an N-session budget guarantees the HYROX-essential categories first
 * (strength + a functional station every week; quality running; compromised
 * running from Build onward; the long aerobic run). `cross` (off-feet easy aerobic)
 * sits LAST so it only fills genuinely leftover budget at high session counts and
 * never displaces a station or quality run in a small week. `[DEF]` coach-
 * consensus weekly dosing — see ADR 0050 §Calibration / ADR 0053.
 *
 * Taper (ADR 0055) is NOT keyed here — it splits into a "sharpen" and a "race"
 * week, resolved by `slotsForWeek`.
 */
const PHASE_SLOTS: Record<HyroxPhaseId, HyroxSlotCat[]> = {
  // Base: strength + station + long + quality lead; a SECOND (split) strength day
  // enters at the 5th slot (ADR 0056) since base has no compromised work to
  // protect; easy + erg fill the rest.
  base: ["strength", "station", "long", "quality", "strength", "easy", "cross"],
  // Build: all four endurance essentials (station, quality, compromised, long)
  // are protected ahead of the 2nd strength day, so the split strength only
  // appears at 6+ sessions (ADR 0056 — endurance-protected); easy fills last.
  build: ["strength", "station", "quality", "compromised", "long", "strength", "easy"],
  // Race-prep: compromised + stations + strength + VO2 lead (race-specific);
  // ONE strength day (maintenance, ADR 0056) — no 2nd strength here; long + easy
  // fill; erg leftover-only.
  specific: ["compromised", "station", "strength", "quality", "long", "easy", "cross"],
  // Taper "sharpen" week (earlier taper week, 2-week tapers only): one LAST
  // moderate strength + one LAST quality + a station touch + easy (ADR 0055).
  taper: ["strength", "quality", "station", "easy", "easy", "easy", "easy"],
};

/**
 * Taper RACE week (the final taper week, ≤7 days out) — ADR 0055. NO heavy
 * strength, NO separate hard threshold/VO2: a single short race-pace primer
 * (compromised run = run+station at race effort, volume-cut by the taper engine),
 * a light station technique touch, then easy. Capped at 3 sessions to bias rest.
 */
const TAPER_RACE_SLOTS: HyroxSlotCat[] = ["compromised", "station", "easy", "easy", "easy", "easy", "easy"];

function slotsForWeek(phase: HyroxPhaseId, taperKind: TaperKind): HyroxSlotCat[] {
  if (phase === "taper" && taperKind === "race") return TAPER_RACE_SLOTS;
  return PHASE_SLOTS[phase];
}

/**
 * Resolve a slot category to a concrete `sessions.ts` id, given the phase and how
 * many times this category has already been placed in the week (`occ`, 0-based).
 * Second occurrences vary the stimulus (a split strength day; the other erg/
 * station modality; a sharper VO2 over threshold).
 */
/**
 * Resolve a slot category to a concrete `sessions.ts` id, given the phase, how
 * many times this category has already been placed in the week (`occ`, 0-based),
 * and the week number (for Build quality undulation).
 */
function sessionForSlot(
  phase: HyroxPhaseId,
  cat: HyroxSlotCat,
  occ: number,
  week: number,
  strengthTotal: number,
): string {
  switch (cat) {
    case "strength":
      // ADR 0058 — two-main split. A week with TWO strength days alternates a
      // Squat+Press day (A) and a Deadlift+Pull day (B): each day has only two
      // heavy efforts (protecting CNS + movement quality), the compound pull is
      // promoted to a primary lift, and every pattern is hit ~1x heavy + backfilled
      // to 2x muscle stimulus by demand-matched accessories. A SINGLE strength day
      // (low weekly frequency) uses the full-body session so no pattern is missed.
      // HYROX never demands max force, so mains stay at 4–6 reps (strength reserve).
      if (strengthTotal >= 2) return occ === 0 ? "strength-a" : "strength-b";
      return "strength-full";
    case "station":
      // Base/race-prep lead with station intervals (technique/pacing); Build
      // leans on the strength-endurance circuit. A second station slot uses the
      // other modality.
      if (phase === "build") return occ === 0 ? "se-circuit" : "station-intervals";
      return occ === 0 ? "station-intervals" : "se-circuit";
    case "quality":
      // Race-prep sharpens with VO2. Build UNDULATES the weekly quality stimulus
      // (ADR 0055) — threshold on odd weeks, VO2 on even — instead of repeating one
      // type, matching block-periodization practice. Base/taper build threshold.
      if (phase === "specific") return "vo2-intervals";
      if (phase === "build") return week % 2 === 0 ? "vo2-intervals" : "threshold-run";
      return occ === 0 ? "threshold-run" : "vo2-intervals";
    case "compromised":
      return "compromised-run";
    case "long":
      return "long-run";
    case "easy":
      return "easy-run";
    case "cross":
      // Easy off-feet aerobic (ADR 0055): the BIKE is the best easy-Z2 tool
      // (low-impact, no eccentric or grip/shoulder fatigue — Spies/HYROX365,
      // Weersma, Botterill); row varies it. Ski is intentionally NOT here — it's a
      // station/intervals tool, poor for long easy work.
      return occ === 0 ? "easy-bike" : "easy-row";
  }
}

/** A deload week: a marker plus light optional aerobic. `[DEF]` (mirrors GP). */
function deloadWeekDays(): HyroxDayCell[] {
  const days: HyroxDayCell[] = Array.from({ length: 7 }, () => ({ kind: "rest" }));
  days[0] = { kind: "deload" };
  days[2] = { kind: "session", session: "easy-run" };
  // Low-impact recovery aerobic — bike, not ski (ADR 0055).
  days[4] = { kind: "session", session: "easy-bike" };
  return days;
}

/** Taper sub-kind: the final taper week is the "race" week (≤7d out); earlier
 *  taper weeks (2-week tapers) are "sharpen". Non-taper weeks pass `null`. */
export type TaperKind = "sharpen" | "race" | null;

/** Race-simulation kind for a Specific week (ADR 0068): a `full` 8+8 rehearsal early
 *  in race-prep (clear of the race), a `half` 4+4 sharpener nearer the taper, or
 *  `null` for a non-sim week. */
type SimKind = "full" | "half" | null;

function spreadFor(n: number): number[] {
  return SPREAD[Math.min(n, 7)] ?? SPREAD[7]!;
}

/**
 * Evenly-spaced session POSITIONS (indices into the N-session week) for the K
 * strength days, so two strength days land mid-week and well apart — e.g. the
 * 2nd & 4th training days (Tue + Fri in a default 5-day week) instead of
 * bookending the week on the 1st & last (Mon/Sat). One strength day lands near
 * the middle. ADR 0056. Returns exactly K distinct indices in [0, n).
 */
function strengthPositions(n: number, k: number): Set<number> {
  const out = new Set<number>();
  if (k <= 0 || n <= 0) return out;
  for (let i = 0; i < k; i++) {
    // Ideal even split: the K sessions divide the week into K+1 equal gaps.
    let p = Math.round(((i + 1) * (n + 1)) / (k + 1)) - 1;
    p = Math.max(0, Math.min(n - 1, p));
    while (out.has(p) && p < n - 1) p += 1; // nudge off any collision
    while (out.has(p) && p > 0) p -= 1;
    out.add(p);
  }
  return out;
}

/** Effective primary sessions for a (non-deload) week. Taper sheds volume: the
 *  sharpen week caps at 4, the race week at 3 to bias rest (ADR 0055). */
function effectiveSessions(phase: HyroxPhaseId, taperKind: TaperKind, sessionsPerWeek: number): number {
  if (phase === "taper") return Math.min(sessionsPerWeek, taperKind === "race" ? 3 : 4);
  return sessionsPerWeek;
}

/**
 * Two-a-day (AM/PM) programming — ADR 0054. Max double-days per week by
 * experience. `[DEF]` heuristic (CP-1): tuned between the conservative concurrent-
 * training science (Robineau 2016 — 2 doubles/wk already submaximal) and real
 * HYROX practice (advanced athletes run 3–5/wk because the companion is easy).
 * Beginners get none — insufficient base; Bellinger 2020 overreaching risk.
 */
const TWO_A_DAY_CAP: Record<HyroxExperience, number> = {
  beginner: 0,
  intermediate: 2,
  advanced: 3,
};

/**
 * Sessions whose adaptation an easy aerobic companion pairs with (ADR 0054 R8).
 * A double-day is one HARD primary + one EASY companion; we never double an
 * already-easy day, the long run, or a simulation.
 */
const HARD_PRIMARY: ReadonlySet<string> = new Set([
  "strength-full",
  "strength-a",
  "strength-b",
  "strength-lower",
  "strength-upper",
  "station-intervals",
  "se-circuit",
  "threshold-run",
  "vo2-intervals",
  "compromised-run",
]);

/**
 * The easy off-feet erg used as the PM companion (ADR 0054 R5, refined ADR 0055).
 * Always an easy erg — lowest interference with strength (Wilson 2012) and no
 * ground-reaction impact on legs loaded by the AM session (Doma 2019).
 * Bike-DOMINANT (the best easy-Z2 tool — no eccentric or grip/shoulder fatigue),
 * varied with row; ski is excluded (an intervals/technique tool, poor for easy).
 */
const COMPANION_ERGS = ["easy-bike", "easy-row", "easy-bike"] as const;

/**
 * Attach an easy off-feet erg PM companion to up to `cap` HARD-primary days,
 * on NON-ADJACENT weekdays (ADR 0054 R7/R8). Mutates `days` in place. No-op when
 * the cap is 0, in the taper, or when no eligible hard day exists. Deload weeks
 * never reach here (they are built separately), and simulation cells are excluded
 * (sims are standalone hard days).
 */
function applyTwoADays(days: HyroxDayCell[], phase: HyroxPhaseId, experience: HyroxExperience): void {
  const cap = TWO_A_DAY_CAP[experience];
  if (cap <= 0 || phase === "taper") return;
  let placed = 0;
  const selected: number[] = [];
  for (let d = 0; d < days.length && placed < cap; d++) {
    const cell = days[d]!;
    if (cell.kind !== "session" || !HARD_PRIMARY.has(cell.session)) continue;
    if (selected.includes(d - 1)) continue; // keep double-days non-adjacent
    days[d] = { ...cell, plus: { session: COMPANION_ERGS[placed % COMPANION_ERGS.length]! } };
    selected.push(d);
    placed += 1;
  }
}

function buildWeekDays(
  phase: HyroxPhaseId,
  sessionsPerWeek: number,
  simKind: SimKind,
  experience: HyroxExperience,
  twoADay: boolean,
  week: number,
  taperKind: TaperKind,
  doubleStrength: boolean,
): HyroxDayCell[] {
  const days: HyroxDayCell[] = Array.from({ length: 7 }, () => ({ kind: "rest" }));
  const total = effectiveSessions(phase, taperKind, sessionsPerWeek);
  const primaryCount = Math.min(total, 7);
  const slots = slotsForWeek(phase, taperKind);
  const wd = spreadFor(primaryCount);

  // Resolve the week's sessions in priority order. `occ` tracks per-category
  // occurrences so a repeated category varies its concrete session (the other
  // erg, VO2 over threshold; the Squat+Press vs Deadlift+Pull strength split —
  // ADR 0058). Count strength slots up front so a solo strength day gets the
  // full-body session while a two-strength week alternates the split.
  const weekSlots = Array.from({ length: primaryCount }, (_, i) => slots[i % slots.length]!);
  // ADR 0059 — Build alternation. On a "double" Build week at exactly 5 sessions,
  // swap the bankable long run for a 2nd strength day, so the split (strength-a /
  // strength-b) appears and the high-specificity endurance (station / quality /
  // compromised) stays weekly. Only fires here: Build never tapers, so total === 5
  // means sessionsPerWeek === 5 (the exact budget where the 2nd strength just
  // misses); at 6+ the 2nd strength is already in-budget so this is a no-op.
  if (doubleStrength && phase === "build" && total === 5) {
    const longIdx = weekSlots.lastIndexOf("long");
    if (longIdx !== -1) weekSlots[longIdx] = "strength";
  }
  const strengthTotal = weekSlots.filter((c) => c === "strength").length;
  const occ: Partial<Record<HyroxSlotCat, number>> = {};
  const resolved: { cat: HyroxSlotCat; session: string }[] = [];
  for (let i = 0; i < primaryCount; i++) {
    const cat = weekSlots[i]!;
    const n = occ[cat] ?? 0;
    occ[cat] = n + 1;
    resolved.push({ cat, session: sessionForSlot(phase, cat, n, week, strengthTotal) });
  }

  // Place sessions onto the week's training days. Strength goes on evenly-spaced
  // positions (ADR 0056 — Tue/Fri rather than Mon/Sat); the remaining sessions
  // fill the other days in priority order. Position i = the user's i-th chosen
  // training day (materialize seats specs in emission order). Track each placed
  // day's CATEGORY so the simulation can displace the right session (ADR 0067).
  const strengthQueue = resolved.filter((r) => r.cat === "strength");
  const otherQueue = resolved.filter((r) => r.cat !== "strength");
  const sPos = strengthPositions(primaryCount, strengthQueue.length);
  let si = 0;
  let oi = 0;
  const posCat: (HyroxSlotCat | undefined)[] = Array.from({ length: primaryCount }, () => undefined);
  for (let pos = 0; pos < primaryCount; pos++) {
    const useStrength = sPos.has(pos) && si < strengthQueue.length;
    const picked = useStrength ? strengthQueue[si++]! : (otherQueue[oi++] ?? strengthQueue[si++]!);
    days[wd[pos]!] = { kind: "session", session: picked.session };
    posCat[pos] = picked.cat;
  }

  // Race-prep simulation. A simulation IS a hard, race-specific effort, so it must
  // REPLACE a redundant hard session — NOT the week's aerobic recovery. The old
  // rule ("last non-strength day") displaced the LONG RUN, leaving the peak week as
  // 4 hard sessions + a max-effort sim with no easy/aerobic day (the reviewers'
  // "death week"). Instead displace the last QUALITY/STATION day — the sim already
  // rehearses stations + race-pace running — preserving strength, compromised (the
  // signature skill, also a program invariant), and the long/easy aerobic recovery.
  // Fallback to the old rule if no quality/station day exists (ADR 0067). The sim
  // is a `full` (8+8) early-race-prep rehearsal or a `half` (4+4) sharpener (ADR 0068).
  if (simKind && primaryCount > 0) {
    let simPos = -1;
    for (let pos = primaryCount - 1; pos >= 0; pos--) {
      const cat = posCat[pos];
      if (cat === "quality" || cat === "station") {
        simPos = pos;
        break;
      }
    }
    if (simPos === -1) {
      simPos = primaryCount - 1;
      while (simPos > 0 && sPos.has(simPos)) simPos -= 1;
    }
    days[wd[simPos]!] = { kind: "sim", session: simKind === "full" ? "sim-full" : "sim-half" };
  }

  // Two-a-day companions (ADR 0054) — applied AFTER the sim so a sim day is never
  // doubled and a companion is never overwritten by a sim.
  if (twoADay) applyTwoADays(days, phase, experience);

  return days;
}

// ─────────────────────────────────────────────────────────────────────────────
// Grid generation
// ─────────────────────────────────────────────────────────────────────────────

export interface HyroxGridInput {
  weeks: number;
  sessionsPerWeek: number;
  experience: HyroxExperience;
  /** Two-a-day (AM/PM) programming — adds easy off-feet PM companions (ADR 0054). */
  twoADay?: boolean;
  /**
   * Whether this block targets a race (ADR 0060). With a race (default), the grid
   * peaks: Base → Build → Specific → Taper, ending on race week. WITHOUT a race
   * (`false`), it never tapers or sharpens — a short Base intro then a held Build
   * steady state (concurrent maintenance), so the athlete stays race-ready without
   * spending a peak they won't use.
   */
  hasRace?: boolean;
}

/**
 * Assign each 1-based week to a periodization phase. With a race: Base/Build/Specific
 * fill the "work" weeks and the final `TAPER_WEEKS` are taper. WITHOUT a race (ADR
 * 0060): a short capped Base intro, then Build for the remainder — no Specific, no
 * Taper.
 */
function phaseForWeek(
  week: number,
  weeks: number,
  experience: HyroxExperience,
  hasRace: boolean,
): HyroxPhaseId {
  if (!hasRace) {
    // No-race maintenance (ADR 0060): a SHORT fixed base intro (not the proportional
    // race-mode base — a maintained athlete shouldn't re-base every re-created block),
    // then Build steady state forever. Never Specific/Taper.
    const baseWeeks = Math.min(NO_RACE_BASE_WEEKS, Math.max(1, weeks - 1));
    return week <= baseWeeks ? "base" : "build";
  }
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
  const twoADay = input.twoADay ?? false;
  const hasRace = input.hasRace ?? true;

  // First pass: assign phases.
  const phases: HyroxPhaseId[] = [];
  for (let w = 1; w <= weeks; w++) phases.push(phaseForWeek(w, weeks, experience, hasRace));

  // All Specific weeks (phase-only, before deloads) — the last `SIM_WEEKS` are the
  // half-sim sharpeners, protected from deloads so the final race rehearsals into the
  // taper stay intact.
  const allSpecificWeeks: number[] = [];
  for (let w = 1; w <= weeks; w++) if (phases[w - 1] === "specific") allSpecificWeeks.push(w);
  const protectedSpecific = new Set(allSpecificWeeks.slice(-SIM_WEEKS[experience]));
  // A Specific-phase deload is only allowed when the block has room for it AND a full
  // sim / ≥1 normal race-prep week to still survive (`SIM_WEEKS + 2` total Specific
  // weeks); short Specific blocks keep the prior accumulation-only deload behaviour.
  const specificDeloadOk = allSpecificWeeks.length >= SIM_WEEKS[experience] + 2;

  const isDeload = (w: number): boolean => {
    if (w <= 1) return false;
    const phase = phases[w - 1]!;
    if (phase === "taper") return false;
    if (w % DELOAD_EVERY !== 0) return false;
    // Deloads run on a 3:1/4:1 cadence through accumulation AND into the realization
    // (Specific) block (ADR 0069): concurrent endurance+strength fatigue is additive,
    // and best-practice HYROX programming keeps a recovery week roughly every 3rd–4th
    // week through the hard block — the taper is an ADDITIONAL terminal recovery, not a
    // substitute. The final half-sim sharpeners are protected; very short Specific
    // blocks stay accumulation-only so race-prep isn't collapsed.
    if (phase === "specific") return specificDeloadOk && !protectedSpecific.has(w);
    return true; // base / build
  };

  // Race simulations across the Specific block (ADR 0055 + 0068).
  //  • HALF (4+4) sharpeners: the last `SIM_WEEKS[level]` Specific weeks — race
  //    rehearsals at a manageable cost near the taper.
  //  • One FULL (8+8) rehearsal: the FIRST Specific week, but only when the block has
  //    ≥2 Specific weeks so the full sim is clear of race week (with weeks of recovery
  //    before the taper). The reviews flagged that the program never scheduled a full
  //    back-half rehearsal; this adds exactly one, early and well clear of the event.
  const specificWeeks: number[] = [];
  for (let w = 1; w <= weeks; w++) {
    if (phases[w - 1] === "specific" && !isDeload(w)) specificWeeks.push(w);
  }
  const halfSimWeekSet = new Set(specificWeeks.slice(-SIM_WEEKS[experience]));
  // Only add the full sim when, after reserving the last `SIM_WEEKS` weeks for half
  // sharpeners, ≥2 Specific weeks remain — so the full sim takes the first and ≥1
  // real (non-sim) race-prep week always survives (a program invariant).
  const fullSimWeek =
    specificWeeks.length >= SIM_WEEKS[experience] + 2 ? specificWeeks[0]! : -1;
  const simKindFor = (w: number): SimKind => {
    if (w === fullSimWeek) return "full";
    if (halfSimWeekSet.has(w)) return "half";
    return null;
  };

  // The RACE week is the final taper week (≤7 days out); earlier taper weeks are
  // "sharpen" (ADR 0055). Find the last taper week.
  let lastTaperWeek = -1;
  for (let w = 1; w <= weeks; w++) if (phases[w - 1] === "taper") lastTaperWeek = w;
  const taperKindFor = (w: number): TaperKind => {
    if (phases[w - 1] !== "taper") return null;
    return w === lastTaperWeek ? "race" : "sharpen";
  };

  // ADR 0059 — at a 5-session budget the Build phase can't fit a 2nd strength day
  // without dropping an endurance essential, so it alternates: hold a 2nd (split)
  // strength day by swapping that week's long run on every other Build week. Walk
  // the NON-DELOAD Build weeks in order and start with a double, so a fresh
  // post-deload Build re-accumulates strength first. Only fires at exactly 5
  // sessions (see buildWeekDays); the set is harmless at other budgets.
  const doubleStrengthWeeks = new Set<number>();
  let buildOrdinal = 0;
  for (let w = 1; w <= weeks; w++) {
    if (phases[w - 1] !== "build" || isDeload(w)) continue;
    if (buildOrdinal % 2 === 0) doubleStrengthWeeks.add(w);
    buildOrdinal += 1;
  }

  const plan: HyroxWeekPlan[] = [];
  for (let w = 1; w <= weeks; w++) {
    const phase = phases[w - 1]!;
    const deload = isDeload(w);
    const days = deload
      ? deloadWeekDays()
      : buildWeekDays(
          phase,
          sessionsPerWeek,
          simKindFor(w),
          experience,
          twoADay,
          w,
          taperKindFor(w),
          doubleStrengthWeeks.has(w),
        );
    plan.push({ week: w, phase, isDeload: deload, taperKind: taperKindFor(w), days });
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
