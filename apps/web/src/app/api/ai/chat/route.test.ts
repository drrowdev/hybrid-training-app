/**
 * POST /api/ai/chat — verifies the optional `context_session_id` field is
 * accepted and forwarded into `runChatTurn` as `contextSessionId`, and that
 * absent context forwards `undefined` (non-session turns unchanged).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const runChatTurnMock = vi.fn();
const logLlmCallMock = vi.fn(async () => {});
const getProviderForUserMock = vi.fn(async () => ({ name: "anthropic" }));
const getAuthUserMock = vi.fn();
const createClientMock = vi.fn();

vi.mock("@/lib/ai/orchestrator", () => ({
  runChatTurn: runChatTurnMock,
}));
vi.mock("@/lib/ai/observability", () => ({
  logLlmCall: logLlmCallMock,
}));
vi.mock("@/lib/ai/providers/resolver", () => ({
  getProviderForUser: getProviderForUserMock,
}));
vi.mock("@/lib/supabase/server", () => ({
  getAuthUser: getAuthUserMock,
  createClient: createClientMock,
}));

function makeSupabase() {
  const profile = {
    timezone: "UTC",
    byoai_provider: "anthropic",
    byoai_key_vault_id: "v1",
    byoai_unlocked_at: "2026-01-01",
  };
  return {
    from(table: string) {
      const builder = {
        select(_cols?: unknown, _opts?: unknown) {
          return builder;
        },
        eq() {
          return builder;
        },
        gte() {
          // ai_call_logs rate-limit count terminal.
          return Promise.resolve({ count: 0 });
        },
        order() {
          // chat_messages history terminal.
          return Promise.resolve({
            data: [{ role: "user", content: "Why is this programmed?" }],
          });
        },
        maybeSingle() {
          if (table === "profiles") return Promise.resolve({ data: profile });
          if (table === "chat_threads")
            return Promise.resolve({ data: { id: "thread-1" } });
          return Promise.resolve({ data: null });
        },
        insert(_row: unknown) {
          return {
            select() {
              return { single: () => Promise.resolve({ data: { id: "thread-1" } }) };
            },
            then(resolve: (v: unknown) => void) {
              resolve({ data: null, error: null });
            },
          };
        },
        update() {
          return { eq: () => Promise.resolve({ data: null }) };
        },
      };
      return builder;
    },
  };
}

async function drain(res: Response): Promise<void> {
  if (!res.body) return;
  const reader = res.body.getReader();
  for (;;) {
    const { done } = await reader.read();
    if (done) break;
  }
}

describe("POST /api/ai/chat — context_session_id", () => {
  beforeEach(() => {
    runChatTurnMock.mockReset();
    runChatTurnMock.mockImplementation(
      async (opts: {
        onEvent: (e: unknown) => void;
        threadId: string;
        assistantMessageId: string;
      }) => {
        opts.onEvent({
          type: "done",
          usage: { input_tokens: 0, output_tokens: 0 },
          thread_id: opts.threadId,
          message_id: opts.assistantMessageId,
        });
        return {
          assistantText: "ok",
          toolCalls: [],
          usage: { input_tokens: 0, output_tokens: 0 },
          validationResult: "ok",
          retryCount: 0,
          latencyMs: 1,
          promptHash: "deadbeef",
          errorCode: null,
        };
      },
    );
    getAuthUserMock.mockResolvedValue({ data: { user: { id: "u1" } } });
    createClientMock.mockImplementation(async () => makeSupabase());
  });

  it("accepts and forwards context_session_id as contextSessionId", async () => {
    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Why is this workout programmed this way?",
        context_session_id: "sess-xyz",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    await drain(res);
    expect(runChatTurnMock).toHaveBeenCalledTimes(1);
    expect(runChatTurnMock).toHaveBeenCalledWith(
      expect.objectContaining({ contextSessionId: "sess-xyz" }),
    );
  });

  it("forwards undefined context when context_session_id is absent", async () => {
    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Hello" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    await drain(res);
    expect(runChatTurnMock).toHaveBeenCalledTimes(1);
    expect(runChatTurnMock.mock.calls[0]?.[0].contextSessionId).toBeUndefined();
  });
});
