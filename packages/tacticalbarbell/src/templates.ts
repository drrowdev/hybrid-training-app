/**
 * Tactical Barbell — the verified template collection.
 *
 * Every percentage and set×rep scheme below is transcribed from the author's
 * official "Tactical Barbell Template Collection" spreadsheet (the canonical
 * source), cross-checked against TB1 (Tactical Barbell: Definitive Strength
 * Training for the Operational Athlete, 3rd ed.). The kg numbers in that
 * spreadsheet are derived from one lifter's personal maxes and are NOT encoded
 * here — only the methodology (sets×reps + % of 1RM waves) is.
 *
 * TB core principles captured:
 *   - Loads are a percentage of the TRUE 1RM (a Training Max is OPTIONAL — the
 *     program engine supports deriving working weights off a TM if requested).
 *   - Submaximal: work is never taken to failure; the prescribed set count is a
 *     range the lifter autoregulates within.
 *   - A "cluster" is the small set of main lifts the lifter rotates. Operator
 *     caps it at 3 main lifts (+ optional bodyweight 4th).
 *   - A block is 6 weeks (Grey Man: 12). Retest 1RMs every 6 or 12 weeks.
 */

/** A movement key — matches the platform's shared 1RM keys (squat/bench/…). */
export type TbMovement = string;

export const TB_MOVEMENT_LABEL: Record<string, string> = {
  squat: "Squat",
  bench: "Bench Press",
  deadlift: "Deadlift",
  press: "Overhead Press",
  pullup: "Weighted Pull-up",
};

/** A single week's set×rep scheme (shared across a template's session groups). */
export interface TbWeekScheme {
  /** Verbatim sets label (e.g. "3–5", "5", "4"). Source of truth for display. */
  setsLabel: string;
  /** Minimum prescribed working sets (the engine prescribes this many). */
  setsMin: number;
  /** Maximum prescribed working sets (autoregulation ceiling). */
  setsMax: number;
  /** Verbatim reps label (e.g. "5", "3", "1–2", "3-2-1"). */
  repsLabel: string;
  /** Representative numeric reps (the leading/target number) for volume math. */
  reps: number;
}

/** A per-week percentage-of-1RM wave. One template may have several (Zulu). */
export interface TbPercentWave {
  id: string;
  label: string;
  /** Fraction of 1RM per week; length === blockWeeks. */
  percents: number[];
}

/** One recurring weekly training session within the block. */
export interface TbWeeklySession {
  id: string;
  label: string;
  /** Which percentage wave this session loads off. */
  waveId: string;
  /** Zulu only: the split letter whose lifts are trained this session. */
  split?: "A" | "B";
}

export type TbStructure = "cluster" | "split";

export interface TbTemplate {
  id: string;
  name: string;
  /** "cluster" = every session trains all cluster lifts at the same %; "split" = Zulu A/B. */
  structure: TbStructure;
  summary: string;
  /** Block length in weeks (6 for most, 12 for Grey Man). */
  blockWeeks: number;
  /** Per-week sets×reps schemes; length === blockWeeks. */
  setsReps: TbWeekScheme[];
  /** Percentage waves; length 1 for cluster templates, 2 for Zulu. */
  waves: TbPercentWave[];
  /** The recurring weekly sessions (length === sessions per week). */
  weeklySessions: TbWeeklySession[];
  /** Hard cap on main lifts (Operator = 3). Undefined = no fixed cap. */
  maxMainLifts?: number;
  /** Default cluster (movement keys); for "split" each lift carries a split letter. */
  defaultCluster: { movement: TbMovement; split?: "A" | "B" }[];
  notes: string[];
}

// ── shared sets×rep helpers ──────────────────────────────────────────────────
const w = (
  setsLabel: string,
  setsMin: number,
  setsMax: number,
  repsLabel: string,
  reps: number,
): TbWeekScheme => ({ setsLabel, setsMin, setsMax, repsLabel, reps });

const CLUSTER_DEFAULT: { movement: TbMovement }[] = [
  { movement: "squat" },
  { movement: "bench" },
  { movement: "deadlift" },
];

