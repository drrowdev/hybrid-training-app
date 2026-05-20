/**
 * training_blocks + planned_sessions — forward planning data model.
 *
 * A block is an archetype-driven mesocycle. Planned sessions live one row per
 * (block × week × day) with a JSONB prescription. When the user logs a real
 * session for that slot, completed_session_id links them.
 */
import { sql } from "drizzle-orm";
import {
  date,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { sessions } from "./sessions";

export const trainingBlockStatus = pgEnum("training_block_status", [
  "active",
  "completed",
  "archived",
]);

export const trainingBlocks = pgTable("training_blocks", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull(),
  archetype: text("archetype").notNull(),
  startedOn: date("started_on").notNull(),
  weeks: smallint("weeks").notNull(),
  status: trainingBlockStatus("status").default("active").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
});

export type TrainingBlock = typeof trainingBlocks.$inferSelect;
export type NewTrainingBlock = typeof trainingBlocks.$inferInsert;
export type TrainingBlockStatus = (typeof trainingBlockStatus.enumValues)[number];

export const trainingBlockInsert = createInsertSchema(trainingBlocks);
export const trainingBlockSelect = createSelectSchema(trainingBlocks);

/**
 * Prescription item — one movement in a planned session.
 * Intentionally weakly typed (jsonb) at the DB layer; the planner library
 * owns the canonical shape.
 */
export type PrescriptionItem = {
  movementId: string;
  movementSlug?: string;
  movementName?: string;
  sets: number;
  reps: number;
  percentTm?: number;
  intensityLabel?: string;
  kind: "warmup" | "main" | "back_off" | "accessory" | "tendon";
  notes?: string;
};

export type Prescription = {
  items: PrescriptionItem[];
};

export const plannedSessions = pgTable(
  "planned_sessions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    blockId: uuid("block_id").notNull(),
    userId: uuid("user_id").notNull(),
    weekIndex: smallint("week_index").notNull(),
    dayIndex: smallint("day_index").notNull(),
    title: text("title").notNull(),
    role: text("role").notNull(),
    prescription: jsonb("prescription").$type<Prescription>().notNull(),
    completedSessionId: uuid("completed_session_id").references(() => sessions.id, {
      onDelete: "set null",
    }),
    skippedAt: timestamp("skipped_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => ({
    blockWeekDayUnique: uniqueIndex("planned_sessions_block_week_day_unique_idx").on(
      t.blockId,
      t.weekIndex,
      t.dayIndex,
    ),
  }),
);

export type PlannedSession = typeof plannedSessions.$inferSelect;
export type NewPlannedSession = typeof plannedSessions.$inferInsert;

export const plannedSessionInsert = createInsertSchema(plannedSessions);
export const plannedSessionSelect = createSelectSchema(plannedSessions);
