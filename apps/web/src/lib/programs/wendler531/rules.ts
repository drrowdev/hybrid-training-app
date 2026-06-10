/**
 * 5/3/1 — fundamental methodology rules (Wendler).
 *
 * This is the canonical "rules engine" for the 5/3/1 program family: the
 * Training-Max model, the weekly main-work schemes (classic 5/3/1 and 5's PRO),
 * the 7th-Week Protocol, the Leader/Anchor block structure, and TM progression.
 * It is PURE DATA + PURE FUNCTIONS — no DB, no React, no I/O — so the program
 * an athlete selects is reproduced EXACTLY as the methodology specifies.
 *
 * Source of truth: Jim Wendler, "5/3/1 Forever" (and the original "5/3/1").
 * Every constant is cited to the book. This module deliberately does NOT
 * synthesise or "improve" the program — fidelity to the published method is the
 * whole point. Supplemental templates (BBB / FSL / SSL / BBS), assistance
 * (push / pull / single-leg-core), and the hybrid/conditioning layer are
 * SEPARATE modules that compose on top of these rules.
 *
 * Units: kilograms, rounded to 2.5 kg (the metric analogue of Wendler's 5 lb
 * rounding). All working percentages are of the TRAINING MAX, never the 1RM.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Main lifts
// ─────────────────────────────────────────────────────────────────────────────

/** The four 5/3/1 main lifts. */
export type MainLift = "press" | "bench" | "squat" | "deadlift";

