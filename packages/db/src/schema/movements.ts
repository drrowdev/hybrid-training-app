/**
 * movements — exercise catalog (seed + per-user custom).
 *
 * Per plan §4.3 + DC-A6 + DC-D4 modality interference cost + DC-T1
 * per-muscle hypertrophy tracking. Organised by pattern + region per
 * v2 vocabulary. Each movement carries the metadata needed by the
 * scheduler (interference cost, eccentric cost, stim-to-fatigue ratio,
 * etc.) so substitution is mechanical.
 *
 * Phase 1 seeds ~250 movements. Phase 0 just established the table;
 * 0002 promoted muscle tracking + safety flags to columns.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
  uniqueIndex,
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

/** DC-T1 + DC-O1 muscle-priority taxonomy (22 trackable muscles). */
export const muscle = pgEnum("muscle", [
  "chest",
  "upper_chest",
  "front_delts",
  "side_delts",
  "rear_delts",
  "biceps",
  "triceps",
  "forearms",
  "traps",
  "lats",
  "mid_back",
  "lower_back",
  "abs",
  "obliques",
  "glutes",
  "quads",
  "hamstrings",
  "adductors",
  "abductors",
  "calves",
  "tibialis",
  "neck",
]);

/** DC-D3 conflict matrix component (axial × rowing volume). */
export const axialLoad = pgEnum("axial_load", ["low", "moderate", "high"]);

/** DC-O5 hypertrophy-slot ranking under concurrent stress. */
export const stability = pgEnum("stability", [
  "free",
  "supported",
  "fixed_path",
]);

export const movements = pgTable(
  "movements",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    /** Null = global seed movement; otherwise per-user custom. */
    userId: uuid("user_id"),
    slug: text("slug").notNull(),
    displayName: text("display_name").notNull(),
    pattern: text("pattern").notNull(),
    primaryRegion: region("primary_region").notNull(),
    /** Additional loaded regions for region-ledger fanout (DC-A5). */
    secondaryRegions: jsonb("secondary_regions")
      .$type<string[]>()
      .default([])
      .notNull(),
    /** DC-T1: primary muscles directly trained (counts toward weekly hard-sets target). */
    primaryMuscles: muscle("primary_muscles")
      .array()
      .default(sql`'{}'::muscle[]`)
      .notNull(),
    /** Secondary muscles loaded (stabilisers / partial recruitment). */
    secondaryMuscles: muscle("secondary_muscles")
      .array()
      .default(sql`'{}'::muscle[]`)
      .notNull(),
    equipment: text("equipment"),
    isCompound: boolean("is_compound").default(false).notNull(),
    interferenceCost: interferenceCost("interference_cost").default("low"),
    /** DC-J5: applies the 6h same-tendon refractory rule when true. */
    highStrainTendon: boolean("high_strain_tendon").default(false).notNull(),
    /** Accessory picker tags (docs/design/accessory-schema.md §22). */
    bulletproofRoles: text("bulletproof_roles")
      .array()
      .default(sql`'{}'::text[]`)
      .notNull(),
    functionalRoles: text("functional_roles")
      .array()
      .default(sql`'{}'::text[]`)
      .notNull(),
    /** Picker filter: prefer is_supported = true under concurrent stress. */
    isSupported: boolean("is_supported").default(false).notNull(),
    /** Picker ranking: 1 (low) .. 5 (high). Null = unknown. */
    eccentricLoadScore: smallint("eccentric_load_score"),
    stimToFatigueScore: smallint("stim_to_fatigue_score"),
    /** DC-D3 conflict matrix term. */
    axialLoad: axialLoad("axial_load").default("low").notNull(),
    /** DC-O5: prefer supported/fixed_path variants under concurrent stress. */
    stability: stability("stability").default("free").notNull(),
    /** False = unilateral; affects set-count math (1 set/side ≠ 1 bilateral set). */
    bilateral: boolean("bilateral").default(true).notNull(),
    /** Pull-ups, dips, etc. can be loaded with a belt. */
    bodyWeightLoaded: boolean("body_weight_loaded").default(false).notNull(),
    /**
     * Engine-relevant tags that haven't (yet) earned a column:
     *   eccentric_cost, cns_cost, stim_fatigue_ratio, rom_profile,
     *   tempo_suggested, default_rep_range, default_rpe_cap, variants, notes.
     * Per plan §6.8 — these stay in JSONB until they're queried or shown.
     */
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => ({
    /** Mirror of the SQL UNIQUE NULLS NOT DISTINCT (user_id, slug). */
    userSlugUnique: uniqueIndex("movements_user_id_slug_unique_idx").on(
      t.userId,
      t.slug,
    ),
  }),
);

export const movementInsert = createInsertSchema(movements);
export const movementSelect = createSelectSchema(movements);

export type Movement = typeof movements.$inferSelect;
export type NewMovement = typeof movements.$inferInsert;
export type Muscle = (typeof muscle.enumValues)[number];
export type Region = string;
export type InterferenceCost = (typeof interferenceCost.enumValues)[number];
export type AxialLoad = (typeof axialLoad.enumValues)[number];
export type Stability = (typeof stability.enumValues)[number];
