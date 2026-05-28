/**
 * chat_messages — verbatim per-turn conversation history.
 *
 * One row per message in a thread; the AI orchestrator (PR 2)
 * appends user / assistant / tool messages here. `tool_calls` and
 * `tool_results` are JSONB blobs whose shape mirrors the LlmEvent
 * union at the application layer.
 *
 * RLS: `user_id = auth.uid()`. See migration 0069.
 */
import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export type ChatMessageRole = "user" | "assistant" | "tool";

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    threadId: uuid("thread_id").notNull(),
    userId: uuid("user_id").notNull(),
    role: text("role").$type<ChatMessageRole>().notNull(),
    content: text("content"),
    toolCalls: jsonb("tool_calls").$type<unknown>(),
    toolResults: jsonb("tool_results").$type<unknown>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => ({
    threadCreatedIdx: index("chat_messages_thread_created_idx").on(
      t.threadId,
      t.createdAt,
    ),
  }),
);

export type ChatMessage = typeof chatMessages.$inferSelect;
export type NewChatMessage = typeof chatMessages.$inferInsert;