export const MAIN_LIFTS: readonly MainLift[] = [
  "press",
  "bench",
  "squat",
  "deadlift",
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Training Max
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The Training Max is a deliberately conservative fraction of the true/estimated
 * 1RM. "5/3/1 Forever" recommends 85% for most lifters; 90% is the classic
 * value from the original book. ALL working percentages are of THIS number.
 *   "The training max is usually 85-90% of your actual max or estimated max."
 *     — 5/3/1 Forever
 */
export const TM_PERCENT_OF_1RM = {
  /** Forever's default — leaves more rep headroom, "start too light". */
  conservative: 0.85,
  /** Original-book value. */
  standard: 0.9,
} as const;

export type TmPercentChoice = keyof typeof TM_PERCENT_OF_1RM;

/** Weight increment used for both rounding and TM bumps (kg). */
export const WEIGHT_INCREMENT_KG = 2.5; // metric analogue of Wendler's 5 lb step

/** Round a working weight to the loadable increment (default 2.5 kg). */
export function roundToIncrement(
  kg: number,
  increment: number = WEIGHT_INCREMENT_KG,
): number {
  if (increment <= 0) return kg;
  return Math.round(kg / increment) * increment;
}

/**
 * Derive a Training Max from a 1RM. Defaults to the Forever-recommended 85%.
 * Rounded DOWN to the increment — a conservative TM is a feature, never round up.
 */
export function trainingMaxFrom1RM(
  oneRmKg: number,
  choice: TmPercentChoice = "conservative",
  increment: number = WEIGHT_INCREMENT_KG,
): number {
  const raw = oneRmKg * TM_PERCENT_OF_1RM[choice];
  return increment > 0 ? Math.floor(raw / increment) * increment : raw;
}

/**
 * Per-CYCLE Training-Max increment (kg). Wendler: "+10 lb squat & deadlift,
 * +5 lb bench & press after a cycle" — the metric convention is +5 kg lower,
 * +2.5 kg upper.
 *   "After a cycle, you increase your training max for your squat and deadlift
 *    by ten pounds and your [press lifts by five pounds]." — 5/3/1
 */
export const TM_INCREMENT_KG: Record<MainLift, number> = {
  squat: 5,
  deadlift: 5,
  bench: 2.5,
  press: 2.5,
};

/** Advance a lift's Training Max by its per-cycle increment. */
export function nextTrainingMax(lift: MainLift, currentTmKg: number): number {
  return roundToIncrement(currentTmKg + TM_INCREMENT_KG[lift]);
}

/**
 * Reset rule. When a lifter stalls (misses the rep minimums / fails the TM
 * test), Wendler's prescription is to drop the TM ~10% and rebuild, NOT to grind
 * a too-heavy TM. "Start too light" is the recurring instruction.
 */
export const TM_RESET_FACTOR = 0.9;

export function resetTrainingMax(currentTmKg: number): number {
  return roundToIncrement(currentTmKg * TM_RESET_FACTOR);
}

// ─────────────────────────────────────────────────────────────────────────────
// Weekly main-work schemes
// ─────────────────────────────────────────────────────────────────────────────

/** One prescribed set of main work: a %TM, a rep target, and AMRAP flag. */
export type MainWorkSet = {
  /** Fraction of the Training Max. */
  pctOfTm: number;
  /** Target reps (the rep MINIMUM on an AMRAP/PR set). */
  reps: number;
  /**
   * True on a "+" / PR set — the last set is taken for as many quality reps as
   * possible (stop short of grindy failure). Classic 5/3/1 only; never on 5's PRO.
   */
  amrap: boolean;
};

/** A week of main work for one lift: three working sets after warm-ups. */
export type MainWorkWeek = {
  /** 1, 2, or 3 — the position within a 3-week cycle. */
  weekInCycle: 1 | 2 | 3;
  /** Short label (e.g. "5s", "3s", "5/3/1"). */
  label: string;
  sets: readonly MainWorkSet[];
};

/** The main-work style for a phase. */
export type MainWorkScheme = "classic" | "fives_pro";

/**
 * Classic 5/3/1 — the canonical three-week wave, top set is a PR/AMRAP set.
 *   Week 1: 65×5, 75×5, 85×5+
 *   Week 2: 70×3, 80×3, 90×3+
 *   Week 3: 75×5, 85×3, 95×1+
 * — 5/3/1 / 5/3/1 Forever.
 */
export const CLASSIC_531_WEEKS: readonly MainWorkWeek[] = [
  {
    weekInCycle: 1,
    label: "5s",
    sets: [
      { pctOfTm: 0.65, reps: 5, amrap: false },
      { pctOfTm: 0.75, reps: 5, amrap: false },
      { pctOfTm: 0.85, reps: 5, amrap: true },
    ],
  },
  {
    weekInCycle: 2,
    label: "3s",
    sets: [
      { pctOfTm: 0.7, reps: 3, amrap: false },
      { pctOfTm: 0.8, reps: 3, amrap: false },
      { pctOfTm: 0.9, reps: 3, amrap: true },
    ],
  },
  {
    weekInCycle: 3,
    label: "5/3/1",
    sets: [
      { pctOfTm: 0.75, reps: 5, amrap: false },
      { pctOfTm: 0.85, reps: 3, amrap: false },
      { pctOfTm: 0.95, reps: 1, amrap: true },
    ],
  },
] as const;

/**
 * 5's PRO — same week percentages as classic, but EVERY set is a straight 5
 * and there is NO AMRAP/PR set. Used in Leader phases to control fatigue and
 * make room for more supplemental + assistance (and, for a hybrid block,
 * conditioning).
 *   "5's PRO … do sets of 5 reps for every set; no PR sets." — 5/3/1 Forever.
 */
export const FIVES_PRO_WEEKS: readonly MainWorkWeek[] = CLASSIC_531_WEEKS.map(
  (w) => ({
    weekInCycle: w.weekInCycle,
    label: `${w.label} (5's PRO)`,
    sets: w.sets.map((s) => ({ pctOfTm: s.pctOfTm, reps: 5, amrap: false })),
  }),
);

/** Resolve the week templates for a main-work scheme. */
export function mainWorkWeeks(scheme: MainWorkScheme): readonly MainWorkWeek[] {
  return scheme === "fives_pro" ? FIVES_PRO_WEEKS : CLASSIC_531_WEEKS;
}

// ─────────────────────────────────────────────────────────────────────────────
// Materialisation — turn a scheme + TM into actual prescribed weights
// ─────────────────────────────────────────────────────────────────────────────

export type PrescribedSet = {
  pctOfTm: number;
  /** Loadable working weight (kg), rounded to the increment. */
  weightKg: number;
  reps: number;
  amrap: boolean;
};

/** Materialise one main-work week against a Training Max (rounded weights). */
export function materializeMainWork(
  tmKg: number,
  week: MainWorkWeek,
  increment: number = WEIGHT_INCREMENT_KG,
): PrescribedSet[] {
  return week.sets.map((s) => ({
    pctOfTm: s.pctOfTm,
    weightKg: roundToIncrement(tmKg * s.pctOfTm, increment),
    reps: s.reps,
    amrap: s.amrap,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// 7th Week Protocol
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The 7th-Week Protocol "is not done every seventh week; it's just a name." It
 * serves three functions — deload, TM test, or PR test — and is run BETWEEN
 * phases (a deload between Leader→Anchor; a TM/PR test before new programming).
 *   — 5/3/1 Forever.
 */
export type SeventhWeekMode = "deload" | "tm_test" | "pr_test";

/** A 7th-week set; the TM set may carry a rep RANGE (e.g. TM × 3–5). */
export type SeventhWeekSet = {
  pctOfTm: number;
  /** Rep target (minimum). */
  reps: number;
  /** Upper bound when the source prescribes a range (e.g. 80% × 3–5). */
  repsMax?: number;
  /** True for the TM (100%) set in a test, taken for the goal/PR. */
  isTmSet: boolean;
  amrap: boolean;
};

/**
 * The three 7th-week schemes, verbatim from 5/3/1 Forever:
 *   Deload : 70×5, 80×3–5, 90×1, 100(TM)×1   (work up to a single at the TM)
 *   TM Test: 70×5, 80×5,   90×5, 100(TM)×3–5 (must hit ≥3 to validate the TM)
 *   PR Test: 70×5, 80×5,   90×5, 100(TM)×PR  (AMRAP at the TM)
 */
export const SEVENTH_WEEK_SCHEMES: Record<SeventhWeekMode, readonly SeventhWeekSet[]> = {
  deload: [
    { pctOfTm: 0.7, reps: 5, isTmSet: false, amrap: false },
    { pctOfTm: 0.8, reps: 3, repsMax: 5, isTmSet: false, amrap: false },
    { pctOfTm: 0.9, reps: 1, isTmSet: false, amrap: false },
    { pctOfTm: 1.0, reps: 1, isTmSet: true, amrap: false },
  ],
  tm_test: [
    { pctOfTm: 0.7, reps: 5, isTmSet: false, amrap: false },
    { pctOfTm: 0.8, reps: 5, isTmSet: false, amrap: false },
    { pctOfTm: 0.9, reps: 5, isTmSet: false, amrap: false },
    { pctOfTm: 1.0, reps: 3, repsMax: 5, isTmSet: true, amrap: false },
  ],
  pr_test: [
    { pctOfTm: 0.7, reps: 5, isTmSet: false, amrap: false },
    { pctOfTm: 0.8, reps: 5, isTmSet: false, amrap: false },
    { pctOfTm: 0.9, reps: 5, isTmSet: false, amrap: false },
    { pctOfTm: 1.0, reps: 1, isTmSet: true, amrap: true },
  ],
};

/** Minimum reps that VALIDATE a Training Max on the 7th-week TM test. */
export const TM_TEST_MIN_REPS = 3;
/** At/above this many reps on the TM-test set, the TM is comfortably light. */
export const TM_TEST_STRONG_REPS = 5;

/**
 * Interpret a 7th-week TM-test result. Per the methodology: failing to hit the
 * minimum reps at the TM means the TM is too high and must come down; hitting
 * the top of the range comfortably means it can rise.
 */
export function evaluateTmTest(repsAtTm: number): "lower" | "hold" | "raise" {
  if (repsAtTm < TM_TEST_MIN_REPS) return "lower";
  if (repsAtTm >= TM_TEST_STRONG_REPS) return "raise";
  return "hold";
}

/** Materialise a 7th-week protocol against a Training Max. */
export function materializeSeventhWeek(
  tmKg: number,
  mode: SeventhWeekMode,
  increment: number = WEIGHT_INCREMENT_KG,
): Array<PrescribedSet & { isTmSet: boolean; repsMax?: number }> {
  return SEVENTH_WEEK_SCHEMES[mode].map((s) => ({
    pctOfTm: s.pctOfTm,
    weightKg: roundToIncrement(tmKg * s.pctOfTm, increment),
    reps: s.reps,
    repsMax: s.repsMax,
    amrap: s.amrap,
    isTmSet: s.isTmSet,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Block structure — Leader / Anchor / 7th-Week sequencing
// ─────────────────────────────────────────────────────────────────────────────

export type PhaseKind = "leader" | "anchor";

/**
 * A training phase: N three-week cycles of a given main-work scheme.
 * Wendler caps a phase at TWO cycles ("more than two cycles will burn you out").
 * Leaders typically run 5's PRO (volume control); Anchors run classic PR sets.
 */
export type ProgramPhase = {
  kind: PhaseKind;
  /** Number of 3-week cycles in this phase. Methodology max = 2. */
  cycles: 1 | 2;
  mainWork: MainWorkScheme;
};

/** A 7th-week unit inserted between phases. */
export type SeventhWeekUnit = { kind: "seventh_week"; mode: SeventhWeekMode };

export type ProgramSegment = ProgramPhase | SeventhWeekUnit;

/** Max cycles in a single phase before a mandated deload (Forever). */
export const MAX_CYCLES_PER_PHASE = 2;

/**
 * The recommended default arrangement — "2 Leaders / 1 Anchor … I recommend this
 * for just about everyone." A 7th-week DELOAD sits between Leader and Anchor; a
 * 7th-week TM TEST closes the sequence before the next programming.
 *   Leader (2 cycles, 5's PRO) → 7th-week Deload → Anchor (1 cycle, classic)
 *   → 7th-week TM Test
 */
export const DEFAULT_LEADER_ANCHOR_SEQUENCE: readonly ProgramSegment[] = [
  { kind: "leader", cycles: 2, mainWork: "fives_pro" },
  { kind: "seventh_week", mode: "deload" },
  { kind: "anchor", cycles: 1, mainWork: "classic" },
  { kind: "seventh_week", mode: "tm_test" },
] as const;

export function isSeventhWeek(seg: ProgramSegment): seg is SeventhWeekUnit {
  return (seg as SeventhWeekUnit).kind === "seventh_week";
}

/** A single expanded calendar week of a program sequence. */
export type ExpandedWeek =
  | {
      type: "main";
      /** 0-based absolute week index across the whole sequence. */
      weekIndex: number;
      phaseKind: PhaseKind;
      /** 1-based cycle number within its phase. */
      cycleInPhase: number;
      mainWork: MainWorkScheme;
      week: MainWorkWeek;
    }
  | {
      type: "seventh_week";
      weekIndex: number;
      mode: SeventhWeekMode;
    };

/**
 * Expand a program sequence into its ordered calendar weeks. A phase of C cycles
 * yields C×3 main weeks; a 7th-week unit yields a single week. This is the
 * canonical timeline a scheduler/UI renders.
 */
export function expandProgramSequence(
  sequence: readonly ProgramSegment[] = DEFAULT_LEADER_ANCHOR_SEQUENCE,
): ExpandedWeek[] {
  const out: ExpandedWeek[] = [];
  for (const seg of sequence) {
    if (isSeventhWeek(seg)) {
      out.push({ type: "seventh_week", weekIndex: out.length, mode: seg.mode });
      continue;
    }
    const weeks = mainWorkWeeks(seg.mainWork);
    for (let cycle = 1; cycle <= seg.cycles; cycle++) {
      for (const week of weeks) {
        out.push({
          type: "main",
          weekIndex: out.length,
          phaseKind: seg.kind,
          cycleInPhase: cycle,
          mainWork: seg.mainWork,
          week,
        });
      }
    }
  }
  return out;
}
