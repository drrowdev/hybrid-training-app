/**
 * memories — persistent AI-curated facts about the user.
 *
 * The AI orchestrator (PR 2) writes rows here when the model surfaces
 * a fact worth remembering across threads ("I'm prepping for a
 * marathon", "I hate front squats"). 240-char cap at the DB level is
 * a UX guardrail — keeps a memory row a single line in the Settings
 * → AI panel. It is NOT a CP-2 calibration constant.
 *
 * RLS: `user_id = auth.uid()`. See migration 0069.
 */
import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export type MemoryCategory =
  | "preference"
  | "fact"
  | "goal"
  | "constraint"
  | "context";

export const memories = pgTable(
  "memories",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id").notNull(),
    text: text("text").notNull(),
    category: text("category").$type<MemoryCategory>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => ({
    userIdx: index("memories_user_idx").on(t.userId),
  }),
);

export type Memory = typeof memories.$inferSelect;
export type NewMemory = typeof memories.$inferInsert;
