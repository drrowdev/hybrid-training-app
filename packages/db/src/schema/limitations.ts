/**
 * limitations — active per-region injury / restriction flags.
 *
 * DC-V1 (Phase D 2026-05-19): structured profile-level table; users add
 * a row when injured, set resolved_at when better. Binding input for the
 * safety hard-blocks DC-D5, DC-D7, DC-J9 and the N_history term in DC-C8.
 * NOT a daily symptom log — set/clear, no daily prompts.
 *
 * DC-V3: rows never auto-resolve; engine surfaces a "still bothering you?"
 * nudge after 90 days of an open row but does not modify state.
 */
import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

/** DC-V1 — three-step severity. */
export const limitationSeverity = pgEnum("limitation_severity", [
  "mild",
  "moderate",
  "severe",
]);

/** DC-A6 — the seven tracked regions. */
export const region = pgEnum("region", [
  "foot_ankle_calf",
  "knee",
  "hamstring_posterior",
  "adductor_groin",
  "lumbar_trunk",
  "shoulder_scapular",
  "elbow_forearm",
]);

export const limitations = pgTable(
  "limitations",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id").notNull(),
    /**
     * DC-A6 region — was NOT NULL pre-0033. Now nullable so users can
     * flag a row scoped purely to muscles or to explicit movements
     * without having to pick one of the seven engine regions. The
     * engine still falls back on `region` when present.
     */
    region: region("region"),
    severity: limitationSeverity("severity").notNull(),
    /** Short free-text descriptor — "knee", "left shoulder", etc. */
    kind: text("kind"),
    /**
     * 16-muscle catalog values flagged as affected. See
     * apps/web/src/lib/muscle/muscle-groups.ts for the canonical
     * MuscleGroup union. Defaults to '{}' so legacy rows look empty
     * rather than null.
     */
    affectedMuscles: text("affected_muscles")
      .array()
      .$type<string[]>()
      .default(sql`'{}'::text[]`)
      .notNull(),
    /**
     * Explicit movement IDs to avoid / cap. Soft-reference: Postgres
     * doesn't support FK arrays so callers must scrub stale IDs.
     */
    affectedMovementIds: uuid("affected_movement_ids")
      .array()
      .$type<string[]>()
      .default(sql`'{}'::uuid[]`)
      .notNull(),
    /**
     * Per-exercise allow-list — user-asserted "I can still do this one
     * without pain." Movements in this set bypass the muscle-level
     * filter introduced in PR #__ (this branch). Engine reads this
     * set in accessory-picker / power-emphasis-transform.
     */
    allowedMovementIds: uuid("allowed_movement_ids")
      .array()
      .$type<string[]>()
      .default(sql`'{}'::uuid[]`)
      .notNull(),
    /**
     * Which side of the body the limitation affects. Informational
     * + future-trend data: the engine still drops bilateral
     * movements regardless of side (a barbell squat loads both
     * adductors, so it filters when adductors are blocked, even if
     * `affected_side = 'left'`). Per-limitation, not per-muscle —
     * if the user wants "left adductor" + "right quad" as one issue,
     * that's two limitation rows.
     */
    affectedSide: text("affected_side").$type<
      "left" | "right" | "bilateral"
    >(),
    startedAt: timestamp("started_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    notes: text("notes"),
    /**
     * Engine-applied adjustments (movement swaps, region caps, archetype
     * overrides). Per plan §6.8 — schema discipline keeps these in JSONB.
     */
    adjustments: jsonb("adjustments")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    /**
     * What the engine *did* in response to this limitation
     * (cap %, substitute, skip). Engine writes; user reads. The Recent
     * adjustments card on /app/recovery/injuries renders this.
     */
    engineAction: jsonb("engine_action")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => ({
    affectedSideCheck: check(
      "limitations_affected_side_check",
      sql`${t.affectedSide} IS NULL OR ${t.affectedSide} IN ('left', 'right', 'bilateral')`,
    ),
    affectedMusclesGin: index("limitations_affected_muscles_gin_idx").using(
      "gin",
      t.affectedMuscles,
    ),
    affectedMovementIdsGin: index(
      "limitations_affected_movement_ids_gin_idx",
    ).using("gin", t.affectedMovementIds),
    allowedMovementIdsGin: index(
      "limitations_allowed_movement_ids_gin_idx",
    )
      .using("gin", t.allowedMovementIds)
      .where(sql`${t.resolvedAt} IS NULL`),
  }),
);

export const limitationInsert = createInsertSchema(limitations);
export const limitationSelect = createSelectSchema(limitations);

export type Limitation = typeof limitations.$inferSelect;
export type NewLimitation = typeof limitations.$inferInsert;
