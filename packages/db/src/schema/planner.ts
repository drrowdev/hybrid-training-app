/**
 * training_blocks + planned_sessions — forward planning data model.
 *
 * A block is an archetype-driven mesocycle. Planned sessions live one row per
 * (block × week × day) with a JSONB prescription. When the user logs a real
 * session for that slot, completed_session_id links them.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { sessions, sessionSlot } from "./sessions";

export const trainingBlockStatus = pgEnum("training_block_status", [
  "active",
  "completed",
  "archived",
]);

export const trainingBlocks = pgTable("training_blocks", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull(),
  /**
   * Legacy archetype slug (strength_anchor, etc.). NULLABLE since migration
   * 0103 — platform-program blocks leave this NULL and carry their identity in
   * program_id / program_family instead. Archetype blocks still set it.
   */
  archetype: text("archetype"),
  /** Stable program engine id for platform blocks (e.g. "wendler-531"). NULL for archetype blocks. */
  programId: text("program_id"),
  /** Program family for platform blocks (e.g. "531"). NULL for archetype blocks. */
  programFamily: text("program_family"),
  startedOn: date("started_on").notNull(),
  weeks: smallint("weeks").notNull(),
  status: trainingBlockStatus("status").default("active").notNull(),
  notes: text("notes"),
  /** Captured at block start so the plan reflects what the user committed to. */
  daysPerWeek: smallint("days_per_week"),
  /**
   * Calendar-day layout chosen in the block wizard's step 5
   * ("Lay out your week"). Shape: `{ days: number[], twoADay: boolean }` where
   * day indices are Mon=0..Sun=6. Null when the block was created without the
   * wizard (legacy path, custom builder).
   */
  dayIndexOverrides: jsonb("day_index_overrides").$type<DayIndexOverrides>(),
  /**
   * Wizard "Add power emphasis" toggle (step 2). When true, the
   * accessory picker biases the role pool toward power-tagged
   * movements (`power_olympic` / `power_plyometric` / `power_ballistic`)
   * and trims high-rep hypertrophy fillers — explosive intent vs
   * hypertrophy stimulus conflict per Schoenfeld 2017. Only the
   * power-eligible archetypes (Strength Focus, Hybrid Focus) expose
   * the toggle in the UI; other archetypes always store `false`.
   */
  powerEmphasis: boolean("power_emphasis").default(false),
  /**
   * Per-block "focus muscle groups" (migration 0079). User picks up to
   * 2 muscle groups; the engine biases accessory selection toward those
   * muscles using the substitution-with-cap model — non-focus aesthetic
   * accessories scale down so total session set count stays constant
   * (no additive load; concurrent stress + stress budget preserved).
   *
   * Empty array = no focus → engine produces the pre-PR baseline.
   * DB CHECK constraints enforce `length <= 2` and membership in the
   * 12-group allowlist (see migration 0079 + `lib/planner/focus-muscles.ts`).
   * Block-scoped, not user-scoped — different blocks can have different
   * focus.
   */
  focusMuscles: text("focus_muscles")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  /**
   * Wizard PRIMARY goal + SECONDARY focus captured at block creation
   * (migration 0082, ADR 0020). Raw wizard channel values are stored
   * verbatim — `goal` ∈ {strength,muscle,cardio,resilience} and
   * `secondaryFocus` ∈ that set plus {skip,maintenance,none} — to avoid
   * information loss; `resolveSecondaryFocus` collapses anything outside the
   * tiltable set to `none` at read time. Both NULL on legacy / custom-builder
   * blocks, which the engine treats as the pre-ADR-0020 baseline (no tilt).
   */
  goal: text("goal"),
  secondaryFocus: text("secondary_focus"),
  /**
   * Per-block accessory VOLUME level (migration 0083, ADR 0024):
   * `low | medium | high`. A lever for how much accessory work a strength day
   * carries, split from the ADR 0016 effort axis. `medium` is the
   * byte-identical identity and the NOT NULL DEFAULT, so every existing row
   * reads as the pre-ADR-0024 baseline. `resolveAccessoryVolumeLevel`
   * collapses anything unrecognised to `medium` at read time. See
   * `apps/web/src/lib/planner/accessory-volume.ts`.
   */
  accessoryVolume: text("accessory_volume").default("medium").notNull(),
  /**
   * Set when status transitions out of 'active' (manual end → 'archived'
   * or auto-complete → 'completed'). Single source of truth for
   * "when did this block end"; survives later `updated_at` touches
   * (notes edits, etc.). See migration 0025.
   */
  endedAt: timestamp("ended_at", { withTimezone: true }),
  /**
   * Set only when status transitions to 'completed' via
   * `maybeCompleteBlock` (every planned session done/skipped). Distinguishes
   * "finished the program" from "manually ended" for stats. See migration 0025.
   */
  completedAt: timestamp("completed_at", { withTimezone: true }),
  /**
   * Set only when status transitions to 'archived' via `endBlock`
   * (manual press of the End block button). See migration 0025.
   */
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
  /**
   * Soft-delete marker (migration 0026). NULL = visible row, set to
   * NOW() when the user trashes the block. Cascade is implicit: child
   * `planned_sessions` are hidden by every query that joins through
   * the block. Hard-deletion only happens from the Trash page (after
   * type-to-confirm) or via the 30-day cleanup cron.
   */
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  /**
   * Phase 1 "external cardio" — when 'external', the planner reserves
   * cardio days for stress-budget / calendar math but emits a single
   * placeholder `cardio_external` item per cardio day instead of a
   * prescribed run. The user logs the actual run via their chosen
   * external program (Runna / Garmin Coach / Hal Higdon / etc.).
   * Default 'internal' keeps every legacy + new internal block on the
   * existing path. See migration 0064.
   */
  cardioSource: text("cardio_source").default("internal").notNull(),
  /**
   * Free-text label for the external program (e.g. "Runna"). Optional —
   * rendered on the external-cardio session card when present.
   */
  cardioSourceName: text("cardio_source_name"),
  /**
   * Per-block two-a-day preference (migration 0110). NULLABLE with NO default:
   * null means "inherit profile / legacy" so every pre-0110 block reads
   * byte-identically to the old `profiles.allows_two_a_days`-driven behaviour.
   * The Hybrid wizard's Schedule step writes an explicit boolean; the planner
   * read lets a non-null per-block value WIN and falls back to the profile
   * setting when null. Foreign program blocks leave it null.
   */
  allowsTwoADays: boolean("allows_two_a_days"),
  /**
   * Per-block antagonist-superset accessory preference (migration 0111).
   * NULLABLE with NO default: null means "inherit profile / legacy" so every
   * pre-0111 block reads byte-identically to the old
   * `profiles.superset_accessories`-driven behaviour. The program wizard's
   * Schedule step writes an explicit boolean (shown for ALL programs); the
   * read-time pairing (`queries.ts`) lets a non-null per-block value WIN and
   * falls back to the profile setting when null.
   */
  supersetAccessories: boolean("superset_accessories"),
}, (table) => [
  check(
    "training_blocks_weeks_check",
    sql`${table.weeks} >= 1 AND ${table.weeks} <= 52`,
  ),
]);

