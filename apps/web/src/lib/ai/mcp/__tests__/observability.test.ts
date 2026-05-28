import { describe, expect, it } from "vitest";

describe("logMcpToolCall - type-level no-raw-content guard", () => {
  async function _typeLevel_rejects_args(): Promise<void> {
    const { logMcpToolCall } = await import("../observability");
    await logMcpToolCall(
      // @ts-expect-error - `args` is a forbidden raw-content key
      {
        userId: "u",
        toolName: "getProfile",
        latencyMs: 1,
        resultSizeBytes: 0,
        errorCode: null,
        args: { secret: 1 },
      },
    );
  }
  async function _typeLevel_rejects_output(): Promise<void> {
    const { logMcpToolCall } = await import("../observability");
    await logMcpToolCall(
      // @ts-expect-error - `output` is a forbidden raw-content key
      {
        userId: "u",
        toolName: "getProfile",
        latencyMs: 1,
        resultSizeBytes: 0,
        errorCode: null,
        output: { full: "user data" },
      },
    );
  }
  async function _typeLevel_rejects_result(): Promise<void> {
    const { logMcpToolCall } = await import("../observability");
    await logMcpToolCall(
      // @ts-expect-error - `result` is a forbidden raw-content key
      {
        userId: "u",
        toolName: "getProfile",
        latencyMs: 1,
        resultSizeBytes: 0,
        errorCode: null,
        result: "raw",
      },
    );
  }
  void _typeLevel_rejects_args;
  void _typeLevel_rejects_output;
  void _typeLevel_rejects_result;

  it("guard exists (compile-time assertions above)", () => {
    expect(true).toBe(true);
  });
});