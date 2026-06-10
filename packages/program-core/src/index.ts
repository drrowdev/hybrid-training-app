/**
 * @hta/program-core — the platform ↔ program contract.
 *
 * The app is a PLATFORM that hosts multiple training programs (5/3/1, Tactical
 * Barbell, HYROX, …). This package defines the single interface every program
 * implements (`ProgramEngine`) plus the program-agnostic types that flow across
 * the boundary. It is PURE — zero runtime deps, no DB, no React.
 *
 * The core seam:
 *   - PROGRAM-OWNED (the engine): how sessions are prescribed, how load
 *     progresses, when/how to DELOAD, the periodization structure.
 *   - USER-OWNED (the platform): logged history, strength state (training
 *     maxes / PRs), stats, injuries, integrations. These persist across program
 *     switches and are injected into the engine via `PlatformContext` — the
 *     engine READS shared state but never OWNS or mutates it directly.
 *
 * Hard rule (matches 5/3/1 + the app's no-silent-automation principle):
 * deload / progression are surfaced as `ProgramRecommendation`s the USER
 * accepts — engines never auto-apply a TM bump or schedule a deload.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Prescription — the common currency every program emits
// ─────────────────────────────────────────────────────────────────────────────

/** The role a prescribed item plays in a session. Extensible across modalities. */
export type PrescribedItemKind =
  | "warmup"
  | "main"
  | "amrap"
  | "supplemental"
  | "assistance"
  | "conditioning"
  | "cardio"
  | "note";

/**
 * A single prescribed item. May represent N identical sets via `sets` (e.g. BBB
 * 5×10 = one item with sets:5), or a single working set (main %TM sets differ in
 * weight, so each is its own item). Modality-agnostic: strength items carry
 * weight/reps; conditioning items carry duration/distance.
 */
export interface PrescribedItem {
  kind: PrescribedItemKind;
  /** Movement / exercise / activity label (e.g. "Squat", "Run", "Plank"). */
  name: string;
  /** Optional reference to a platform catalog movement. */
  movementId?: string;
  /** Number of sets this item represents (default 1). */
  sets?: number;
  /** Target reps (the minimum on an AMRAP/PR set). */
  reps?: number;
  /** Upper bound for a rep range (e.g. 8–10). */
  repsMax?: number;
  /** Loaded working weight (kg), when applicable. */
  weightKg?: number;
  /** Fraction of the relevant training max, when %-based. */
  percentOfTm?: number;
  /** As-many-reps-as-possible / PR set. */
  isAmrap?: boolean;
  /** Display override for the reps cell (e.g. "3–5", "PR", "20"). */
  repsLabel?: string;
  /** Conditioning duration (seconds). */
  durationSec?: number;
  /** Conditioning distance (meters). */
  distanceM?: number;
  /** Free-text cue / load hint ("heavy", "bodyweight", "leave 1 in reserve"). */
  note?: string;
}

