/**
 * movements — exercise catalog (seed + per-user custom).
 *
 * Per plan §4.3 + DC-A6 + DC-D4 modality interference cost.
 * Organised by pattern + region per v2 vocabulary. Each movement carries
 * the metadata needed by the scheduler (interference cost, eccentric cost,
 * stim-to-fatigue ratio, etc.) so substitution is mechanical.
 *
 * Phase 1 seeds ~250 movements. Phase 0 just establishes the table.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { region } from "./limitations";

/** DC-D4 modality interference hierarchy (Wilson 2012 HIGH meta). */
export const interferenceCost = pgEnum("interference_cost", [
  "very_low",
  "low",
  "low_moderate",
  "moderate",
  "moderate_high",
  "high",
  "variable",
]);

export const movements = pgTable("movements", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  /** Null = global seed movement; otherwise per-user custom. */
  userId: uuid("user_id"),
  slug: text("slug").notNull(),
  displayName: text("display_name").notNull(),
  pattern: text("pattern").notNull(), // squat / hinge / press / pull / carry / locomotion / etc.
  primaryRegion: region("primary_region").notNull(),
  /** Additional loaded regions for region-ledger fanout (DC-A5). */
  secondaryRegions: jsonb("secondary_regions")
    .$type<string[]>()
    .default([])
    .notNull(),
  equipment: text("equipment"),
  isCompound: boolean("is_compound").default(false).notNull(),
  interferenceCost: interferenceCost("interference_cost").default("low"),
  /**
   * Engine-relevant tags: eccentric_cost, cns_cost, stim_fatigue_ratio,
   * high_strain_tendon (boolean for DC-O2/J5 tendon refractory), etc.
   * Per plan §6.8 — kept in JSONB until they earn columns.
   */
  metadata: jsonb("metadata")
    .$type<Record<string, unknown>>()
    .default({})
    .notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
});

export const movementInsert = createInsertSchema(movements);
export const movementSelect = createSelectSchema(movements);

export type Movement = typeof movements.$inferSelect;
export type NewMovement = typeof movements.$inferInsert;
