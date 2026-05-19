/**
 * profiles — app-level user data, 1:1 with auth.users.
 *
 * Per plan §4.3: don't extend the auth table; create a sibling row.
 * RLS policy: `USING (id = auth.uid())`. Owned migration below.
 */
import { sql } from "drizzle-orm";
import {
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  numeric,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

export const profiles = pgTable("profiles", {
  // PK = the auth.users.id from Supabase Auth.
  id: uuid("id").primaryKey(),
  displayName: text("display_name"),
  timezone: text("timezone").default("UTC").notNull(),
  units: text("units").default("metric").notNull(), // "metric" | "imperial"
  // Bodyweight kept on profile so it's captured at onboarding (DC-T3, §U scope).
  bodyweightKg: numeric("bodyweight_kg", { precision: 6, scale: 2 }),
  // Free-form intake blobs (training history, goals, equipment, modality
  // prefs, tissue history). Per plan §6.8 — fields that aren't observable
  // from outside the engine go in JSONB, not columns.
  intake: jsonb("intake").$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
});

export const profileInsert = createInsertSchema(profiles);
export const profileSelect = createSelectSchema(profiles);

export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;
