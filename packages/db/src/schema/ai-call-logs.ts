/**
 * ai_call_logs — per-LLM-call observability.
 *
 * Privacy contract (enforced by the application-layer helper
 * `apps/web/src/lib/ai/observability.ts`): this row never contains
 * raw prompt text, raw tool arguments, or raw assistant response
 * content. Only metadata.
 *
 * `prompt_hash` is the same sha256 the eval harness uses to key
 * cassettes, so production rows grow the replay corpus directly.
 *
 * RLS: `user_id = auth.uid()`. See migration 0069.
 */
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export type AiCallValidationResult = "ok" | "retry-needed" | "failed";

export type AiCallToolCallSummary = {
  name: string;
};

export type AiCallUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_hit?: boolean;
};

export const aiCallLogs = pgTable(
  "ai_call_logs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id").notNull(),
    provider: text("provider").notNull(),
    promptHash: text("prompt_hash").notNull(),
    toolCalls: jsonb("tool_calls").$type<AiCallToolCallSummary[]>(),
    validationResult: text("validation_result")
      .$type<AiCallValidationResult>()
      .notNull(),
    retryCount: smallint("retry_count").notNull().default(0),
    latencyMs: integer("latency_ms").notNull(),
    usage: jsonb("usage").$type<AiCallUsage>(),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => ({
    userCreatedIdx: index("ai_call_logs_user_created_idx").on(
      t.userId,
      t.createdAt,
    ),
  }),
);

export type AiCallLog = typeof aiCallLogs.$inferSelect;
export type NewAiCallLog = typeof aiCallLogs.$inferInsert;
