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
  "overhead-press": "Overhead Press",
  pullup: "Weighted Pull-up",
  "weighted-pullup": "Weighted Pull-up",
  "barbell-row": "Barbell Row",
  "pendlay-row": "Pendlay Row",
  "rack-pull": "Rack Pull",
  "goblet-squat": "Goblet Squat",
  "inverted-row": "Inverted Row",
  pushup: "Push-up",
  "plyo-pushup": "Plyometric Push-up",
  "jump-squat": "Jump Squat",
  "power-clean": "Power Clean",
  "push-press": "Push Press",
  "back-extension": "Back Extension",
  "ab-triad": "Ab Triad",
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
  /** Upper bound when the week uses a rep range (e.g. Zulu 5–8). */
  repsMax?: number;
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
  /** 1-based weeks in which this session exists. Omitted = every week. */
  activeWeeks?: number[];
  /** Calendar hint (0 = Monday); the shared schedule may still override it. */
  weekday?: number;
  /** Test/peak sessions materialise with the corresponding platform role. */
  kind?: "training" | "deload" | "test" | "rest";
  /** Week-specific role override (e.g. Activation's explicit week-15 deload). */
  kindByWeek?: Record<number, "training" | "deload" | "test" | "rest">;
  /** Fixed session loadout. When present, the user's general cluster is ignored. */
  fixedMovements?: TbClusterEntry[];
  /** Remove selected cluster movements for this session (TB3 day variants). */
  excludeMovements?: TbMovement[];
  /** Add a movement even when it is not part of the selected cluster. */
  includeMovements?: TbClusterEntry[];
  /** Movement(s) tested at 100%; all other lifts use support work. */
  peakMovements?: TbMovement[];
  /** Support prescription on a peak day. */
  support?: { percent: number; sets: number; reps: number };
  /** Per-movement set-range override (e.g. deadlift 1–3 sets). */
  movementSetRanges?: Record<string, { min: number; max: number }>;
  /** Ordered week/movement overrides for multi-phase templates such as Activation. */
  prescriptionRules?: TbPrescriptionRule[];
}

export interface TbPrescriptionRule {
  activeWeeks?: number[];
  movements?: TbMovement[];
  percent?: number | null;
  setsMin?: number;
  setsMax?: number;
  reps?: number;
  repsMax?: number;
  repsLabel?: string;
  itemKind?: "main" | "supplemental" | "assistance";
  warmup?: boolean;
  note?: string;
}

export type TbStructure = "cluster" | "split";

/**
 * How a cluster lift is loaded/anchored:
 *   - "barbell"     · a kg 1RM (squat, bench, deadlift, press, weighted carries…).
 *   - "weighted-bw" · a weighted bodyweight movement anchored on a kg 1RM that
 *     INCLUDES bodyweight (e.g. weighted pull-ups — GP/TB1).
 *   - "bodyweight"  · a pure bodyweight movement anchored on MAX CLEAN REPS;
 *     prescribed as a % of that max-reps number, not a weight.
 */
export type TbLiftKind = "barbell" | "weighted-bw" | "bodyweight" | "unanchored";

/** A cluster lift with its loading kind and (for split templates) its A/B group. */
export interface TbClusterEntry {
  movement: TbMovement;
  split?: "A" | "B";
  kind?: TbLiftKind;
}

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
  /** Loading retained for composite engines that delegate to TB. */
  delegatedSetsReps?: TbWeekScheme[];
  delegatedWaves?: TbPercentWave[];
  /** The recurring weekly sessions (length === sessions per week). */
  weeklySessions: TbWeeklySession[];
  /** Minimum number of COUNTING main lifts (TB1 cluster taxonomy). */
  clusterMin: number;
  /** Maximum number of COUNTING main lifts. */
  clusterMax: number;
  /**
   * Operator-only: a single bodyweight movement (e.g. pull-ups) may be added as
   * an optional extra that does NOT count toward clusterMax (TB1 / xlsx note).
   */
  allowsBodyweightFourth?: boolean;
  /** @deprecated use clusterMax. Kept as an alias for the Operator cap. */
  maxMainLifts?: number;
  /** Default cluster (movement keys); for "split" each lift carries a split letter. */
  defaultCluster: TbClusterEntry[];
  /** Named phase boundaries for long multi-phase templates. */
  segments?: Array<{
    startWeekIndex: number;
    label: string;
    kind?: "phase" | "block" | "deload" | "test";
  }>;
  /** The template owns every movement and weekday; the picker only previews them. */
  fixedLoadout?: boolean;
  fixedSchedule?: boolean;
  /** Additional percentage-loaded movements the picker must offer benchmarks for. */
  requiredBenchmarkKeys?: string[];
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

