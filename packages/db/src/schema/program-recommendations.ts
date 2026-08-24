/**
 * program_recommendations — program-owned nudges surfaced after a logged session.
 *
 * A program engine's `onSessionLogged` returns recommendations (retest your
 * maxes, start your next block, a 7th-week TM verdict, …). They are SURFACED to
 * the user and never auto-applied. They don't fit `tm_suggestions` (which is
 * specifically movement-scoped TM bumps) — this is the generic home. Purely
 * informational: the user dismisses them; any actual TM change still flows
 * through `tm_suggestions`.
 */
import { sql } from "drizzle-orm";
import { jsonb, pgTable, text, timestamp, uuid, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { programInstances } from "./program-instances";
import { trainingBlocks } from "./planner";
import { sessions } from "./sessions";

/** Lifecycle of a recommendation. */
export const PROGRAM_RECOMMENDATION_STATUSES = ["pending", "accepted", "dismissed"] as const;
export type ProgramRecommendationStatus = (typeof PROGRAM_RECOMMENDATION_STATUSES)[number];

export const programRecommendations = pgTable(
  "program_recommendations",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id").notNull(),
    programInstanceId: uuid("program_instance_id").references(() => programInstances.id, {
      onDelete: "cascade",
    }),
    blockId: uuid("block_id").references(() => trainingBlocks.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").references(() => sessions.id, { onDelete: "set null" }),
    /** Engine recommendation kind (deload | tm-test | tm-bump | tm-reset | next-block | info). */
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    detail: text("detail").notNull(),
    /** Optional structured payload from the engine recommendation. */
    data: jsonb("data"),
    /**
     * Which occurrence of `kind` this row is for within the plan — e.g. the
     * engine block whose peak week raised it. One `training_blocks` row holds
     * every engine block of an instance, so without this a plan could raise
     * each kind exactly once however many blocks it ran. '' means the plan
     * raises this kind once, which is every row written before migration 0135.
     */
    occurrenceKey: text("occurrence_key").notNull().default(""),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => ({
    userStatusIdx: index("program_recommendations_user_status_idx").on(
      t.userId,
      t.status,
      t.createdAt,
    ),
    // Idempotency guard (migrations 0105, 0135) — one recommendation of each
    // kind PER OCCURRENCE per block; makes the completion hook's upsert a safe
    // no-op under races. `occurrence_key` is NOT NULL because two NULLs are
    // distinct to a Postgres unique index (letting the duplicate-insert race
    // back in), and because an expression index over COALESCE cannot serve as
    // the ON CONFLICT arbiter for the plain column list PostgREST sends.
    userBlockKindOccurrenceUnique: uniqueIndex(
      "program_recommendations_user_block_kind_occurrence_unique",
    ).on(t.userId, t.blockId, t.kind, t.occurrenceKey),
  }),
);

export const programRecommendationInsert = createInsertSchema(programRecommendations);
export const programRecommendationSelect = createSelectSchema(programRecommendations);
export type ProgramRecommendationRow = typeof programRecommendations.$inferSelect;
