/**
 * Chat orchestrator — Explain v1.
 *
 * Responsibilities:
 *   - Compute the deterministic `prompt_hash` keying the call to the
 *     eval cassette + observability row.
 *   - Drive the provider stream loop: forward text deltas, dispatch
 *     `getEngineSnapshot` server-side when the model emits a tool
 *     call, and continue the conversation with a `role:"tool"`
 *     message so the provider can fold the result into the response.
 *   - Enforce the ADR retry / tool-call caps:
 *       MAX_TOOL_CALLS_PER_TURN = 6
 *       MAX_VALIDATION_RETRIES = 2
 *   - Emit the canonical SSE event shape to the caller's writer.
 *
 * The orchestrator does NOT log raw text; the observability hook is
 * called by the route handler after the turn finishes (it has access
 * to the materialised metadata).
 */
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { buildEngineSnapshot, GET_ENGINE_SNAPSHOT_TOOL } from "./snapshot";
import { SYSTEM_PROMPT } from "./system-prompt";
import type {
  LlmEvent,
  LlmMessage,
  LlmProvider,
  LlmTool,
  LlmUsage,
} from "./providers/types";

export const MAX_TOOL_CALLS_PER_TURN = 6;
export const MAX_VALIDATION_RETRIES = 2;
export const MAX_HISTORY_TOKENS = 32_000;

export type SseEvent =
  | { type: "text_delta"; delta: string }
  | { type: "tool_call_start"; id: string; name: string }
  | { type: "tool_call_end"; id: string }
  | {
      type: "done";
      usage: LlmUsage;
      thread_id: string;
      message_id: string;
    }
  | { type: "error"; errorCode: string; message: string };

export type RunTurnOptions = {
  provider: LlmProvider;
  supabase: SupabaseClient;
  userId: string;
  tz: string;
  threadId: string;
  /** History on disk BEFORE this turn's user message is appended. */
  priorMessages: LlmMessage[];
  /** The new user message text for this turn. */
  userMessage: string;
  /** Stable identifier the route will surface in the final `done` event. */
  assistantMessageId: string;
  onEvent: (event: SseEvent) => void;
  /**
   * Snapshot factory — injected so tests can stub the engine snapshot
   * without standing up the full database. Defaults to the real
   * builder.
   */
  snapshotFactory?: (
    supabase: SupabaseClient,
    userId: string,
    tz: string,
  ) => Promise<unknown>;
};

export type RunTurnResult = {
  assistantText: string;
  toolCalls: Array<{ id: string; name: string; result: unknown }>;
  usage: LlmUsage;
  validationResult: "ok" | "retry-needed" | "failed";
  retryCount: number;
  latencyMs: number;
  promptHash: string;
  errorCode: string | null;
};

const TOOLS: LlmTool[] = [GET_ENGINE_SNAPSHOT_TOOL];

/**
 * Compute the deterministic prompt hash used for cassette pinning and
 * observability rollups. Excludes the random `assistantMessageId` and
 * any timestamps — it's a function of the static system prompt, the
 * tool catalogue, and the materialised message history.
 */
export function computePromptHash(
  system: string,
  messages: LlmMessage[],
  tools: LlmTool[],
): string {
  const payload = JSON.stringify({ system, messages, tools });
  return createHash("sha256").update(payload).digest("hex");
}

/**
 * Approximate token count — 1 token ≈ 4 chars is the canonical rough
 * estimate. v1 does not invoke a real tokenizer (every provider uses
 * a different one); the 32k threshold is a sanity cap, not a billing
 * line.
 */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function messagesTokenCount(messages: LlmMessage[]): number {
  let n = 0;
  for (const m of messages) {
    if (m.role === "tool") n += approxTokens(JSON.stringify(m.result));
    else n += approxTokens(m.content);
  }
  return n;
}

function handleProviderEvent(ev: LlmEvent): {
  text?: string;
  toolCall?: { id: string; name: string };
  usage?: LlmUsage;
} {
  if (ev.type === "text_delta") return { text: ev.delta };
  if (ev.type === "tool_call")
    return { toolCall: { id: ev.id, name: ev.name } };
  if (ev.type === "done") return { usage: ev.usage };
  return {};
}

function providerErrorMessage(code: string): string {
  switch (code) {
    case "rate-limited":
      return "Rate-limited by your provider. Try again in a minute.";
    case "auth-failed":
      return "Your API key was rejected. Re-enter it in Settings → AI.";
    case "llm-timeout":
      return "The provider took too long to respond. Try again.";
    case "llm-unreachable":
      return "Couldn't reach the provider. Check your connection.";
    case "llm-refused":
      return "The provider refused to answer that question.";
    case "bad-input":
      return "The request was malformed. Try rephrasing.";
    default:
      return "Something went wrong reaching the provider.";
  }
}