export type TrainingBlock = typeof trainingBlocks.$inferSelect;
export type NewTrainingBlock = typeof trainingBlocks.$inferInsert;
export type TrainingBlockStatus = (typeof trainingBlockStatus.enumValues)[number];

/**
 * Block wizard's step-5 schedule layout. `days` are Mon=0..Sun=6 indices
 * chosen for training (rest days omitted). `twoADay` mirrors the wizard
 * toggle and matches the localStorage hint shape.
 */
export type DayIndexOverrides = {
  days: number[];
  twoADay: boolean;
};

export const trainingBlockInsert = createInsertSchema(trainingBlocks);
export const trainingBlockSelect = createSelectSchema(trainingBlocks);

/**
 * Prescription item — one movement in a planned session.
 * Intentionally weakly typed (jsonb) at the DB layer; the planner library
 * owns the canonical shape.
 */
export type PrescriptionItemKind =
  | "warmup"
  | "main"
  | "back_off"
  | "accessory"
  | "tendon"
  | "power_potentiation"
  | "cardio_z2"
  | "cardio_alactic"
  | "cardio_vo2"
  | "cardio_threshold"
  /**
   * Phase 1 "external cardio" placeholder. Emitted instead of any
   * specific `cardio_*` item when the parent block's `cardio_source`
   * is 'external'. Carries no movement / duration / intensity — the
   * user logs the actual run via their external program. See
   * migration 0064.
   */
  | "cardio_external";

/**
 * One movement in a planned session.
 *
 * Strength items (`warmup` / `main` / `back_off` / `accessory` / `tendon`):
 *   carry `sets` × `reps` and optionally `percentTm`.
 *
 * Cardio items (`cardio_*`):
 *   carry `durationMin` and optionally an HR cap / pace / RPE note.
 */