// ── Operator — 3 lifts, 3×/week, every other day ─────────────────────────────
const OPERATOR: TbTemplate = {
  id: "operator",
  name: "Operator",
  structure: "cluster",
  summary: "TB's flagship low-frequency strength template: ≤3 main lifts, each trained 3× per week, every other day.",
  blockWeeks: 6,
  setsReps: [
    w("3–5", 3, 5, "5", 5),
    w("3–5", 3, 5, "5", 5),
    w("3–4", 3, 4, "3", 3),
    w("3–5", 3, 5, "5", 5),
    w("3–5", 3, 5, "3", 3),
    w("3–4", 3, 4, "1–2", 2),
  ],
  waves: [{ id: "main", label: "Main", percents: [0.7, 0.8, 0.9, 0.75, 0.85, 0.95] }],
  weeklySessions: [
    { id: "s1", label: "Session 1", waveId: "main" },
    { id: "s2", label: "Session 2", waveId: "main" },
    { id: "s3", label: "Session 3", waveId: "main" },
  ],
  maxMainLifts: 3,
  defaultCluster: CLUSTER_DEFAULT,
  notes: [
    "Train every other day, 3 times per week.",
    "Use no more than 3 main lifts (an optional 4th bodyweight movement is acceptable).",
    "Submaximal — never to failure. Autoregulate within the set range.",
    "Retest your 1RMs every 6 or 12 weeks.",
  ],
};

// ── Fighter — 2×/week ────────────────────────────────────────────────────────
const FIGHTER: TbTemplate = {
  id: "fighter",
  name: "Fighter",
  structure: "cluster",
  summary: "A 2×/week strength minimum, built to coexist with heavy conditioning or sport practice.",
  blockWeeks: 6,
  setsReps: [
    w("3–5", 3, 5, "5", 5),
    w("3–5", 3, 5, "5", 5),
    w("3–5", 3, 5, "3", 3),
    w("3–5", 3, 5, "5", 5),
    w("3–5", 3, 5, "5", 5),
    w("3–5", 3, 5, "3", 3),
  ],
  waves: [{ id: "main", label: "Main", percents: [0.75, 0.8, 0.9, 0.75, 0.8, 0.9] }],
  weeklySessions: [
    { id: "s1", label: "Session 1", waveId: "main" },
    { id: "s2", label: "Session 2", waveId: "main" },
  ],
  defaultCluster: CLUSTER_DEFAULT,
  notes: [
    "Lift 2 days a week, spread as evenly as possible.",
    "Do not lift on back-to-back days.",
    "Submaximal — never to failure.",
    "Retest your 1RMs every 6 or 12 weeks.",
  ],
};

// ── Gladiator — 3×/week, 5×5 high volume ─────────────────────────────────────
const GLADIATOR: TbTemplate = {
  id: "gladiator",
  name: "Gladiator",
  structure: "cluster",
  summary: "Higher-volume 5×5 strength template for 3×/week training when conditioning load is low.",
  blockWeeks: 6,
  setsReps: [
    w("5", 5, 5, "5", 5),
    w("5", 5, 5, "5", 5),
    w("5", 5, 5, "3", 3),
    w("5", 5, 5, "5", 5),
    w("5", 5, 5, "5", 5),
    w("5", 5, 5, "3-2-1", 3),
  ],
  waves: [{ id: "main", label: "Main", percents: [0.7, 0.8, 0.9, 0.75, 0.85, 0.95] }],
  weeklySessions: [
    { id: "s1", label: "Session 1", waveId: "main" },
    { id: "s2", label: "Session 2", waveId: "main" },
    { id: "s3", label: "Session 3", waveId: "main" },
  ],
  defaultCluster: CLUSTER_DEFAULT,
  notes: [
    "Lift 3 times per week.",
    "Submaximal — never to failure.",
    "Retest your 1RMs every 6 or 12 weeks.",
  ],
};

// ── Mass — 3×/week, hypertrophy bias ─────────────────────────────────────────
const MASS: TbTemplate = {
  id: "mass",
  name: "Mass",
  structure: "cluster",
  summary: "Hypertrophy-leaning TB template using higher reps (4×6→4×3) to add size while staying strength-led.",
  blockWeeks: 6,
  setsReps: [
    w("4", 4, 4, "6", 6),
    w("4", 4, 4, "5", 5),
    w("4", 4, 4, "3", 3),
    w("4", 4, 4, "6", 6),
    w("4", 4, 4, "4", 4),
    w("4", 4, 4, "3", 3),
  ],
  waves: [{ id: "main", label: "Main", percents: [0.75, 0.8, 0.9, 0.75, 0.85, 0.9] }],
  weeklySessions: [
    { id: "s1", label: "Session 1", waveId: "main" },
    { id: "s2", label: "Session 2", waveId: "main" },
    { id: "s3", label: "Session 3", waveId: "main" },
  ],
  defaultCluster: CLUSTER_DEFAULT,
  notes: [
    "Lift 3 times per week.",
    "No rest minimums — keep rest short to drive hypertrophy.",
    "Submaximal — never to failure.",
    "Retest your 1RMs every 6 or 12 weeks.",
  ],
};

