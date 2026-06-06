/**
 * Chat orchestrator — Explain v2 (ADR 0003 PR B).
 *
 * Responsibilities:
 *   - Compute the deterministic `prompt_hash` keying the call to the
 *     eval cassette + observability row.
 *   - Drive the provider stream loop: forward text deltas, dispatch
 *     catalogue tool calls in-process against the user's RLS-scoped
 *     Supabase client, and continue the conversation with a
 *     `role:"tool"` message so the provider can fold the result into
 *     the response.
 *   - Enforce the ADR caps:
 *       MAX_TOOL_CALLS_PER_TURN = 5  (ADR 0003 PR B brief)
 *       MAX_VALIDATION_RETRIES = 2
 *   - Emit the canonical SSE event shape to the caller's writer.
 *
 * The orchestrator does NOT log raw text; the observability hook is
 * called by the route handler after the turn finishes (it has access
 * to the materialised metadata).
 *
 * Tools resolve via direct in-process `tool.handler(input, ctx)`
 * invocation — no HTTP, no MCP layer. The `ToolContext` carries the
 * user's Supabase server-side client, so RLS applies identically to
 * how it does in the rest of the app.
 */
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ZodType, ZodTypeDef } from "zod";

import { catalogue, type AnyTool, type ToolContext } from "./tools";
import { SYSTEM_PROMPT } from "./prompts/system.v2";
import type {
  LlmEvent,
  LlmMessage,
  LlmProvider,
  LlmTool,
  LlmUsage,
} from "./providers/types";

export const MAX_TOOL_CALLS_PER_TURN = 5;
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
  /**
   * Session the user is currently viewing, if any. When set, ONE line is
   * appended to the base v2 system prompt steering the model to call
   * getSessionDetail for "this workout" style questions. When absent, the
   * assembled prompt (and therefore the prompt_hash) is byte-identical to
   * the no-context turn.
   */
  contextSessionId?: string;
  /** Stable identifier the route will surface in the final `done` event. */
  assistantMessageId: string;
  onEvent: (event: SseEvent) => void;
  /**
   * Catalogue override — tests inject a stub catalogue to avoid
   * standing up the full database. Defaults to the real 8-tool
   * catalogue from `./tools`.
   */
  catalogueOverride?: readonly AnyTool[];
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

/**
 * Build the per-turn LlmTool array advertised to the provider. Each
 * tool's Zod input schema is converted to JSON Schema so providers
 * can validate / display it.
 */
export function buildLlmTools(cat: readonly AnyTool[]): LlmTool[] {
  return cat.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: zodToJsonSchema(t.inputSchema),
  }));
}

/**
 * Minimal Zod → JSON Schema converter, scoped to the shapes used by
 * the catalogue (z.object of z.number/z.string with optional + min/max
 * + describe). We avoid pulling in `zod-to-json-schema` because the
 * surface is tiny and the conversion is part of the type-checked
 * contract.
 */
export function zodToJsonSchema(
  schema: ZodType<unknown, ZodTypeDef, unknown>,
): Record<string, unknown> {
  return convertNode(schema as unknown as ZodNode);
}

type ZodNode = {
  _def: {
    typeName: string;
    shape?: () => Record<string, ZodNode>;
    innerType?: ZodNode;
    checks?: Array<{ kind: string; value?: number; inclusive?: boolean }>;
    description?: string;
    values?: readonly string[];
    type?: ZodNode;
    unknownKeys?: "strict" | "passthrough" | "strip";
  };
  description?: string;
};

function convertNode(node: ZodNode): Record<string, unknown> {
  const def = node._def;
  switch (def.typeName) {
    case "ZodObject": {
      const shape = def.shape ? def.shape() : {};
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [key, child] of Object.entries(shape)) {
        properties[key] = convertNode(child);
        if (child._def.typeName !== "ZodOptional") required.push(key);
      }
      const out: Record<string, unknown> = {
        type: "object",
        properties,
        additionalProperties: def.unknownKeys === "passthrough",
      };
      if (required.length > 0) out.required = required;
      return out;
    }
    case "ZodOptional": {
      return def.innerType ? convertNode(def.innerType) : { type: "string" };
    }
    case "ZodNumber": {
      const out: Record<string, unknown> = { type: "number" };
      for (const c of def.checks ?? []) {
        if (c.kind === "int") out.type = "integer";
        else if (c.kind === "min" && typeof c.value === "number")
          out.minimum = c.value;
        else if (c.kind === "max" && typeof c.value === "number")
          out.maximum = c.value;
      }
      if (def.description) out.description = def.description;
      return out;
    }
    case "ZodString": {
      const out: Record<string, unknown> = { type: "string" };
      for (const c of def.checks ?? []) {
        if (c.kind === "min" && typeof c.value === "number") out.minLength = c.value;
        else if (c.kind === "max" && typeof c.value === "number")
          out.maxLength = c.value;
      }
      if (def.description) out.description = def.description;
      return out;
    }
    case "ZodBoolean":
      return { type: "boolean" };
    case "ZodEnum":
      return { type: "string", enum: [...(def.values ?? [])] };
    case "ZodArray":
      return {
        type: "array",
        items: def.type ? convertNode(def.type) : {},
      };
    default:
      return {};
  }
}

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
  toolCall?: { id: string; name: string; args: unknown };
  usage?: LlmUsage;
} {
  if (ev.type === "text_delta") return { text: ev.delta };
  if (ev.type === "tool_call")
    return { toolCall: { id: ev.id, name: ev.name, args: ev.args } };
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
      return "Your provider rejected the request — bad input, or the configured model is unavailable for your account.";
    default:
      return "Something went wrong reaching the provider.";
  }
}