export type PrescriptionItem = {
  movementId: string;
  movementSlug?: string;
  movementName?: string;
  kind: PrescriptionItemKind;
  /** Strength: sets (typically 1 = a single working set; the planner repeats items for a wave). */
  sets?: number;
  /** This concrete set is above an autoregulated minimum and may be declined. */
  optional?: boolean;
  /** Strength: reps per set. */
  reps?: number;
  /** Strength: prescribed set range before expansion into concrete log slots. */
  setRange?: { min: number; max: number };
  /** Strength: prescribed rep range when the target is not a single rep count. */
  repRange?: { min: number; max: number };
  /** Strength: % of TM. */
  percentTm?: number;
  /**
   * Strength: absolute target load in kg, when the engine prescribes a concrete
   * weight rather than a % of TM. Used for warm-up sets (e.g. 5/3/1's 40/50/60%
   * ramp resolves to fixed kg) so the logger shows the target instead of "—kg".
   * Main/supplemental sets carry `percentTm` instead so they recompute if the
   * training max changes.
   */
  targetWeightKg?: number;
  /** Cardio: planned duration in minutes. */
  durationMin?: number;
  /** Cardio: optional plain-language HR cap or pace target (e.g. "≤ 70% HRR", "conversational"). */
  hrCap?: string;
  /** Cardio: protocol hint (e.g. "6×15s near-max, 1:10 rest" or "4×4 min @ 90–95% HRmax"). */
  protocolNote?: string;
  intensityLabel?: string;
  notes?: string;
  /**
   * Linked multi-movement circuit. Each movement remains a separate prescription
   * item and set-log identity; the logger uses this metadata only to advance in
   * round order.
   */
  circuit?: {
    id: string;
    name: string;
    position: number;
    size: number;
    rounds: number;
  };
  /**
   * Cardio: structured, render-ready presentation (summary / format / per-station
   * loads / effort) — the clean alternative to cramming everything into `notes`.
   * Rendered by the shared CardioPlanView across Today / live session / plan
   * drawer. Structurally mirrors `@hta/program-core` `CardioPlan` (kept local to
   * avoid a circular type import). Optional/additive — items without it fall back
   * to `notes` rendering, so existing plans and other programs are unaffected.
   */
  cardioPlan?: {
    summary: string;
    meta?: string;
    segments?: { label: string; detail: string }[];
    stations?: { name: string; load?: string; target?: string; key?: string }[];
    effort: string;
    logHint?: string;
  };
  /**
   * Reps-in-reserve target for accessories. Range or single value
   * (min === max). Mutually exclusive with `targetRpe`. Populated by the
   * accessory-intensity matrix — see `lib/planner/accessory-intensity.ts`.
   * Grounded in Helms 2018 (autoregulation for accessories) + Schoenfeld
   * 2017 (RPE 7–9 / RIR 1–3 hypertrophy window).
   */
  targetRir?: { min: number; max: number };
  /**
   * RPE (Rate of Perceived Exertion) target. Range or single value.
   * Used for max-effort lifts where the "leave reps in reserve" framing
   * is less natural than "near-max effort". Convention: rpe = 10 − rir.
   */
  targetRpe?: { min: number; max: number };
  /**
   * Eccentric tempo in seconds (lowering phase). Used for tendon / HSR
   * items where time-under-tension drives the adaptation rather than
   * proximity to failure (Baar 2017, Kongsgaard 2009).
   */
  tempoEccentricSec?: number;
  /**
   * Hold duration in seconds for isometric items (planks, wall sits,
   * dead bugs). Replaces the rep target on the focus card.
   */
  holdSec?: { min: number; max: number };
  /**
   * Distance range in metres for loaded-carry items (farmer / suitcase /
   * overhead / front-loaded / Zercher). Carries are prescribed by
   * distance — never reps — per McGill 2014 (loaded carries train trunk
   * endurance under load) + practitioner consensus. When set, the focus
   * view swaps the reps stepper for a distance stepper and routes the
   * logged value into `set_logs.distance_m`.
   */
  distanceM?: { min: number; max: number };
  /**
   * Free-form coaching cue (≤ 80 chars). Rendered under the RIR chip on
   * the accessory focus card. Plain English, second person, no
   * methodology names or external program references (brand purity).
   */
  intensityCue?: string;
  /**
   * ADR 0007 — true when this set is solicited as a real AMRAP (open-rep)
   * top set: the user is cued to do as many clean reps as possible (stop
   * ~RIR 1, not failure) and the achieved reps drive e1RM → TM. Set on the
   * primary top set of archetypes that solicit it (strength / hybrid +
   * custom strength waves). Explicit `false` marks a fixed-rep top set that
   * deliberately does NOT solicit an AMRAP (endurance / rebuild / maintenance,
   * and the RIR-anchored hypertrophy compound — ADR 0011). Absent on legacy
   * stored prescriptions, where renderers fall back to the positional
   * last-main heuristic.
   */
  isAmrap?: boolean;
  /**
   * Open-ended per-item metadata blob. Power Emphasis Phase 3 uses this
   * to carry the compensatory-acceleration cue on capped top sets and the
   * rest-period guidance on `power_potentiation` items (PAPE window:
   * Seitz & Haff 2016; Boullosa 2018).
   *
   * Per schema-discipline (plan §6.8): UI-only, not observable from the
   * engine — kept off the typed top level on purpose.
   */
  meta?: Record<string, unknown>;
  /**
   * Bodyweight main-lift prescription. Set on items where the user has
   * no loadable kit and the engine prescribes by node × archetype ×
   * week instead of %TM. See `lib/planner/bw-prescription.ts` for the
   * full shape; mirrored loosely here to avoid a circular type import
   * from the web package into @hta/db. Always paired with the absence
   * of `percentTm` so MovementFocusView hides the weight column.
   */
  bw?: {
    prescriptionType: "reps" | "isometric_hold" | "tempo_reps";
    sets: number;
    reps?: number;
    repRange?: { min: number; max: number };
    holdSeconds?: number;
    tempoEccentricSec: number;
    targetRir: number;
    restSeconds: number;
    intensityCue: string;
    notes?: string;
    /** Underlying movement_nodes.id this prescription was sourced from. */
    nodeId?: string;
    nodeKey?: string;
    nodeDisplayName?: string;
    family?: string;
    /**
     * Phase 7 — suggested external load (vest / belt / ankle weights /
     * band assist). Negative for band assist. Undefined ⇒ no load
     * surface; renderers fall back to the plain "× N reps" headline.
     */
    externalLoadKg?: number;
    loadSource?: "weighted_vest" | "dip_belt" | "ankle_weights" | "band_assist";
    effectiveTrainingMaxKg?: number;
    /**
     * Phase 4 hint — what the engine would advance to once the gate
     * (weeks + TUT + 2 over-completed sessions) opens. Stamped at
     * planner-generation time. UI renders it as a small "Next:" chip
     * under the prescription headline. `{ mastered: true }` signals
     * a terminal node ("Mastered" chip).
     */
    nextNodePreview?:
      | { nodeKey: string; displayName: string; difficultyAnchor: number }
      | { mastered: true };
  };
};