/** The full ordered prescription for one session. */
export interface SessionPrescription {
  items: PrescribedItem[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Program metadata + setup
// ─────────────────────────────────────────────────────────────────────────────

export interface ProgramMeta {
  /** Stable engine id (e.g. "wendler-531"). */
  id: string;
  /** User-facing name (e.g. "5/3/1"). */
  name: string;
  /** Program family for grouping (e.g. "531", "tactical-barbell", "hyrox", "archetype"). */
  family: string;
  /** One-line description for the program picker. */
  summary: string;
}

/** A field the setup wizard must collect for a program. */
export type SetupFieldType = "training-max" | "number" | "select" | "boolean" | "days";

export interface SetupField {
  key: string;
  label: string;
  type: SetupFieldType;
  /** For `select` fields. */
  options?: { value: string; label: string }[];
  /** Default value used to seed the control. */
  defaultValue?: unknown;
  help?: string;
  required?: boolean;
}

export interface SetupSchema {
  fields: SetupField[];
}

/** The collected setup values (validated by the engine in `setup`). */
export interface ProgramSetupInput {
  values: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared user state injected into the engine (READ-only from the engine's view)
// ─────────────────────────────────────────────────────────────────────────────

/** A logged set the platform passes back to the engine for progression logic. */
export interface LoggedSet {
  /** Movement key this set was performed for (e.g. "squat"). */
  movement?: string;
  weightKg: number;
  reps: number;
  rpe?: number;
  isAmrap?: boolean;
}

/** A logged session — the immutable, user-owned training record. */
export interface LoggedSession {
  /** The planned-session ref this log fulfils (links back to the timeline). */
  ref: string;
  /** ISO timestamp the session was performed. */
  performedAt: string;
  sets: LoggedSet[];
}

/**
 * Read-only view of shared platform state the engine needs to prescribe and to
 * reason about progression. The platform builds this; the engine never mutates
 * it. Strength state (training maxes) is PLATFORM-shared — a 5/3/1 program and a
 * future TB program read/advise the same numbers.
 */
export interface PlatformContext {
  /** Current training maxes by movement key (kg). */
  trainingMaxes: Record<string, number>;
  /** Plate increment for rounding working weights (kg). */
  roundingKg: number;
  /** Recent logged sessions, most recent first (for progression heuristics). */
  recentLogs?: LoggedSession[];
  /** Movement/region keys currently under an active injury limitation. */
  activeLimitations?: string[];
  /** Injectable "now" for deterministic date math in tests. */
  now?: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// Program-owned recommendations (surfaced, never auto-applied)
// ─────────────────────────────────────────────────────────────────────────────

export type ProgramRecommendationKind =
  | "deload"
  | "tm-test"
  | "tm-bump"
  | "tm-reset"
  | "next-block"
  | "info";

export interface ProgramRecommendation {
  kind: ProgramRecommendationKind;
  /** Short headline for the recommendation card. */
  title: string;
  /** Plain-language explanation (cite the methodology where relevant). */
  detail: string;
  /** Optional structured payload (e.g. { movement, fromTmKg, toTmKg }). */
  data?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// A session position in a program's timeline
// ─────────────────────────────────────────────────────────────────────────────

export type PlannedSessionKind = "training" | "deload" | "test" | "rest";

/**
 * One session's POSITION in a program's timeline. Light by design — the
 * prescription is materialised on demand via `prescribe(instance, ref, ctx)` so
 * it always reflects the CURRENT training maxes. The platform persists this
 * structure to drive the calendar/rendering.
 */
export interface PlannedSessionSpec {
  /** Stable id within the instance (e.g. "leader1-w1-squat"). */
  ref: string;
  /** 0-based absolute index across the whole program timeline. */
  index: number;
  /** Human label (e.g. "Leader 1 · Wk 1 · Squat"). */
  label: string;
  kind: PlannedSessionKind;
  /** Program-native week scope (opaque to the platform; for grouping/labels). */
  weekLabel?: string;
  /** Planned weekday (0 = Mon), when the program assigns one. */
  weekday?: number;
  /** Free-form tags for filtering/rendering (e.g. ["main:squat", "7w:deload"]). */
  tags?: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// The contract
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A pluggable training program. `Instance` is the program's serialisable state
 * (config + timeline + cursor) — it MUST be JSON-round-trippable, since the
 * platform stores it in `program_instances`. The engine is otherwise pure: all
 * shared/user state arrives via `PlatformContext`.
 */
export interface ProgramEngine<Instance = unknown> {
  readonly meta: ProgramMeta;

  /** The inputs the setup wizard must collect (training maxes, template, days…). */
  describeSetup(): SetupSchema;

  /** Validate setup input and produce a concrete, serialisable program instance. */
  setup(input: ProgramSetupInput, ctx: PlatformContext): Instance;

  /** The ordered timeline of planned sessions for the instance. */
  timeline(instance: Instance): PlannedSessionSpec[];

  /** Materialise the prescription for one planned session against current state. */
  prescribe(instance: Instance, ref: string, ctx: PlatformContext): SessionPrescription;

  /**
   * Advance instance state after a session is logged, and surface any
   * PROGRAM-OWNED recommendations (deload, TM test/bump, next block). The
   * returned instance is the new state to persist; recommendations are shown to
   * the user for acceptance — never auto-applied.
   */
  onSessionLogged(
    instance: Instance,
    log: LoggedSession,
    ctx: PlatformContext,
  ): { instance: Instance; recommendations: ProgramRecommendation[] };
}

// ─────────────────────────────────────────────────────────────────────────────
// Small pure helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Total prescribed sets in a session (sums each item's `sets`, default 1). */
export function totalPrescribedSets(p: SessionPrescription): number {
  return p.items.reduce((n, it) => n + (it.sets ?? 1), 0);
}

/** Items of a given kind, in order. */
export function itemsOfKind(p: SessionPrescription, kind: PrescribedItemKind): PrescribedItem[] {
  return p.items.filter((it) => it.kind === kind);
}

/** Look up a training max by movement key, or undefined. */
export function trainingMaxFor(ctx: PlatformContext, movement: string): number | undefined {
  return ctx.trainingMaxes[movement];
}