// ── Grey Man — 3×/week, 12-week block ────────────────────────────────────────
const GREY_MAN: TbTemplate = {
  id: "grey-man",
  name: "Grey Man",
  structure: "cluster",
  summary: "A 12-week generalist block that double-waves volume then intensity for balanced, sustainable progress.",
  blockWeeks: 12,
  setsReps: [
    w("3", 3, 3, "6", 6),
    w("3", 3, 3, "5", 5),
    w("3", 3, 3, "3", 3),
    w("3", 3, 3, "6", 6),
    w("3", 3, 3, "5", 5),
    w("3", 3, 3, "3", 3),
    w("3", 3, 3, "6", 6),
    w("3", 3, 3, "5", 5),
    w("3", 3, 3, "1", 1),
    w("3", 3, 3, "6", 6),
    w("3", 3, 3, "5", 5),
    w("3", 3, 3, "1", 1),
  ],
  waves: [
    {
      id: "main",
      label: "Main",
      percents: [0.7, 0.8, 0.9, 0.7, 0.8, 0.9, 0.75, 0.85, 0.95, 0.75, 0.85, 0.95],
    },
  ],
  weeklySessions: [
    { id: "s1", label: "Session 1", waveId: "main" },
    { id: "s2", label: "Session 2", waveId: "main" },
    { id: "s3", label: "Session 3", waveId: "main" },
  ],
  defaultCluster: CLUSTER_DEFAULT,
  notes: [
    "Lift 3 times per week.",
    "Submaximal — never to failure.",
    "Retest your 1RMs at the end of the 12-week block.",
  ],
};

// ── Zulu (Standard) — 4 lifts, A/B split, each lift 2×/week ──────────────────
const ZULU: TbTemplate = {
  id: "zulu",
  name: "Zulu",
  structure: "split",
  summary: "A 4-lift A/B split run twice through the week, with a slightly heavier second pass. Strength with more lifts than Operator.",
  blockWeeks: 6,
  setsReps: [
    w("3", 3, 3, "5", 5),
    w("3", 3, 3, "5", 5),
    w("3", 3, 3, "3", 3),
    w("3", 3, 3, "5", 5),
    w("3", 3, 3, "5", 5),
    w("3", 3, 3, "3", 3),
  ],
  waves: [
    { id: "one", label: "Pass 1", percents: [0.7, 0.8, 0.9, 0.7, 0.8, 0.9] },
    { id: "two", label: "Pass 2", percents: [0.75, 0.8, 0.9, 0.75, 0.8, 0.9] },
  ],
  weeklySessions: [
    { id: "p1a", label: "Session A (Pass 1)", waveId: "one", split: "A" },
    { id: "p1b", label: "Session B (Pass 1)", waveId: "one", split: "B" },
    { id: "p2a", label: "Session A (Pass 2)", waveId: "two", split: "A" },
    { id: "p2b", label: "Session B (Pass 2)", waveId: "two", split: "B" },
  ],
  defaultCluster: [
    { movement: "squat", split: "A" },
    { movement: "press", split: "A" },
    { movement: "bench", split: "B" },
    { movement: "deadlift", split: "B" },
  ],
  notes: [
    "Complete all 4 sessions within 7 days.",
    "At least one day of rest between sessions; never train on back-to-back days.",
    "The second pass (Pass 2) opens slightly heavier than the first.",
    "Submaximal — never to failure.",
    "Retest your 1RMs every 6 or 12 weeks.",
  ],
};

export const TB_TEMPLATES: TbTemplate[] = [
  OPERATOR,
  FIGHTER,
  ZULU,
  GLADIATOR,
  MASS,
  GREY_MAN,
];

export function getTbTemplate(id: string): TbTemplate | undefined {
  return TB_TEMPLATES.find((t) => t.id === id);
}