export type Prescription = {
  items: PrescriptionItem[];
  /**
   * Set when the user edits this specific planned session's movements. Program
   * regeneration uses it to preserve the row instead of silently replacing a
   * per-session override. Absent means engine-authored or legacy unknown.
   */
  userEdited?: boolean;
  /**
   * ADR 0013 — within-block volume autoregulation. When set (< 1), the
   * discretionary items (accessory / tendon / power_potentiation) are
   * sliced to `round(n · scale)` from the END at read time (fill +
   * render) — mirroring the per-week `strengthVolumeScale` deload shape,
   * but applied to a single materialized session the user accepted a
   * trim on. Mains / back-off / warmup are never affected. Absent ⇒
   * no transform (byte-identical to legacy prescriptions). Reversible:
   * clearing the field restores the full prescription.
   */
  autoregVolumeScale?: number;
  /**
   * ADR 0031 (Phase 2) — autoregulated deload skip. Set `true` on a deload
   * week's sessions when the user accepts a skip: the stored prescription is
   * replaced with the block's wave-opener (first loading week) prescription so
   * the week becomes a normal loading week. The marker is purely an
   * idempotency / "already skipped" signal so the offer stops re-surfacing and
   * the engine doesn't re-treat the week as a deload. Absent ⇒ untouched.
   */
  deloadSkipped?: boolean;
  /**
   * ADR 0032 (Phase 3) — early deload. Set `true` on a loading week's sessions
   * when the user accepts an early-deload recommendation: the stored
   * prescription is replaced with the block's deload-week prescription so the
   * current week becomes a deload. Idempotency / "already early-deloaded"
   * marker. Absent ⇒ untouched. The SCHEDULED deload always remains (fixed
   * fallback); Phase 2 will offer to skip it if the user has since recovered.
   */
  earlyDeload?: boolean;
  /**
   * Platform cutover — the program engine's stable session ref (e.g.
   * "leader1-w1-squat" / "b0-w1-s1") for sessions materialised from a
   * `program_instances` engine. Lets the completion hook call the engine's
   * `onSessionLogged(instance, { ref, … })` to advance program state + surface
   * program-owned recommendations. Absent on archetype-generated sessions.
   */
  programRef?: string;
  /**
   * Quick HYROX generation — the chosen session format ("circuit" /
   * "compromised" / "erg" / "run"). Set only on quick-generated HYROX sessions
   * so the adaptive format picker can read recency from past sessions. Absent on
   * every other session.
   */
  meta?: {
    hyroxQuickFormat?: "circuit" | "compromised" | "erg" | "run";
    /**
     * The structured HYROX completion view for a quick-generated session, stored
     * at generation time so the session page can render the same
     * `HyroxCompletionForm` a planned HYROX session uses (structured "what to do"
     * + confirm-weights + Mark complete / Strava), without a program instance.
     */
    hyroxQuickView?: {
      title: string;
      divisionLabel: string;
      structure: { name: string; detail?: string; amount?: string }[];
      loadedStations: {
        key: string;
        name: string;
        defaultKg: number;
        loadLabel: string;
        amount?: string;
      }[];
    };
  };
};