async function dispatchTool(
  tool: AnyTool,
  rawArgs: unknown,
  ctx: ToolContext,
): Promise<unknown> {
  try {
    const parsed = tool.inputSchema.parse(rawArgs ?? {});
    return await tool.handler(parsed, ctx);
  } catch (err) {
    return {
      error: "tool-failed",
      tool: tool.name,
      message: (err as Error).message,
    };
  }
}

export async function runChatTurn(
  opts: RunTurnOptions,
): Promise<RunTurnResult> {
  const t0 = Date.now();
  const cat = opts.catalogueOverride ?? catalogue;
  const toolsByName = new Map<string, AnyTool>();
  for (const t of cat) toolsByName.set(t.name, t);
  const llmTools = buildLlmTools(cat);

  // Per-turn system prompt. With a session in context we append ONE steering
  // line; without it `systemPrompt === SYSTEM_PROMPT` (same reference), so the
  // assembled prompt and the deterministic prompt_hash are byte-identical to
  // the no-context turn.
  const systemPrompt = opts.contextSessionId
    ? `${SYSTEM_PROMPT}\n\nThe user is currently viewing session ${opts.contextSessionId}. When they ask about "this workout", "this session", "today's workout", or why it is programmed this way, call getSessionDetail with sessionId="${opts.contextSessionId}".`
    : SYSTEM_PROMPT;

  const ctx: ToolContext = {
    userId: opts.userId,
    supabase: opts.supabase,
    tz: opts.tz,
  };

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
      promptHash: computePromptHash(systemPrompt, messages, llmTools),
      errorCode: "history-too-large",
    };
  }

  const promptHash = computePromptHash(systemPrompt, messages, llmTools);
  let assistantText = "";
  let usage: LlmUsage = { input_tokens: 0, output_tokens: 0 };
  const toolCalls: Array<{ id: string; name: string; result: unknown }> = [];
  let retryCount = 0;
  let toolCallsThisTurn = 0;
  let capExhausted = false;

  for (let attempt = 0; attempt <= MAX_VALIDATION_RETRIES; attempt++) {
    let textInThisAttempt = 0;
    let toolCallsInThisAttempt = 0;
    let providerErrCode: string | null = null;
    let loopGuard = 0;

    while (loopGuard++ < MAX_TOOL_CALLS_PER_TURN + 2) {
      const pending: Array<{ id: string; name: string; args: unknown }> = [];
      try {
        for await (const ev of opts.provider.chat({
          system: systemPrompt,
          messages,
          tools: llmTools,
          stream: true,
        })) {
          const out = handleProviderEvent(ev);
          if (out.text) {
            textInThisAttempt += out.text.length;
            assistantText += out.text;
            opts.onEvent({ type: "text_delta", delta: out.text });
          }
          if (out.toolCall) {
            pending.push({
              id: out.toolCall.id,
              name: out.toolCall.name,
              args: out.toolCall.args,
            });
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

      if (capExhausted) {
        break;
      }

      for (const tc of pending) {
        if (toolCallsThisTurn >= MAX_TOOL_CALLS_PER_TURN) {
          capExhausted = true;
          break;
        }
        toolCallsThisTurn++;
        toolCallsInThisAttempt++;
        const tool = toolsByName.get(tc.name);
        const result: unknown = tool
          ? await dispatchTool(tool, tc.args, ctx)
          : { error: "unknown-tool", name: tc.name };
        messages.push({ role: "tool", toolCallId: tc.id, result });
        toolCalls.push({ id: tc.id, name: tc.name, result });
        opts.onEvent({ type: "tool_call_end", id: tc.id });
      }
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
      if (capExhausted) {
        const note =
          "\n\n(Tool budget exhausted for this turn — answered with what I had.)";
        assistantText += note;
        opts.onEvent({ type: "text_delta", delta: note });
      }
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
