/**
 * training_maxes — per-user reference numbers for relative-intensity prescription.
 *
 * A TM is a deliberate underestimate of 1RM, stable across a training block,
 * used as the anchor for % prescription (DC-P1). The Log UI shows "X% of TM"
 * for any movement that has one set. Settings manages the list.
 */
import { sql } from "drizzle-orm";
import {
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { movements } from "./movements";
import { movementNodes } from "./movement-nodes";
import { sessions } from "./sessions";
import { setLogs } from "./set-logs";

/**
 * TM provenance — where the stored number came from.
 *
 *  - 'entered'        · user typed the 1RM themselves.
 *  - 'derived_amrap'  · accepted from an AMRAP top-set e1RM suggestion.
 *  - 'derived_rpe'    · accepted from an RPE-anchored e1RM suggestion.
 */
export const TM_SOURCES = ["entered", "derived_amrap", "derived_rpe"] as const;
export type TmSource = (typeof TM_SOURCES)[number];

/** Formula label kept alongside derived TMs for UI disclosure. */
export const TM_FORMULAS = ["epley", "brzycki", "rpe_zourdos"] as const;
export type TmFormula = (typeof TM_FORMULAS)[number];

export const trainingMaxes = pgTable(
  "training_maxes",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id").notNull(),
    movementId: uuid("movement_id")
      .notNull()
      .references(() => movements.id, { onDelete: "cascade" }),
    /**
     * The user's actual 1RM in kg for this movement. Nullable since
     * migration 0042 — a TM row can anchor on `bwNodeId` instead for
     * bodyweight-only families. The table-level CHECK enforces that
     * at least one of (oneRmKg, bwNodeId) is set.
     */
    oneRmKg: numeric("one_rm_kg", { precision: 6, scale: 2 }),
    /**
     * For bodyweight-anchored TMs: the user's current node in the
     * skill-tree DAG. NULL for barbell-anchored TMs (the existing
     * majority of rows).
     */
    bwNodeId: uuid("bw_node_id").references(() => movementNodes.id, {
      onDelete: "set null",
    }),
    /** Optional per-movement TM% override; falls back to profile.tm_percent_default. */
    tmPercent: numeric("tm_percent", { precision: 4, scale: 1 }),
    notes: text("notes"),
    /** Provenance tag — see TM_SOURCES. Defaults to 'entered'. */
    source: text("source").notNull().default("entered"),
    /** When source is derived_*, links back to the session that produced it. */
    derivedFromSessionId: uuid("derived_from_session_id").references(
      () => sessions.id,
      { onDelete: "set null" },
    ),
    /** When source is derived_*, links back to the specific set log. */
    derivedFromSetLogId: uuid("derived_from_set_log_id").references(
      () => setLogs.id,
      { onDelete: "set null" },
    ),
    /** Which formula produced the derived value (epley | brzycki | rpe_zourdos). */
    derivedFormula: text("derived_formula"),
    /** Timestamp the derived value was accepted. NULL for entered rows. */
    derivedAt: timestamp("derived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => ({
    userMovementUnique: uniqueIndex("training_maxes_user_movement_unique_idx").on(
      t.userId,
      t.movementId,
    ),
  }),
);

export const trainingMaxInsert = createInsertSchema(trainingMaxes);
export const trainingMaxSelect = createSelectSchema(trainingMaxes);

export type TrainingMax = typeof trainingMaxes.$inferSelect;
export type NewTrainingMax = typeof trainingMaxes.$inferInsert;
