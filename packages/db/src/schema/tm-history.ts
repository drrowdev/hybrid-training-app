/**
 * tm_history — chronological log of training-max changes.
 *
 * Design: docs/design/prs-and-tm-progression.md
 *
 * Idempotency contract: each automated bump writes a deterministic
 * trigger_key; the partial unique index on (user_id, movement_id,
 * trigger_key) ensures a re-saved set never re-fires a proposal.
 */
import { sql } from "drizzle-orm";
import {
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { sessions } from "./sessions";

export const tmChangeReason = pgEnum("tm_change_reason", [
  "manual",
  "pr_detection",
  "amrap_bump",
  "block_complete",
  "deload",
  "onboarding",
]);

export const tmHistory = pgTable("tm_history", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull(),
  movementId: uuid("movement_id").notNull(),
  oldTmKg: numeric("old_tm_kg", { precision: 6, scale: 2 }),
  newTmKg: numeric("new_tm_kg", { precision: 6, scale: 2 }).notNull(),
  reason: tmChangeReason("reason").notNull(),
  sessionId: uuid("session_id").references(() => sessions.id, { onDelete: "set null" }),
  triggerKey: text("trigger_key"),
  changedAt: timestamp("changed_at", { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
});

export type TmHistoryRow = typeof tmHistory.$inferSelect;
export type NewTmHistoryRow = typeof tmHistory.$inferInsert;
export type TmChangeReason = (typeof tmChangeReason.enumValues)[number];

export const tmHistoryInsert = createInsertSchema(tmHistory);
export const tmHistorySelect = createSelectSchema(tmHistory);
