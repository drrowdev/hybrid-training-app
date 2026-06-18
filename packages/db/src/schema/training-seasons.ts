/**
 * training_seasons + season_blocks — the macrocycle "Season" roadmap (ADR 0051).
 *
 * A Season is an ADVISORY, opt-in roadmap of block *intentions* above the
 * program platform: an ordered list of `(program, template?, emphasis)` blocks,
 * one active Season per user. Phase 0 (this schema) stores the sequence only —
 * no event anchor, no balance floors yet.
 *
 * Materialisation contract (ADR 0051 Decision 2): **only the active block is
 * materialised** into `training_blocks` + `planned_sessions`. Future
 * `season_blocks` are intentions with NO sessions; `blockId` links a block to the
 * `training_block` that was created when it was activated. With no active Season,
 * every existing surface behaves byte-identically — the Season layer is purely
 * additive.
 */
import { sql } from "drizzle-orm";
import { integer, pgTable, text, timestamp, uuid, index, unique, date } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { trainingBlocks } from "./planner";

/** Lifecycle of a Season. One 'active' per user. */
export const SEASON_STATUSES = ["active", "completed", "abandoned"] as const;
export type SeasonStatus = (typeof SEASON_STATUSES)[number];

/** Goal anchor type (ADR 0051 Phase 1). 'event' pins a peak to a priority_events
 *  A-event; 'theme' is a soft target date with no event row. NULL = no goal. */
export const SEASON_GOAL_TYPES = ["event", "theme"] as const;
export type SeasonGoalType = (typeof SEASON_GOAL_TYPES)[number];

/** Lifecycle of a Season block. At most one 'active' per Season. */
export const SEASON_BLOCK_STATUSES = ["planned", "active", "done", "skipped"] as const;
export type SeasonBlockStatus = (typeof SEASON_BLOCK_STATUSES)[number];

/**
 * Emphasis tag — the hybrid strength↔endurance bias a block expresses. Stored as
 * text (validated by Zod at the action boundary) rather than a pg enum so new
 * tags can ship without a migration. Phase 0 uses these as labels; the balance
 * floors that act on `*_bias` land in a later phase (ADR 0051 Phase 2).
 */
export const SEASON_EMPHASES = [
  "base",
  "strength_bias",
  "endurance_bias",
  "build",
  "peak",
  "realize",
  "recovery",
] as const;
export type SeasonEmphasis = (typeof SEASON_EMPHASES)[number];

export const trainingSeasons = pgTable(
  "training_seasons",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id").notNull(),
    /** User-facing label, e.g. "Spring HYROX build". */
    name: text("name").notNull(),
    /** Goal anchor (ADR 0051 Phase 1): NULL | 'event' | 'theme'. */
    goalType: text("goal_type"),
    /** When goalType='event', the priority_events A-event this Season peaks for. */
    targetEventId: uuid("target_event_id"),
    /** Denormalised event/peak date for the "N weeks out" back-calculation. */
    targetDate: date("target_date"),
    /** Lifecycle — see SEASON_STATUSES. One 'active' per user. */
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    /** Soft-delete marker (NULL = visible). */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    userStatusIdx: index("training_seasons_user_status_idx").on(t.userId, t.status),
  }),
);

export const seasonBlocks = pgTable(
  "season_blocks",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    seasonId: uuid("season_id")
      .notNull()
      .references(() => trainingSeasons.id, { onDelete: "cascade" }),
    /** Denormalised for RLS + cheap filtering (matches the season's owner). */
    userId: uuid("user_id").notNull(),
    /** 0-based order within the Season. */
    position: integer("position").notNull(),
    /** Registry program id to run this block (e.g. "wendler-531", "hybrid"). */
    programId: text("program_id").notNull(),
    /** Program-specific template/variant id (TB template, 5/3/1 template, …); NULL = program default. */
    templateRef: text("template_ref"),
    /** Hybrid emphasis tag — see SEASON_EMPHASES. */
    emphasis: text("emphasis").notNull().default("base"),
    /** Optional user/coach note. */
    intentNote: text("intent_note"),
    /** Display-only week estimate; the real week count comes from the engine on activation. */
    plannedWeeks: integer("planned_weeks"),
    /** Lifecycle — see SEASON_BLOCK_STATUSES. At most one 'active' per Season. */
    status: text("status").notNull().default("planned"),
    /** The materialised block, set ONLY when this Season block is activated. */
    blockId: uuid("block_id").references(() => trainingBlocks.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => ({
    seasonPositionUnq: unique("season_blocks_season_position_unq").on(t.seasonId, t.position),
    userIdx: index("season_blocks_user_idx").on(t.userId),
  }),
);

export const trainingSeasonInsert = createInsertSchema(trainingSeasons);
export const trainingSeasonSelect = createSelectSchema(trainingSeasons);
export type TrainingSeasonRow = typeof trainingSeasons.$inferSelect;

export const seasonBlockInsert = createInsertSchema(seasonBlocks);
export const seasonBlockSelect = createSelectSchema(seasonBlocks);
export type SeasonBlockRow = typeof seasonBlocks.$inferSelect;
