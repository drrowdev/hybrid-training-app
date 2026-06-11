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
import { jsonb, pgTable, text, timestamp, uuid, index } from "drizzle-orm/pg-core";
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
  }),
);

export const programRecommendationInsert = createInsertSchema(programRecommendations);
export const programRecommendationSelect = createSelectSchema(programRecommendations);
export type ProgramRecommendationRow = typeof programRecommendations.$inferSelect;
