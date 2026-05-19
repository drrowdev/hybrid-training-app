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

export const limitations = pgTable("limitations", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull(),
  region: region("region").notNull(),
  severity: limitationSeverity("severity").notNull(),
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
  createdAt: timestamp("created_at", { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
});

export const limitationInsert = createInsertSchema(limitations);
export const limitationSelect = createSelectSchema(limitations);

export type Limitation = typeof limitations.$inferSelect;
export type NewLimitation = typeof limitations.$inferInsert;
