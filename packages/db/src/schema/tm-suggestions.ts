/**
 * tm_suggestions — pending TM bumps surfaced to the user after a heavy AMRAP.
 *
 * The engine never auto-writes a TM. After a session is completed with an
 * AMRAP top set whose conservative e1RM beats the current TM by ≥ 2.5 kg,
 * a row lands here with status='pending'. The Today hero renders a banner
 * with Accept / Dismiss. Accept rewrites training_maxes (source='derived_*')
 * and marks the row 'accepted'; Dismiss flips to 'dismissed'.
 */
import { sql } from "drizzle-orm";
import {
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { movements } from "./movements";
import { sessions } from "./sessions";
import { setLogs } from "./set-logs";

export const TM_SUGGESTION_STATUSES = ["pending", "accepted", "dismissed"] as const;
export type TmSuggestionStatus = (typeof TM_SUGGESTION_STATUSES)[number];

export const tmSuggestions = pgTable(
  "tm_suggestions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id").notNull(),
    movementId: uuid("movement_id")
      .notNull()
      .references(() => movements.id, { onDelete: "cascade" }),
    currentTmKg: numeric("current_tm_kg", { precision: 6, scale: 2 }),
    suggestedTmKg: numeric("suggested_tm_kg", { precision: 6, scale: 2 }).notNull(),
    source: text("source").notNull().default("derived_amrap"),
    derivedFromSessionId: uuid("derived_from_session_id").references(
      () => sessions.id,
      { onDelete: "set null" },
    ),
    derivedFromSetLogId: uuid("derived_from_set_log_id").references(
      () => setLogs.id,
      { onDelete: "set null" },
    ),
    derivedFormula: text("derived_formula"),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => ({
    userStatusIdx: index("tm_suggestions_user_status_idx").on(
      t.userId,
      t.status,
      t.createdAt,
    ),
    userMovementIdx: index("tm_suggestions_user_movement_idx").on(
      t.userId,
      t.movementId,
    ),
  }),
);

export const tmSuggestionInsert = createInsertSchema(tmSuggestions);
export const tmSuggestionSelect = createSelectSchema(tmSuggestions);

export type TmSuggestion = typeof tmSuggestions.$inferSelect;
export type NewTmSuggestion = typeof tmSuggestions.$inferInsert;