const TB3_WORK_WEEKS = [1, 2, 3, 4, 5];
const TB3_SET_RANGE = [
  w("3–5", 3, 5, "5", 5),
  w("3–5", 3, 5, "5", 5),
  w("3–5", 3, 5, "3", 3),
  w("3–5", 3, 5, "5", 5),
  w("3–5", 3, 5, "5", 5),
  w("1", 1, 1, "1", 1),
];
const DEADLIFT_RANGE = { deadlift: { min: 1, max: 3 } };
const PEAK_SUPPORT = { percent: 0.8, sets: 3, reps: 5 };
const WEIGHTED_PULLUP: TbClusterEntry = {
  movement: "weighted-pullup",
  kind: "weighted-bw",
};

const CLUSTER_DEFAULT: TbClusterEntry[] = [
  { movement: "squat" },
  { movement: "bench" },
  { movement: "deadlift" },
];

// Gladiator only allows a minimalist (exactly-two-lift) cluster (TB1 L1271).
const GLADIATOR_DEFAULT: TbClusterEntry[] = [
  { movement: "deadlift" },
  { movement: "bench" },
];

// ── Operator — 3 lifts, 3×/week, every other day ─────────────────────────────
const OPERATOR: TbTemplate = {
  id: "operator",
  name: "Operator",
  structure: "cluster",
  summary: "TB's flagship low-frequency strength template: ≤3 main lifts, each trained 3× per week, every other day.",
  blockWeeks: 6,
  setsReps: TB3_SET_RANGE,
  waves: [{ id: "main", label: "Main", percents: [0.75, 0.8, 0.85, 0.75, 0.8, 1] }],
  delegatedSetsReps: [
    w("3–5", 3, 5, "5", 5),
    w("3–5", 3, 5, "5", 5),
    w("3–4", 3, 4, "3", 3),
    w("3–5", 3, 5, "5", 5),
    w("3–5", 3, 5, "3", 3),
    w("3–4", 3, 4, "1–2", 2),
  ],
  delegatedWaves: [
    { id: "main", label: "Main", percents: [0.7, 0.8, 0.9, 0.75, 0.85, 0.95] },
  ],
  weeklySessions: [
    {
      id: "s1",
      label: "Day 1",
      waveId: "main",
      activeWeeks: TB3_WORK_WEEKS,
      fixedMovements: [{ movement: "bench" }, { movement: "squat" }, WEIGHTED_PULLUP],
    },
    {
      id: "s2",
      label: "Day 3",
      waveId: "main",
      activeWeeks: TB3_WORK_WEEKS,
      fixedMovements: [{ movement: "bench" }, { movement: "squat" }, WEIGHTED_PULLUP],
    },
    {
      id: "s3",
      label: "Day 5",
      waveId: "main",
      activeWeeks: TB3_WORK_WEEKS,
      fixedMovements: [{ movement: "bench" }, { movement: "deadlift" }, WEIGHTED_PULLUP],
      movementSetRanges: DEADLIFT_RANGE,
    },
    {
      id: "peak-squat",
      label: "Peak · Squat",
      waveId: "main",
      activeWeeks: [6],
      kind: "test",
      fixedMovements: [{ movement: "squat" }, { movement: "bench" }, WEIGHTED_PULLUP],
      peakMovements: ["squat"],
      support: PEAK_SUPPORT,
    },
    {
      id: "peak-bench",
      label: "Peak · Bench",
      waveId: "main",
      activeWeeks: [6],
      kind: "test",
      fixedMovements: [{ movement: "bench" }, { movement: "squat" }, WEIGHTED_PULLUP],
      peakMovements: ["bench"],
      support: PEAK_SUPPORT,
    },
    {
      id: "peak-deadlift",
      label: "Peak · Deadlift",
      waveId: "main",
      activeWeeks: [6],
      kind: "test",
      fixedMovements: [{ movement: "deadlift" }, { movement: "bench" }, WEIGHTED_PULLUP],
      peakMovements: ["deadlift"],
      support: PEAK_SUPPORT,
    },
  ],
  maxMainLifts: 3,
  clusterMin: 2,
  clusterMax: 3,
  allowsBodyweightFourth: true,
  defaultCluster: [{ movement: "bench" }, { movement: "squat" }, WEIGHTED_PULLUP],
  fixedLoadout: true,
  requiredBenchmarkKeys: ["deadlift"],
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
  setsReps: TB3_SET_RANGE,
  waves: [{ id: "main", label: "Main", percents: [0.75, 0.8, 0.85, 0.75, 0.8, 1] }],
  delegatedSetsReps: [
    w("3–5", 3, 5, "5", 5),
    w("3–5", 3, 5, "5", 5),
    w("3–5", 3, 5, "3", 3),
    w("3–5", 3, 5, "5", 5),
    w("3–5", 3, 5, "5", 5),
    w("3–5", 3, 5, "3", 3),
  ],
  delegatedWaves: [
    { id: "main", label: "Main", percents: [0.75, 0.8, 0.9, 0.75, 0.8, 0.9] },
  ],
  weeklySessions: [
    {
      id: "s1",
      label: "Day 1",
      waveId: "main",
      activeWeeks: TB3_WORK_WEEKS,
      fixedMovements: [{ movement: "bench" }, { movement: "squat" }, { movement: "deadlift" }],
      movementSetRanges: DEADLIFT_RANGE,
    },
    {
      id: "s2",
      label: "Day 4",
      waveId: "main",
      activeWeeks: TB3_WORK_WEEKS,
      fixedMovements: [{ movement: "bench" }, { movement: "squat" }, { movement: "deadlift" }],
      movementSetRanges: DEADLIFT_RANGE,
    },
    {
      id: "peak-squat",
      label: "Peak · Squat",
      waveId: "main",
      activeWeeks: [6],
      kind: "test",
      fixedMovements: [{ movement: "squat" }, { movement: "bench" }, { movement: "deadlift" }],
      peakMovements: ["squat"],
      support: PEAK_SUPPORT,
    },
    {
      id: "peak-bench-deadlift",
      label: "Peak · Bench + Deadlift",
      waveId: "main",
      activeWeeks: [6],
      kind: "test",
      fixedMovements: [{ movement: "bench" }, { movement: "deadlift" }, { movement: "squat" }],
      peakMovements: ["bench", "deadlift"],
      support: PEAK_SUPPORT,
    },
  ],
  defaultCluster: CLUSTER_DEFAULT,
  clusterMin: 2,
  clusterMax: 3,
  fixedLoadout: true,
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
  defaultCluster: GLADIATOR_DEFAULT,
  clusterMin: 2,
  clusterMax: 2,
  notes: [
    "Lift 3 times per week.",
    "Use exactly 2 main lifts — Gladiator only allows a minimalist cluster.",
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
  clusterMin: 3,
  clusterMax: 3,
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
  clusterMin: 3,
  clusterMax: 3,
  notes: [
    "Lift 3 times per week.",
    "Submaximal — never to failure.",
    "Retest your 1RMs at the end of the 12-week block.",
  ],
};

const zuluSupplementalRules = (movements: string[]): TbPrescriptionRule[] =>
  [0.65, 0.7, 0.75, 0.65, 0.7].map((percent, index) => ({
    activeWeeks: [index + 1],
    movements,
    percent,
    setsMin: 3,
    setsMax: 5,
    reps: 8,
    repsMax: 10,
    repsLabel: "8–10",
    itemKind: "supplemental",
    note: "Supplemental — 3–5 sets of 8–10.",
  }));

const ZULU_A: TbClusterEntry[] = [
  { movement: "bench", split: "A" },
  { movement: "squat", split: "A" },
  { movement: "overhead-press", split: "A" },
  { movement: "ab-triad", split: "A", kind: "unanchored" },
];
const ZULU_B: TbClusterEntry[] = [
  { movement: "deadlift", split: "B" },
  { ...WEIGHTED_PULLUP, split: "B" },
  { movement: "barbell-row", split: "B" },
  { movement: "back-extension", split: "B", kind: "unanchored" },
];
// ── Zulu (TB3) — prescriptive A/B split with supplemental work ───────────────
const ZULU: TbTemplate = {
  id: "zulu",
  name: "Zulu",
  structure: "split",
  summary: "A 4-lift A/B split run twice through the week, with a slightly heavier second pass. Strength with more lifts than Operator.",
  blockWeeks: 6,
  setsReps: [
    { ...w("3–5", 3, 5, "5–8", 5), repsMax: 8 },
    w("3–5", 3, 5, "5", 5),
    w("3–5", 3, 5, "3", 3),
    { ...w("3–5", 3, 5, "5–8", 5), repsMax: 8 },
    w("3–5", 3, 5, "5", 5),
    w("1", 1, 1, "1", 1),
  ],
  waves: [
    { id: "one", label: "Pass 1", percents: [0.7, 0.8, 0.85, 0.7, 0.8, 1] },
    { id: "two", label: "Pass 2", percents: [0.75, 0.8, 0.85, 0.75, 0.8, 1] },
  ],
  weeklySessions: [
    {
      id: "p1a",
      label: "Day 1 · A",
      waveId: "one",
      split: "A",
      activeWeeks: TB3_WORK_WEEKS,
      fixedMovements: ZULU_A,
      prescriptionRules: zuluSupplementalRules(["overhead-press", "ab-triad"]),
    },
    {
      id: "p1b",
      label: "Day 2 · B",
      waveId: "one",
      split: "B",
      activeWeeks: TB3_WORK_WEEKS,
      fixedMovements: ZULU_B,
      movementSetRanges: DEADLIFT_RANGE,
      prescriptionRules: zuluSupplementalRules(["barbell-row", "back-extension"]),
    },
    {
      id: "p2a",
      label: "Day 4 · A",
      waveId: "two",
      split: "A",
      activeWeeks: TB3_WORK_WEEKS,
      fixedMovements: ZULU_A,
      prescriptionRules: zuluSupplementalRules(["overhead-press", "ab-triad"]),
    },
    {
      id: "p2b",
      label: "Day 5 · B",
      waveId: "two",
      split: "B",
      activeWeeks: TB3_WORK_WEEKS,
      fixedMovements: ZULU_B,
      movementSetRanges: DEADLIFT_RANGE,
      prescriptionRules: zuluSupplementalRules(["barbell-row", "back-extension"]),
    },
    {
      id: "peak-a1",
      label: "Peak · Squat",
      waveId: "one",
      activeWeeks: [6],
      kind: "test",
      fixedMovements: [{ movement: "squat" }, { movement: "bench" }],
      peakMovements: ["squat"],
      support: PEAK_SUPPORT,
    },
    {
      id: "peak-b1",
      label: "Peak · Pull-up",
      waveId: "one",
      activeWeeks: [6],
      kind: "test",
      fixedMovements: [WEIGHTED_PULLUP, { movement: "deadlift" }],
      peakMovements: ["weighted-pullup"],
      support: PEAK_SUPPORT,
    },
    {
      id: "peak-a2",
      label: "Peak · Bench",
      waveId: "two",
      activeWeeks: [6],
      kind: "test",
      fixedMovements: [{ movement: "bench" }, { movement: "squat" }],
      peakMovements: ["bench"],
      support: PEAK_SUPPORT,
    },
    {
      id: "peak-b2",
      label: "Peak · Deadlift",
      waveId: "two",
      activeWeeks: [6],
      kind: "test",
      fixedMovements: [{ movement: "deadlift" }, WEIGHTED_PULLUP],
      peakMovements: ["deadlift"],
      support: PEAK_SUPPORT,
    },
  ],
  defaultCluster: [
    { movement: "bench", split: "A" },
    { movement: "squat", split: "A" },
    { movement: "deadlift", split: "B" },
    { ...WEIGHTED_PULLUP, split: "B" },
  ],
  clusterMin: 4,
  clusterMax: 8,
  fixedLoadout: true,
  requiredBenchmarkKeys: ["overhead-press", "barbell-row"],
  notes: [
    "Complete all 4 sessions within 7 days.",
    "At least one day of rest between sessions; never train on back-to-back days.",
    "The second pass (Pass 2) opens slightly heavier than the first.",
    "Submaximal — never to failure.",
    "Retest your 1RMs every 6 or 12 weeks.",
  ],
};

// ── Zulu I/A — intermediate/advanced: 3–5 sets, heavier back-half ────────────
// Same A/B split structure as Zulu Standard, but autoregulated set ranges
// (3–5 per lift) and heavier loads in weeks 4–6 (0.75/0.85/0.95 on both passes),
// peaking at 1–2 reps. Source: TB1 "Zulu I/A" table + the Template Collection
// xlsx (Zulu sheet, I/A branch of the Standard/I/A selector formulas).
const ZULU_IA: TbTemplate = {
  id: "zulu-ia",
  name: "Zulu I/A",
  structure: "split",
  summary: "The intermediate/advanced Zulu: the same A/B split, but you autoregulate 3–5 sets per lift and load heavier through the back half, peaking at 1–2 reps.",
  blockWeeks: 6,
  setsReps: [
    w("3–5", 3, 5, "5", 5),
    w("3–5", 3, 5, "5", 5),
    w("3–5", 3, 5, "3", 3),
    w("3–5", 3, 5, "5", 5),
    w("3–5", 3, 5, "3", 3),
    w("3–5", 3, 5, "1–2", 2),
  ],
  waves: [
    { id: "one", label: "Pass 1", percents: [0.7, 0.8, 0.9, 0.75, 0.85, 0.95] },
    { id: "two", label: "Pass 2", percents: [0.7, 0.8, 0.9, 0.75, 0.85, 0.95] },
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
  clusterMin: 4,
  clusterMax: 8,
  notes: [
    "For intermediate/advanced lifters who want to autoregulate volume.",
    "Choose 3–5 sets per lift: fewer when conditioning is hard the next day, more (4–5) when chasing hypertrophy.",
    "Both passes load the same; weeks 4–6 are heavier than Standard.",
    "Complete all 4 sessions within 7 days; one rest day, never back-to-back.",
    "Submaximal — never to failure. Retest your 1RMs every 6 or 12 weeks.",
  ],
};

// ── Activation — 25-week TB3 on-ramp ────────────────────────────────────────

const A = {
  pushup: { movement: "pushup", kind: "unanchored" },
  gobletSquat: { movement: "goblet-squat", kind: "unanchored" },
  invertedRow: { movement: "inverted-row", kind: "unanchored" },
  abTriad: { movement: "ab-triad", kind: "unanchored" },
  squat: { movement: "squat" },
  bench: { movement: "bench" },
  deadlift: { movement: "deadlift" },
  press: { movement: "overhead-press" },
  pullup: { movement: "weighted-pullup", kind: "weighted-bw" },
  barbellRow: { movement: "barbell-row" },
  pendlayRow: { movement: "pendlay-row" },
  rackPull: { movement: "rack-pull" },
  backExtension: { movement: "back-extension", kind: "unanchored" },
  powerClean: { movement: "power-clean" },
  pushPress: { movement: "push-press" },
  jumpSquat: { movement: "jump-squat", kind: "unanchored" },
  plyoPushup: { movement: "plyo-pushup", kind: "unanchored" },
} satisfies Record<string, TbClusterEntry>;

const ACTIVATION_BASE_WEEKS = [1, 2, 3, 4];
const ACTIVATION_ARMOR_WEEKS = [6, 7, 8];
const ACTIVATION_OPERATOR_WEEKS = [9, 10, 11, 12, 13, 15, 16, 17, 18, 19];
const ACTIVATION_PEAK_WEEKS = [14, 20];
const ACTIVATION_VERTEX_WEEKS = [22, 23, 24];

const abRule: TbPrescriptionRule = {
  movements: ["ab-triad"],
  percent: null,
  setsMin: 3,
  setsMax: 3,
  reps: 5,
  repsLabel: "5",
  itemKind: "assistance",
  warmup: false,
  note: "Finisher — three rounds of five, outside the circuit.",
};

const ARMOR_SUPPLEMENTAL_WAVES: Array<[number, number]> = [
  [6, 0.65],
  [7, 0.7],
  [8, 0.75],
];

const supplementalRules = (movements: string[]): TbPrescriptionRule[] =>
  ARMOR_SUPPLEMENTAL_WAVES.map(([week, percent]) => ({
    activeWeeks: [week],
    movements,
    percent,
    setsMin: 3,
    setsMax: 5,
    reps: 8,
    repsMax: 10,
    repsLabel: "8–10",
    itemKind: "supplemental",
    note: "Supplemental — 3–5 sets of 8–10.",
  }));

const taperRules = (movement: string): TbPrescriptionRule[] =>
  [3, 2, 1].map((sets, index) => ({
    activeWeeks: [6 + index],
    movements: [movement],
    setsMin: sets,
    setsMax: sets,
    note: `${movement === "deadlift" ? "Deadlift" : "Rack pull"} volume tapers across the block.`,
  }));

const armorSecondPassRules: TbPrescriptionRule[] = [
  { activeWeeks: [6], percent: 0.75, setsMin: 3, setsMax: 3 },
  { activeWeeks: [7, 8], setsMin: 3, setsMax: 3 },
];

const operatorRules: TbPrescriptionRule[] = [
  {
    activeWeeks: ACTIVATION_OPERATOR_WEEKS,
    movements: ["deadlift"],
    setsMin: 1,
    setsMax: 3,
    note: "Deadlift: 1–3 work sets.",
  },
  abRule,
];

const vertexRules = (
  primers: string[],
  explosives: string[],
  pendlay = false,
): TbPrescriptionRule[] => {
  const out: TbPrescriptionRule[] = [];
  for (const [index, week] of ACTIVATION_VERTEX_WEEKS.entries()) {
    const sets = index + 3;
    const explosiveReps = 5 - index;
    out.push({
      activeWeeks: [week],
      movements: primers,
      percent: 0.85,
      setsMin: sets,
      setsMax: sets,
      reps: 1,
      repsLabel: "1",
      note: "Primer — one heavy single immediately before the explosive set.",
    });
    out.push({
      activeWeeks: [week],
      movements: explosives,
      percent: null,
      setsMin: sets,
      setsMax: sets,
      reps: explosiveReps,
      repsLabel: String(explosiveReps),
      itemKind: "assistance",
      warmup: false,
      note: "Explosive — maximum speed, stop well short of failure.",
    });
    if (pendlay) {
      out.push({
        activeWeeks: [week],
        movements: ["pendlay-row"],
        percent: 0.65,
        setsMin: sets,
        setsMax: sets,
        reps: explosiveReps,
        repsLabel: String(explosiveReps),
        note: "Explosive — maximum bar speed.",
      });
    }
  }
  return out;
};

const activationSession = (
  id: string,
  label: string,
  weekday: number,
  activeWeeks: number[],
  fixedMovements: TbClusterEntry[],
  prescriptionRules: TbPrescriptionRule[] = [],
  extra: Partial<TbWeeklySession> = {},
): TbWeeklySession => ({
  id,
  label,
  waveId: "main",
  weekday,
  activeWeeks,
  fixedMovements,
  prescriptionRules,
  ...extra,
});

const ACTIVATION: TbTemplate = {
  id: "activation",
  name: "Activation",
  structure: "cluster",
  summary:
    "The 25-week TB3 on-ramp: Base, Armor, Operator Blue/Black and Vertex, with explicit test and peak weeks.",
  blockWeeks: 25,
  setsReps: [
    w("3", 3, 3, "10", 10),
    w("3", 3, 3, "15", 15),
    w("3", 3, 3, "20", 20),
    w("3", 3, 3, "25", 25),
    w("1", 1, 1, "1", 1),
    w("4", 4, 4, "8", 8),
    w("4", 4, 4, "5", 5),
    w("4", 4, 4, "3", 3),
    w("3", 3, 3, "5", 5),
    w("4", 4, 4, "5", 5),
    w("5", 5, 5, "3", 3),
    w("4", 4, 4, "5", 5),
    w("3", 3, 3, "5", 5),
    w("1", 1, 1, "1", 1),
    w("3–5", 3, 5, "5", 5),
    w("3–5", 3, 5, "5", 5),
    w("3–5", 3, 5, "3", 3),
    w("3–5", 3, 5, "5", 5),
    w("3–5", 3, 5, "5", 5),
    w("1", 1, 1, "1", 1),
    w("1", 1, 1, "1", 1),
    w("3", 3, 3, "3", 3),
    w("4", 4, 4, "2", 2),
    w("5", 5, 5, "1", 1),
    w("1", 1, 1, "1", 1),
  ],
  waves: [
    {
      id: "main",
      label: "Main",
      percents: [
        0.5, 0.5, 0.5, 0.5, 1,
        0.7, 0.8, 0.85,
        0.75, 0.8, 0.85, 0.75, 0.8, 1,
        0.75, 0.8, 0.85, 0.75, 0.8, 1,
        1, 0.65, 0.7, 0.75, 1,
      ],
    },
  ],
  weeklySessions: [
    activationSession("base-1", "Base circuit 1", 0, ACTIVATION_BASE_WEEKS, [
      A.pushup, A.gobletSquat, A.invertedRow, A.abTriad,
    ], [abRule]),
    activationSession("base-2", "Base circuit 2", 2, ACTIVATION_BASE_WEEKS, [
      A.pushup, A.gobletSquat, A.invertedRow, A.abTriad,
    ], [abRule]),
    activationSession("base-3", "Base circuit 3", 4, ACTIVATION_BASE_WEEKS, [
      A.pushup, A.gobletSquat, A.invertedRow, A.abTriad,
    ], [abRule]),
    activationSession("base-test", "Base test", 0, [5], [
      A.bench, A.barbellRow, A.squat, A.deadlift, A.rackPull, A.press,
    ], [], { kind: "test" }),
    activationSession("armor-a1", "Armor A1", 0, ACTIVATION_ARMOR_WEEKS, [
      A.squat, A.rackPull, A.backExtension, A.abTriad,
    ], [...taperRules("rack-pull"), ...supplementalRules(["back-extension"]), abRule]),
    activationSession("armor-b1", "Armor B1", 1, ACTIVATION_ARMOR_WEEKS, [
      A.bench, A.barbellRow, A.pullup, A.press,
    ], supplementalRules(["weighted-pullup", "overhead-press"])),
    activationSession("armor-a2", "Armor A2", 3, ACTIVATION_ARMOR_WEEKS, [
      A.squat, A.deadlift, A.backExtension, A.abTriad,
    ], [
      ...armorSecondPassRules,
      ...taperRules("deadlift"),
      ...supplementalRules(["back-extension"]),
      abRule,
    ]),
    activationSession("armor-b2", "Armor B2", 5, ACTIVATION_ARMOR_WEEKS, [
      A.bench, A.barbellRow, A.pullup, A.press,
    ], [...armorSecondPassRules, ...supplementalRules(["weighted-pullup", "overhead-press"])]),
    activationSession("operator-d1", "Operator D1", 0, ACTIVATION_OPERATOR_WEEKS, [
      A.bench, A.squat, A.barbellRow, A.abTriad,
    ], operatorRules, { kindByWeek: { 15: "deload" } }),
    activationSession("operator-d2", "Operator D2", 2, ACTIVATION_OPERATOR_WEEKS, [
      A.bench, A.squat, A.barbellRow, A.abTriad,
    ], operatorRules, { kindByWeek: { 15: "deload" } }),
    activationSession("operator-d3", "Operator D3", 4, ACTIVATION_OPERATOR_WEEKS, [
      A.bench, A.deadlift, A.barbellRow, A.abTriad,
    ], operatorRules, { kindByWeek: { 15: "deload" } }),
    activationSession("peak-squat", "Peak · Squat", 0, ACTIVATION_PEAK_WEEKS, [
      A.squat, A.barbellRow, A.abTriad,
    ], [
      { movements: ["barbell-row"], percent: 0.75, setsMin: 3, setsMax: 3, reps: 5, repsLabel: "5" },
      abRule,
    ], { kind: "test", peakMovements: ["squat"] }),
    activationSession("peak-bench", "Peak · Bench", 2, ACTIVATION_PEAK_WEEKS, [
      A.bench, A.barbellRow, A.abTriad,
    ], [
      { movements: ["barbell-row"], percent: 0.75, setsMin: 3, setsMax: 3, reps: 5, repsLabel: "5" },
      abRule,
    ], { kind: "test", peakMovements: ["bench"] }),
    activationSession("peak-deadlift", "Peak · Deadlift", 4, ACTIVATION_PEAK_WEEKS, [
      A.deadlift, A.barbellRow, A.abTriad,
    ], [
      { movements: ["barbell-row"], percent: 0.75, setsMin: 3, setsMax: 3, reps: 5, repsLabel: "5" },
      abRule,
    ], { kind: "test", peakMovements: ["deadlift"] }),
    activationSession("operator-test", "Operator test", 0, [21, 25], [
      A.bench, A.barbellRow, A.squat, A.deadlift, A.powerClean, A.pushPress, A.pendlayRow,
    ], [], { kind: "test" }),
    activationSession("breacher-d1", "Breacher D1", 0, ACTIVATION_VERTEX_WEEKS, [
      A.powerClean, A.squat, A.jumpSquat, A.bench, A.plyoPushup,
    ], vertexRules(["squat", "bench"], ["jump-squat", "plyo-pushup"])),
    activationSession("breacher-d2", "Breacher D2", 3, ACTIVATION_VERTEX_WEEKS, [
      A.pushPress, A.barbellRow, A.pendlayRow, A.squat, A.jumpSquat,
    ], vertexRules(["barbell-row", "squat"], ["jump-squat"], true)),
  ],
  defaultCluster: Object.values(A),
  clusterMin: Object.keys(A).length,
  clusterMax: Object.keys(A).length,
  fixedLoadout: true,
  fixedSchedule: true,
  segments: [
    { startWeekIndex: 0, label: "Base", kind: "phase" },
    { startWeekIndex: 4, label: "Rest and test", kind: "test" },
    { startWeekIndex: 5, label: "Armor", kind: "phase" },
    { startWeekIndex: 8, label: "Operator Blue", kind: "phase" },
    { startWeekIndex: 13, label: "Peak", kind: "test" },
    { startWeekIndex: 14, label: "Operator Black", kind: "deload" },
    { startWeekIndex: 19, label: "Peak", kind: "test" },
    { startWeekIndex: 20, label: "Rest and test", kind: "test" },
    { startWeekIndex: 21, label: "Vertex (Breacher)", kind: "phase" },
    { startWeekIndex: 24, label: "Final retest", kind: "test" },
  ],
  notes: [
    "Conditioning is intentionally not generated by this strength engine.",
    "Base weeks 1–4, test week 5, Armor weeks 6–8, Operator weeks 9–20, test week 21, Vertex weeks 22–24, final retest week 25.",
    "Week 15 is an explicit deload before force progression.",
  ],
};

export const TB_TEMPLATES: TbTemplate[] = [
  OPERATOR,
  FIGHTER,
  ZULU,
  ZULU_IA,
  GLADIATOR,
  MASS,
  GREY_MAN,
  ACTIVATION,
];

export function getTbTemplate(id: string): TbTemplate | undefined {
  return TB_TEMPLATES.find((t) => t.id === id);
}
