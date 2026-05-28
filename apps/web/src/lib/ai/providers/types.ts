/**
 * LlmProvider — provider-agnostic surface for the orchestrator (PR 2).
 *
 * Each concrete adapter (`anthropic.ts`, `openai.ts`, `gemini.ts`)
 * translates the underlying SDK's stream into this normalised
 * `LlmEvent` union. The orchestrator, tool layer, and eval harness
 * consume only these types.
 *
 * ADR 0002 — locked. Do not change shape without a follow-up ADR.
 */

export type LlmTool = {
  name: string;
  description: string;
  /** JSON Schema describing the tool's input arguments. */
  inputSchema: Record<string, unknown>;
};

export type LlmMessage =
  | { role: "user" | "assistant"; content: string }
  | { role: "tool"; toolCallId: string; result: unknown };

export type LlmRequestArgs = {
  system: string;
  messages: LlmMessage[];
  tools: LlmTool[];
  stream: boolean;
};

export type LlmUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_hit?: boolean;
};

export type LlmEvent =
  | { type: "text_delta"; delta: string }
  | { type: "tool_call"; id: string; name: string; args: unknown }
  | { type: "tool_result_ack"; id: string }
  | { type: "done"; usage: LlmUsage };

export type LlmErrorCode =
  | "validation-failed"
  | "llm-unreachable"
  | "llm-timeout"
  | "llm-refused"
  | "rate-limited"
  | "bad-input"
  | "auth-failed"
  | "unknown";

export type LlmResult<T> =
  | { ok: true; data: T; usage?: LlmUsage }
  | { ok: false; errorCode: LlmErrorCode; errors: string[] };

export type LlmProviderName = "anthropic" | "openai" | "gemini";

export interface LlmProvider {
  readonly name: LlmProviderName;
  /**
   * The resolved model ID this provider instance will invoke. Surfaced
   * on the interface so callers (orchestrator hashing, observability
   * rollups, eval cassette filenames) can attribute results to a
   * specific model without re-reading the user's profile.
   */
  readonly model: string;
  chat(args: LlmRequestArgs): AsyncIterable<LlmEvent>;
}

/**
 * Normalise an arbitrary thrown error from a provider SDK into one
 * of our `LlmErrorCode` buckets. Adapters call this when wrapping
 * an SDK exception.
 */
export function classifyProviderError(err: unknown): LlmErrorCode {
  const e = err as
    | { status?: number; code?: string; name?: string; message?: string }
    | undefined;
  const status = typeof e?.status === "number" ? e.status : undefined;
  const message = (e?.message ?? "").toLowerCase();

  if (status === 401 || status === 403) return "auth-failed";
  if (status === 429) return "rate-limited";
  if (status === 400 || status === 422) return "bad-input";
  if (status === 408 || message.includes("timeout") || e?.name === "AbortError")
    return "llm-timeout";
  if (status === 503 || status === 502 || status === 504) return "llm-unreachable";
  if (message.includes("refus") || message.includes("safety")) return "llm-refused";
  if (message.includes("network") || message.includes("fetch failed"))
    return "llm-unreachable";
  return "unknown";
}

/**
 * Thrown by a provider adapter when the underlying SDK call fails.
 * Carries the normalised `LlmErrorCode` so callers can translate to
 * the discriminated-union response contract without re-inspecting the
 * raw error.
 */
export class LlmProviderError extends Error {
  readonly errorCode: LlmErrorCode;
  constructor(errorCode: LlmErrorCode, message: string) {
    super(message);
    this.name = "LlmProviderError";
    this.errorCode = errorCode;
  }
}