export async function runChatTurn(
  opts: RunTurnOptions,
): Promise<RunTurnResult> {
  const t0 = Date.now();
  const factory =
    opts.snapshotFactory ??
    ((s: SupabaseClient, u: string, tz: string) =>
      buildEngineSnapshot(s, u, tz));

  const messages: LlmMessage[] = [
    ...opts.priorMessages,
    { role: "user", content: opts.userMessage },
  ];

  if (messagesTokenCount(messages) > MAX_HISTORY_TOKENS) {
    opts.onEvent({
      type: "error",
      errorCode: "history-too-large",
      message:
        "This thread has grown beyond the v1 context budget. Start a new thread to continue.",
    });
    return {
      assistantText: "",
      toolCalls: [],
      usage: { input_tokens: 0, output_tokens: 0 },
      validationResult: "failed",
      retryCount: 0,
      latencyMs: Date.now() - t0,
      promptHash: computePromptHash(SYSTEM_PROMPT, messages, TOOLS),
      errorCode: "history-too-large",
    };
  }

  const promptHash = computePromptHash(SYSTEM_PROMPT, messages, TOOLS);
  let assistantText = "";
  let usage: LlmUsage = { input_tokens: 0, output_tokens: 0 };
  const toolCalls: Array<{ id: string; name: string; result: unknown }> = [];
  let retryCount = 0;
  let toolCallsThisTurn = 0;

  for (let attempt = 0; attempt <= MAX_VALIDATION_RETRIES; attempt++) {
    let textInThisAttempt = 0;
    let toolCallsInThisAttempt = 0;
    let providerErrCode: string | null = null;
    let loopGuard = 0;

    while (loopGuard++ < MAX_TOOL_CALLS_PER_TURN + 2) {
      const pending: Array<{ id: string; name: string }> = [];
      try {
        for await (const ev of opts.provider.chat({
          system: SYSTEM_PROMPT,
          messages,
          tools: TOOLS,
          stream: true,
        })) {
          const out = handleProviderEvent(ev);
          if (out.text) {
            textInThisAttempt += out.text.length;
            assistantText += out.text;
            opts.onEvent({ type: "text_delta", delta: out.text });
          }
          if (out.toolCall) {
            pending.push({ id: out.toolCall.id, name: out.toolCall.name });
            opts.onEvent({
              type: "tool_call_start",
              id: out.toolCall.id,
              name: out.toolCall.name,
            });
          }
          if (out.usage) usage = out.usage;
        }
      } catch (err) {
        providerErrCode =
          (err as { errorCode?: string }).errorCode ?? "llm-unreachable";
        break;
      }

      if (pending.length === 0) break;

      let stopForCap = false;
      for (const tc of pending) {
        if (toolCallsThisTurn >= MAX_TOOL_CALLS_PER_TURN) {
          stopForCap = true;
          break;
        }
        toolCallsThisTurn++;
        toolCallsInThisAttempt++;
        let result: unknown;
        if (tc.name === "getEngineSnapshot") {
          try {
            result = await factory(opts.supabase, opts.userId, opts.tz);
          } catch (err) {
            result = {
              error: "snapshot-failed",
              message: (err as Error).message,
            };
          }
        } else {
          result = { error: "unknown-tool", name: tc.name };
        }
        messages.push({ role: "tool", toolCallId: tc.id, result });
        toolCalls.push({ id: tc.id, name: tc.name, result });
        opts.onEvent({ type: "tool_call_end", id: tc.id });
      }
      if (stopForCap) break;
    }

    if (providerErrCode) {
      opts.onEvent({
        type: "error",
        errorCode: providerErrCode,
        message: providerErrorMessage(providerErrCode),
      });
      return {
        assistantText,
        toolCalls,
        usage,
        validationResult: "failed",
        retryCount,
        latencyMs: Date.now() - t0,
        promptHash,
        errorCode: providerErrCode,
      };
    }

    if (textInThisAttempt > 0 || toolCallsInThisAttempt > 0) {
      opts.onEvent({
        type: "done",
        usage,
        thread_id: opts.threadId,
        message_id: opts.assistantMessageId,
      });
      return {
        assistantText,
        toolCalls,
        usage,
        validationResult: retryCount === 0 ? "ok" : "retry-needed",
        retryCount,
        latencyMs: Date.now() - t0,
        promptHash,
        errorCode: null,
      };
    }
    retryCount++;
  }

  opts.onEvent({
    type: "error",
    errorCode: "validation-failed",
    message:
      "The model didn't return a usable answer. Try rephrasing your question.",
  });
  return {
    assistantText,
    toolCalls,
    usage,
    validationResult: "failed",
    retryCount,
    latencyMs: Date.now() - t0,
    promptHash,
    errorCode: "validation-failed",
  };
}
