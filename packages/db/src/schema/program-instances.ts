/**
 * program_instances — serialised state for the multi-program training platform.
 *
 * The app is becoming a PLATFORM that hosts multiple training programs (5/3/1,
 * Tactical Barbell, Green Protocol, …) behind the `@hta/program-core`
 * `ProgramEngine` contract. Each program's serialisable, JSON-round-trippable
 * `Instance` (its config + timeline cursor + program-owned working state, e.g. a
 * 5/3/1 Training Max derived from the shared 1RM) is stored here, one ACTIVE row
 * per user. Switching programs archives the old row; the user's history and
 * strength state (`sessions`, `set_logs`, `training_maxes`) live elsewhere and
 * persist across switches.
 *
 * The materialised plan for an instance is written to `training_blocks` +
 * `planned_sessions` (reusing the existing Today/logging/stats stack); `blockId`
 * links this instance to that block.
 */
import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { trainingBlocks } from "./planner";

/** Lifecycle of a program instance. One 'active' per user; 'archived' on switch. */
export const PROGRAM_INSTANCE_STATUSES = ["active", "archived"] as const;
export type ProgramInstanceStatus = (typeof PROGRAM_INSTANCE_STATUSES)[number];

export const programInstances = pgTable(
  "program_instances",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id").notNull(),
    /** Stable engine id (e.g. "wendler-531", "tactical-barbell", "green-protocol"). */
    programId: text("program_id").notNull(),
    /** Program family for grouping (e.g. "531", "tactical-barbell", "tactical-barbell-green"). */
    programFamily: text("program_family").notNull(),
    /** User-editable name; independent from canonical engine identity. */
    displayName: text("display_name"),
    /** NULL = canonical. Positive value = versioned customization overlay. */
    customizationVersion: smallint("customization_version"),
    /**
     * The engine's serialised `Instance` (program-core). JSON-round-trippable;
     * advanced by the engine's `onSessionLogged` and re-persisted.
     */
    instance: jsonb("instance").notNull(),
    /** The setup-wizard values used to seed the instance (for re-seed / audit). */
    setupInput: jsonb("setup_input"),
    /** The materialised training block this instance drives (Today/logging/stats). */
    blockId: uuid("block_id").references(() => trainingBlocks.id, {
      onDelete: "set null",
    }),
    /** Lifecycle — see PROGRAM_INSTANCE_STATUSES. */
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
    userStatusIdx: index("program_instances_user_status_idx").on(t.userId, t.status),
    customizationVersionCheck: check(
      "program_instances_customization_version_check",
      sql`${t.customizationVersion} IS NULL OR ${t.customizationVersion} > 0`,
    ),
  }),
);

export const programInstanceInsert = createInsertSchema(programInstances);
export const programInstanceSelect = createSelectSchema(programInstances);
export type ProgramInstanceRow = typeof programInstances.$inferSelect;
