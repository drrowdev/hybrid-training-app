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

export const trainingMaxes = pgTable(
  "training_maxes",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id").notNull(),
    movementId: uuid("movement_id")
      .notNull()
      .references(() => movements.id, { onDelete: "cascade" }),
    /** The user's actual 1RM in kg for this movement. */
    oneRmKg: numeric("one_rm_kg", { precision: 6, scale: 2 }).notNull(),
    /** Optional per-movement TM% override; falls back to profile.tm_percent_default. */
    tmPercent: numeric("tm_percent", { precision: 4, scale: 1 }),
    notes: text("notes"),
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
