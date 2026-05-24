/**
 * movement_nodes — global catalog of bodyweight progression nodes.
 *
 * The DAG that replaces "+2.5 kg" as the unit of progression for
 * bodyweight users (per the addendum, principle 2: progression is
 * discrete, not linear). Rows are seeded from
 * packages/db/seeds/bw-movement-nodes.ts; no per-user data lives
 * here — RLS is intentionally off because every user reads the same
 * catalog. See drizzle/0042_bw_skill_tree.sql for the design notes.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

/**
 * Movement-family taxonomy. Keep in sync with the CHECK constraint
 * in drizzle/0042_bw_skill_tree.sql and with MovementFamily in
 * src/types.ts.
 */
export const MOVEMENT_FAMILIES = [
  "push_h",
  "push_v",
  "pull_h",
  "pull_v",
  "squat_unilateral",
  "squat_bilateral",
  "hinge",
  "core_anti_flexion",
  "core_anti_rotation",
  "planche",
  "lever_front",
  "lever_back",
  "muscle_up",
  "handstand",
  "human_flag",
] as const;

export type MovementFamily = (typeof MOVEMENT_FAMILIES)[number];

export const movementNodes = pgTable(
  "movement_nodes",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    /** One of MOVEMENT_FAMILIES — validated by DB CHECK. */
    family: text("family").notNull().$type<MovementFamily>(),
    /** Stable per-family identifier, e.g. "archer_pull_up". */
    nodeKey: text("node_key").notNull(),
    displayName: text("display_name").notNull(),
    /** DAG edges — other node ids this node depends on. */
    prerequisites: uuid("prerequisites")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    /** True for movements that accept weighted variants (vest, belt). */
    externalLoadCapable: boolean("external_load_capable")
      .notNull()
      .default(false),
    /** True for lever / planche / flag — scored by hold time, not reps. */
    isometricCapable: boolean("isometric_capable").notNull().default(false),
    unilateral: boolean("unilateral").notNull().default(false),
    /** Default eccentric component (seconds) for prescription. */
    defaultTempoSeconds: smallint("default_tempo_seconds")
      .notNull()
      .default(4),
    /** Denominator for the effectiveDifficulty tempo-scale factor. */
    tutPerRepSeconds: smallint("tut_per_rep_seconds").notNull().default(4),
    /** Coarse 1–100 cross-family ranking — Phase 4 will iterate. */
    difficultyAnchor: smallint("difficulty_anchor").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => ({
    familyKeyUnique: uniqueIndex("movement_nodes_family_key_uidx").on(
      t.family,
      t.nodeKey,
    ),
    familyIdx: index("movement_nodes_family_idx").on(t.family),
  }),
);

export const movementNodeInsert = createInsertSchema(movementNodes);
export const movementNodeSelect = createSelectSchema(movementNodes);

export type MovementNode = typeof movementNodes.$inferSelect;
export type NewMovementNode = typeof movementNodes.$inferInsert;
