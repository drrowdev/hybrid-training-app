/**
 * chat_threads — one row per AI conversation.
 *
 * ADR 0002 (Explain v1 + BYOAI). RLS: `user_id = auth.uid()` for
 * SELECT / INSERT / UPDATE / DELETE. See migration 0069.
 */
import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const chatThreads = pgTable(
  "chat_threads",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id").notNull(),
    title: text("title"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => ({
    userUpdatedIdx: index("chat_threads_user_updated_idx").on(
      t.userId,
      t.updatedAt,
    ),
  }),
);

export type ChatThread = typeof chatThreads.$inferSelect;
export type NewChatThread = typeof chatThreads.$inferInsert;
