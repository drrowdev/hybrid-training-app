/**
 * logLlmCall — observability writer for `ai_call_logs`.
 *
 * Privacy contract (ADR 0002 § Privacy): this function MUST NEVER
 * receive raw prompt text, raw tool args, raw assistant response
 * text, or any other content field. The TypeScript input type below
 * lists the only allowed keys; any object containing a forbidden key
 * fails to compile.
 *
 * If a future refactor ever accidentally passes `content` / `args` /
 * `messages` / `text` / `response_text` through, the diagnostic
 * surfaces immediately as a TS2353 "Object literal may only specify
 * known properties" error. There is no runtime escape hatch.
 */
import { createClient } from "@/lib/supabase/server";
import type { LlmErrorCode, LlmUsage } from "./providers/types";

export type LogLlmCallInput = {
  userId: string;
  provider: string;
  promptHash: string;
  toolCalls: Array<{ name: string }> | null;
  validationResult: "ok" | "retry-needed" | "failed";
  retryCount: number;
  latencyMs: number;
  usage: LlmUsage | null;
  errorCode: LlmErrorCode | null;
};

/**
 * Type-level guard: any object that contains a forbidden raw-content
 * key fails the exact-match against `LogLlmCallInput`. Forbidden
 * keys are listed verbatim so the TS error message names them.
 */
type ForbiddenContentKey =
  | "content"
  | "args"
  | "messages"
  | "text"
  | "response_text"
  | "prompt"
  | "response";

type RejectIfContainsContent<T> = Extract<keyof T, ForbiddenContentKey> extends never
  ? T
  : "ERROR: raw content fields are forbidden in ai_call_logs";

export async function logLlmCall<T extends LogLlmCallInput>(
  input: T & RejectIfContainsContent<T>,
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("ai_call_logs").insert({
    user_id: input.userId,
    provider: input.provider,
    prompt_hash: input.promptHash,
    tool_calls: input.toolCalls,
    validation_result: input.validationResult,
    retry_count: input.retryCount,
    latency_ms: input.latencyMs,
    usage: input.usage,
    error_code: input.errorCode,
  });
  if (error) {
    // Observability writes are best-effort: failing the whole turn
    // because logging failed would itself be a privacy hazard
    // (forces the orchestrator to surface error details). Swallow
    // and console.warn — the row is missing, but the call completed.
    console.warn("logLlmCall: insert failed", { code: error.code });
  }
}
