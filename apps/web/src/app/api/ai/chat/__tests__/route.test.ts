/**
 * Chat route — auth + access gates + happy-path persistence.
 *
 * The streaming body is exercised in the orchestrator unit tests;
 * here we focus on the route-shape contract:
 *   - Unsigned-in users get a 401 with `errorCode: auth-failed`.
 *   - Signed-in users without AI access get a 403.
 *   - Signed-in users with access + a configured provider get a 200
 *     SSE stream and a single `logLlmCall` row.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const getAuthUserMock = vi.fn();
const profileMaybeSingle = vi.fn();
const threadInsertSelectSingle = vi.fn();
const threadFetchMaybeSingle = vi.fn();
const messageInsert = vi.fn();
const historySelect = vi.fn();
const updateThread = vi.fn();
const getProviderForUserMock = vi.fn();
const runChatTurnMock = vi.fn();
const logLlmCallMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  getAuthUser: getAuthUserMock,
  createClient: async () => ({
    from(table: string) {
      switch (table) {
        case "profiles":
          return {
            select: () => ({
              eq: () => ({ maybeSingle: profileMaybeSingle }),
            }),
          };
        case "chat_threads":
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({ maybeSingle: threadFetchMaybeSingle }),
              }),
            }),
            insert: () => ({
              select: () => ({ single: threadInsertSelectSingle }),
            }),
            update: () => ({ eq: () => updateThread() }),
          };
        case "chat_messages":
          return {
            insert: (...args: unknown[]) => messageInsert(...args),
            select: () => ({
              eq: () => ({ order: () => historySelect() }),
            }),
          };
        case "ai_call_logs":
          return {
            select: () => ({
              eq: () => ({
                gte: () =>
                  Promise.resolve({ count: 0, data: null, error: null }),
              }),
            }),
          };
        default:
          return {};
      }
    },
  }),
}));

vi.mock("@/lib/ai/providers/resolver", () => ({
  getProviderForUser: getProviderForUserMock,
}));

vi.mock("@/lib/ai/orchestrator", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/ai/orchestrator")
  >("@/lib/ai/orchestrator");
  return {
    ...actual,
    runChatTurn: runChatTurnMock,
  };
});

vi.mock("@/lib/ai/observability", () => ({
  logLlmCall: logLlmCallMock,
}));

beforeEach(() => {
  for (const m of [
    getAuthUserMock,
    profileMaybeSingle,
    threadInsertSelectSingle,
    threadFetchMaybeSingle,
    messageInsert,
    historySelect,
    updateThread,
    getProviderForUserMock,
    runChatTurnMock,
    logLlmCallMock,
  ])
    m.mockReset();
});

async function postChat(body: unknown): Promise<Response> {
  const { POST } = await import("../route");
  const req = new Request("http://localhost/api/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(req);
}

async function readBody(r: Response): Promise<string> {
  const reader = r.body!.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value);
  }
  return out;
}

describe("/api/ai/chat — POST", () => {
  it("rejects unauthenticated callers with 401", async () => {
    getAuthUserMock.mockResolvedValueOnce({ data: { user: null } });
    const r = await postChat({ message: "hi" });
    expect(r.status).toBe(401);
    const json = await r.json();
    expect(json.errorCode).toBe("auth-failed");
  });

  it("rejects users without AI access with 403", async () => {
    getAuthUserMock.mockResolvedValueOnce({
      data: { user: { id: "u1" } },
    });
    profileMaybeSingle.mockResolvedValueOnce({
      data: {
        timezone: "UTC",
        ai_opt_in_at: null,
        byoai_provider: null,
        byoai_key_vault_id: null,
        byoai_unlocked_at: null,
      },
    });
    const r = await postChat({ message: "hi" });
    expect(r.status).toBe(403);
    const json = await r.json();
    expect(json.errorCode).toBe("no-access");
  });

  it("creates a thread, persists messages, and calls logLlmCall exactly once", async () => {
    getAuthUserMock.mockResolvedValueOnce({
      data: { user: { id: "u1" } },
    });
    profileMaybeSingle.mockResolvedValueOnce({
      data: {
        timezone: "UTC",
        ai_opt_in_at: "2026-05-01",
        byoai_provider: "anthropic",
        byoai_key_vault_id: "v1",
        byoai_unlocked_at: "2026-01-01",
      },
    });
    threadInsertSelectSingle.mockResolvedValueOnce({
      data: { id: "thread-1" },
      error: null,
    });
    messageInsert.mockResolvedValue({ data: null, error: null });
    historySelect.mockResolvedValueOnce({
      data: [{ role: "user", content: "hi", tool_calls: null, tool_results: null }],
    });
    getProviderForUserMock.mockResolvedValueOnce({
      name: "anthropic",
      chat: () => ({
        async *[Symbol.asyncIterator]() {
          yield { type: "text_delta", delta: "ok" };
          yield {
            type: "done",
            usage: { input_tokens: 1, output_tokens: 1 },
          };
        },
      }),
    });
    runChatTurnMock.mockImplementation(async (opts) => {
      opts.onEvent({ type: "text_delta", delta: "ok" });
      opts.onEvent({
        type: "done",
        usage: { input_tokens: 5, output_tokens: 2 },
        thread_id: "thread-1",
        message_id: "asst-1",
      });
      return {
        assistantText: "ok",
        toolCalls: [{ id: "tc1", name: "getEngineSnapshot", result: {} }],
        usage: { input_tokens: 5, output_tokens: 2 },
        validationResult: "ok",
        retryCount: 0,
        latencyMs: 42,
        promptHash: "deadbeef",
        errorCode: null,
      };
    });

    const r = await postChat({ message: "hi" });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/event-stream");
    const body = await readBody(r);
    expect(body).toContain("event: text_delta");
    expect(body).toContain("event: done");

    // The user message + the assistant message — two inserts.
    expect(messageInsert).toHaveBeenCalledTimes(2);
    const assistantInsert = messageInsert.mock.calls.at(-1)?.[0] as Record<
      string,
      unknown
    >;
    expect(assistantInsert.role).toBe("assistant");
    expect(assistantInsert.content).toBe("ok");
    expect((assistantInsert.tool_calls as Array<{ name: string }>)[0].name).toBe(
      "getEngineSnapshot",
    );

    // logLlmCall is the privacy contract — exactly once, metadata only.
    expect(logLlmCallMock).toHaveBeenCalledTimes(1);
    const call = logLlmCallMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(call).toMatchObject({
      userId: "u1",
      provider: "anthropic",
      promptHash: "deadbeef",
      validationResult: "ok",
      retryCount: 0,
    });
    expect((call.toolCalls as Array<{ name: string }>)[0]).toEqual({
      name: "getEngineSnapshot",
    });
    // Verify forbidden raw-content fields are NOT present.
    for (const key of [
      "content",
      "args",
      "messages",
      "text",
      "response_text",
      "prompt",
      "response",
    ]) {
      expect(call[key]).toBeUndefined();
    }
  });

  it("rejects with 429 when the user is over the per-hour rate limit", async () => {
    // Override the ai_call_logs mock for this test to return a count
    // at the cap. The default mock returns 0; we need to inject a high
    // count without rewriting the createClient mock.
    getAuthUserMock.mockResolvedValueOnce({
      data: { user: { id: "u1" } },
    });
    profileMaybeSingle.mockResolvedValueOnce({
      data: {
        timezone: "UTC",
        ai_opt_in_at: "2026-05-01",
        byoai_provider: "anthropic",
        byoai_key_vault_id: "v1",
        byoai_unlocked_at: "2026-01-01",
      },
    });
    // Re-import the route with a fresh module cache so we can swap the
    // supabase mock for one row of `ai_call_logs` that returns count=60.
    vi.resetModules();
    vi.doMock("@/lib/supabase/server", () => ({
      getAuthUser: getAuthUserMock,
      createClient: async () => ({
        from(table: string) {
          if (table === "profiles") {
            return {
              select: () => ({
                eq: () => ({ maybeSingle: profileMaybeSingle }),
              }),
            };
          }
          if (table === "ai_call_logs") {
            return {
              select: () => ({
                eq: () => ({
                  gte: () =>
                    Promise.resolve({ count: 60, data: null, error: null }),
                }),
              }),
            };
          }
          return {};
        },
      }),
    }));
    const { POST } = await import("../route");
    const r = await POST(
      new Request("http://localhost/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hi" }),
      }),
    );
    expect(r.status).toBe(429);
    const json = await r.json();
    expect(json.errorCode).toBe("rate-limited");
    vi.doUnmock("@/lib/supabase/server");
  });
});
