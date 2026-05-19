/**
 * set_logs — per-set strength entries.
 *
 * A set must record SOMETHING (CHECK constraint at SQL level):
 *   - reps × weight_kg (standard strength)
 *   - duration_sec (isometric holds, Baar tendon protocols DC-J4)
 *   - distance_m (sled push / loaded carry)
 *
 * set_kind drives DC-E1 anchor-vs-filler classification at log time.
 */
import { sql } from "drizzle-orm";
import {
  integer,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

export const setKind = pgEnum("set_kind", [
  "warmup",
  "main",
  "back_off",
  "accessory",
  "tendon",
]);

export const setLogs = pgTable("set_logs", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  sessionId: uuid("session_id").notNull(),
  movementId: uuid("movement_id").notNull(),
  setIndex: smallint("set_index").notNull(),
  weightKg: numeric("weight_kg", { precision: 6, scale: 2 }),
  reps: smallint("reps"),
  durationSec: integer("duration_sec"),
  distanceM: integer("distance_m"),
  rpe: numeric("rpe", { precision: 3, scale: 1 }),
  setKind: setKind("set_kind").default("main").notNull(),
  percentOfTm: numeric("percent_of_tm", { precision: 5, scale: 2 }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
});

export const setLogInsert = createInsertSchema(setLogs);
export const setLogSelect = createSelectSchema(setLogs);
export type SetLog = typeof setLogs.$inferSelect;
export type NewSetLog = typeof setLogs.$inferInsert;
export type SetKind = (typeof setKind.enumValues)[number];
