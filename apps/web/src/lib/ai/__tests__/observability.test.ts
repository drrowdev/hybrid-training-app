import { describe, expect, it, vi } from "vitest";

const insertMock = vi.fn();
const fromMock = vi.fn(() => ({ insert: insertMock }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: fromMock }),
}));

describe("logLlmCall", () => {
  it("writes a row with the metadata-only shape", async () => {
    insertMock.mockResolvedValueOnce({ error: null });
    const { logLlmCall } = await import("../observability");
    await logLlmCall({
      userId: "user-1",
      provider: "anthropic",
      promptHash: "h".repeat(64),
      toolCalls: [{ name: "getEngineState" }],
      validationResult: "ok",
      retryCount: 0,
      latencyMs: 123,
      usage: { input_tokens: 100, output_tokens: 200 },
      errorCode: null,
    });
    expect(fromMock).toHaveBeenCalledWith("ai_call_logs");
    expect(insertMock).toHaveBeenCalledWith({
      user_id: "user-1",
      provider: "anthropic",
      prompt_hash: "h".repeat(64),
      tool_calls: [{ name: "getEngineState" }],
      validation_result: "ok",
      retry_count: 0,
      latency_ms: 123,
      usage: { input_tokens: 100, output_tokens: 200 },
      error_code: null,
    });
  });

  it("swallows insert errors (best-effort writer)", async () => {
    insertMock.mockResolvedValueOnce({ error: { code: "42P01" } });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { logLlmCall } = await import("../observability");
    await expect(
      logLlmCall({
        userId: "user-1",
        provider: "openai",
        promptHash: "abc",
        toolCalls: null,
        validationResult: "failed",
        retryCount: 2,
        latencyMs: 9999,
        usage: null,
        errorCode: "rate-limited",
      }),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  /**
   * Type-level guardrail. This file is type-checked as part of the
   * normal vitest/tsc run; the functions below are referenced from
   * `void` so they don't execute, but their call sites MUST fail to
   * compile. If a future change loosens the contract, this file
   * stops type-checking and the privacy guardrail goes red.
   */
  async function _typeLevel_rejects_content(): Promise<void> {
    const { logLlmCall } = await import("../observability");
    await logLlmCall(
      // @ts-expect-error — `content` is a forbidden raw-content key
      {
        userId: "u",
        provider: "anthropic",
        promptHash: "h",
        toolCalls: null,
        validationResult: "ok",
        retryCount: 0,
        latencyMs: 1,
        usage: null,
        errorCode: null,
        content: "should not compile",
      },
    );
  }
  async function _typeLevel_rejects_args(): Promise<void> {
    const { logLlmCall } = await import("../observability");
    await logLlmCall(
      // @ts-expect-error — `args` is a forbidden raw-content key
      {
        userId: "u",
        provider: "anthropic",
        promptHash: "h",
        toolCalls: null,
        validationResult: "ok",
        retryCount: 0,
        latencyMs: 1,
        usage: null,
        errorCode: null,
        args: { secret: 1 },
      },
    );
  }
  // Reference the unused locals so eslint/no-unused-vars stays happy.
  void _typeLevel_rejects_content;
  void _typeLevel_rejects_args;
});