export const plannedSessions = pgTable(
  "planned_sessions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    blockId: uuid("block_id").notNull(),
    userId: uuid("user_id").notNull(),
    weekIndex: smallint("week_index").notNull(),
    dayIndex: smallint("day_index").notNull(),
    /** Two-a-day slot. 'single' for legacy / non-doubled days, 'am' / 'pm' for paired days. */
    slot: sessionSlot("slot").default("single").notNull(),
    /** Optional explicit start time; planner default = profile AM/PM window. */
    plannedAt: timestamp("planned_at", { withTimezone: true }),
    title: text("title").notNull(),
    role: text("role").notNull(),
    prescription: jsonb("prescription").$type<Prescription>().notNull(),
    completedSessionId: uuid("completed_session_id").references(() => sessions.id, {
      onDelete: "set null",
    }),
    skippedAt: timestamp("skipped_at", { withTimezone: true }),
    /**
     * Phase 5 — modality classifier output. One of
     * pure_strength / pure_hypertrophy / pure_z2_aerobic / pure_hiit /
     * mixed_modal / skill_focused / restorative. Stamped at planner-
     * generation time by `classifySessionModality`. NULL on legacy
     * rows created before migration 0046 — consumers fall back to the
     * pure_hypertrophy default when absent.
     */
    sessionModality: text("session_modality"),
    /**
     * Phase 5 — hard-set count × modality multiplier. Persisted so the
     * recovery aggregator doesn't have to re-classify every session
     * on every read. Mixed-modal gets 1.25× (addendum §6), HIIT 1.3×,
     * skill-focused 1.2× (addendum §5), Z2 0.4×, restorative 0.2×;
     * baseline is 1.0×.
     */
    effectiveStressLoad: numeric("effective_stress_load", {
      precision: 6,
      scale: 2,
    }),
    /**
     * Free-text drawer notes the user types about a planned session.
     * Replaces the per-device `plan-notes:<id>` localStorage key — see
     * migration 0055 and `hybrid-sync-audit.md` §3a. Mirrored on the
     * client to localStorage as a fast-paint fallback, but Postgres
     * is the source of truth on hydration.
     */
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => ({
    blockWeekDaySlotUnique: uniqueIndex("planned_sessions_block_week_day_slot_unique_idx").on(
      t.blockId,
      t.weekIndex,
      t.dayIndex,
      t.slot,
    ),
    modalityIdx: index("planned_sessions_modality_idx").on(t.sessionModality),
    // Migration 0053 — backs `/app/sessions/[id]` (the page hits
    // `.eq('completed_session_id', id)` on every detail render) and
    // the deload flow which scans recent planned sessions joined back
    // to their completed counterpart. Partial — null rows (uncompleted
    // planned sessions) are excluded to keep the index lean.
    //
    // NOTE: the WHERE completed_session_id IS NOT NULL predicate lives
    // only in the hand-authored migration (drizzle/0053_perf_indexes.sql).
    // drizzle-kit cannot yet express partial indexes in schema metadata,
    // so do NOT regenerate this index from the schema — it would drop
    // the WHERE clause. If schema is the source of truth in a future
    // drizzle version, update both places together.
    completedSessionIdx: index("planned_sessions_completed_session_idx").on(
      t.completedSessionId,
    ),
  }),
);

export type PlannedSession = typeof plannedSessions.$inferSelect;
export type NewPlannedSession = typeof plannedSessions.$inferInsert;

export const plannedSessionInsert = createInsertSchema(plannedSessions);
export const plannedSessionSelect = createSelectSchema(plannedSessions);
