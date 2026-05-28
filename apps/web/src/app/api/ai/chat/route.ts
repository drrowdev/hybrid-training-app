/**
 * POST /api/ai/chat — Explain v1 streaming chat endpoint.
 *
 * Auth + access flow:
 *   1. Require sign-in (401 otherwise).
 *   2. Require `hasAiAccess(profile)` (403 otherwise — never silently
 *      degrades; the UI gates the FAB upstream so this branch only
 *      fires if the client is stale).
 *   3. Resolve the user's BYOAI provider; if missing, return 412 so
 *      the UI can prompt them to configure a key.
 *
 * Streaming:
 *   - SSE-format response body. Each event is
 *     `event: <type>\ndata: <json>\n\n`.
 *   - Browsers can't POST with the native EventSource API, so the
 *     client reads the body via `fetch().then(r => r.body.getReader())`
 *     and parses SSE frames itself (see ChatPanel.tsx).
 *
 * Persistence:
 *   - On entry: ensure thread row exists (create if not), insert the
 *     user message.
 *   - On done: insert the assistant message (full content + tool_calls
 *     metadata + tool_results JSON), bump thread updated_at.
 *
 * Observability:
 *   - `logLlmCall()` runs exactly once per turn (metadata only — no
 *     raw content; the privacy contract is type-enforced).
 */
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { hasAiAccess } from "@/lib/ai/access";
import { logLlmCall } from "@/lib/ai/observability";
import { runChatTurn, type SseEvent } from "@/lib/ai/orchestrator";
import { getProviderForUser } from "@/lib/ai/providers/resolver";
import type { LlmMessage } from "@/lib/ai/providers/types";
import { createClient, getAuthUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChatRequestBody = {
  thread_id?: string;
  message?: string;
};

function jsonError(
  status: number,
  errorCode: string,
  message: string,
): Response {
  return NextResponse.json(
    { ok: false, errorCode, errors: [message] },
    { status },
  );
}

function sseFrame(event: SseEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export async function POST(req: Request): Promise<Response> {
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return jsonError(401, "auth-failed", "Sign in to chat.");

  const supabase = await createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "timezone, ai_opt_in_at, byoai_provider, byoai_key_vault_id, byoai_unlocked_at",
    )
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) return jsonError(403, "no-access", "Profile not found.");
  if (
    !hasAiAccess({
      ai_opt_in_at: profile.ai_opt_in_at,
      byoai_provider: profile.byoai_provider,
      byoai_key_vault_id: profile.byoai_key_vault_id,
      byoai_unlocked_at: profile.byoai_unlocked_at,
    })
  ) {
    return jsonError(
      403,
      "no-access",
      "AI is not configured. Enable it in Settings → AI.",
    );
  }

  let body: ChatRequestBody;
  try {
    body = (await req.json()) as ChatRequestBody;
  } catch {
    return jsonError(400, "bad-input", "Body must be JSON.");
  }
  const message = (body.message ?? "").trim();
  if (!message) return jsonError(400, "bad-input", "message is required.");
  if (message.length > 4000)
    return jsonError(400, "bad-input", "message is too long (4000 char cap).");

  let threadId = body.thread_id ?? "";
  if (threadId) {
    const { data: existing } = await supabase
      .from("chat_threads")
      .select("id")
      .eq("id", threadId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!existing) threadId = "";
  }
  if (!threadId) {
    const { data, error } = await supabase
      .from("chat_threads")
      .insert({ user_id: user.id, title: message.slice(0, 60) })
      .select("id")
      .single();
    if (error || !data)
      return jsonError(500, "unknown", "Failed to create chat thread.");
    threadId = data.id as string;
  }

  await supabase.from("chat_messages").insert({
    thread_id: threadId,
    user_id: user.id,
    role: "user",
    content: message,
  });

  const { data: history } = await supabase
    .from("chat_messages")
    .select("role, content, tool_calls, tool_results, created_at")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true });

  const allRows = (history ?? []) as Array<{
    role: "user" | "assistant" | "tool";
    content: string | null;
  }>;
  // Drop the LAST row — it's the user message we just inserted; the
  // orchestrator adds it explicitly to keep the model's view of the
  // conversation consistent.
  const before = allRows.slice(0, -1);
  const priorMessages: LlmMessage[] = [];
  for (const r of before) {
    if (r.role === "user")
      priorMessages.push({ role: "user", content: r.content ?? "" });
    else if (r.role === "assistant")
      priorMessages.push({ role: "assistant", content: r.content ?? "" });
  }

  const provider = await getProviderForUser(user.id);
  if (!provider) {
    return jsonError(
      412,
      "no-access",
      "BYOAI key missing — configure one in Settings → AI.",
    );
  }

  const tz = (profile.timezone as string | null) ?? "UTC";
  const assistantMessageId = randomUUID();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const emit = (ev: SseEvent) => {
        try {
          controller.enqueue(encoder.encode(sseFrame(ev)));
        } catch {
          /* client hung up */
        }
      };

      const result = await runChatTurn({
        provider,
        supabase,
        userId: user.id,
        tz,
        threadId,
        priorMessages,
        userMessage: message,
        assistantMessageId,
        onEvent: emit,
      });

      try {
        await supabase.from("chat_messages").insert({
          id: assistantMessageId,
          thread_id: threadId,
          user_id: user.id,
          role: "assistant",
          content: result.assistantText,
          tool_calls: result.toolCalls.map((t) => ({
            id: t.id,
            name: t.name,
          })),
          tool_results: result.toolCalls.map((t) => ({
            id: t.id,
            result: t.result,
          })),
        });
        await supabase
          .from("chat_threads")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", threadId);
      } catch (err) {
        console.warn("chat persist failed", (err as Error).message);
      }

      await logLlmCall({
        userId: user.id,
        provider: provider.name,
        promptHash: result.promptHash,
        toolCalls: result.toolCalls.map((t) => ({ name: t.name })),
        validationResult: result.validationResult,
        retryCount: result.retryCount,
        latencyMs: result.latencyMs,
        usage: result.usage,
        errorCode:
          result.errorCode === null ? null : normaliseErrorCode(result.errorCode),
      });

      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function normaliseErrorCode(
  code: string,
):
  | "validation-failed"
  | "llm-unreachable"
  | "llm-timeout"
  | "llm-refused"
  | "rate-limited"
  | "bad-input"
  | "auth-failed"
  | "unknown" {
  switch (code) {
    case "validation-failed":
    case "llm-unreachable":
    case "llm-timeout":
    case "llm-refused":
    case "rate-limited":
    case "bad-input":
    case "auth-failed":
      return code;
    case "history-too-large":
      return "bad-input";
    case "no-access":
      return "auth-failed";
    default:
      return "unknown";
  }
}
