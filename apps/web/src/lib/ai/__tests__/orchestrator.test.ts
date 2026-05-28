import { describe, expect, it, vi } from "vitest";

import { computePromptHash, runChatTurn } from "../orchestrator";
import type {
  LlmEvent,
  LlmProvider,
  LlmRequestArgs,
} from "../providers/types";

function stubProvider(streams: LlmEvent[][]): LlmProvider {
  let call = 0;
  return {
    name: "anthropic",
    chat(_args: LlmRequestArgs): AsyncIterable<LlmEvent> {
      const events = streams[call++] ?? [];
      return (async function* () {
        for (const ev of events) yield ev;
      })();
    },
  };
}

function fakeSupabase() {
  return {} as unknown as Parameters<typeof runChatTurn>[0]["supabase"];
}

describe("orchestrator — runChatTurn", () => {
  it("forwards text deltas and emits a done event", async () => {
    const events: Array<{ type: string }> = [];
    const provider = stubProvider([
      [
        { type: "text_delta", delta: "Hello" },
        { type: "text_delta", delta: ", world." },
        { type: "done", usage: { input_tokens: 12, output_tokens: 3 } },
      ],
    ]);
    const r = await runChatTurn({
      provider,
      supabase: fakeSupabase(),
      userId: "u1",
      tz: "UTC",
      threadId: "t1",
      priorMessages: [],
      userMessage: "Hi",
      assistantMessageId: "a1",
      onEvent: (e) => events.push(e),
    });
    expect(r.assistantText).toBe("Hello, world.");
    expect(r.validationResult).toBe("ok");
    expect(r.usage).toEqual({ input_tokens: 12, output_tokens: 3 });
    expect(events.map((e) => e.type)).toEqual([
      "text_delta",
      "text_delta",
      "done",
    ]);
  });

  it("dispatches getEngineSnapshot server-side when the model requests it", async () => {
    const snapshotFactory = vi.fn(async () => ({ stubbed: true }));
    const provider = stubProvider([
      [
        {
          type: "tool_call",
          id: "tc-1",
          name: "getEngineSnapshot",
          args: {},
        },
        { type: "done", usage: { input_tokens: 0, output_tokens: 0 } },
      ],
      [
        { type: "text_delta", delta: "Here's what I found." },
        { type: "done", usage: { input_tokens: 1000, output_tokens: 7 } },
      ],
    ]);
    const events: Array<{ type: string }> = [];
    const r = await runChatTurn({
      provider,
      supabase: fakeSupabase(),
      userId: "u1",
      tz: "UTC",
      threadId: "t1",
      priorMessages: [],
      userMessage: "What's up?",
      assistantMessageId: "a1",
      onEvent: (e) => events.push(e),
      snapshotFactory,
    });
    expect(snapshotFactory).toHaveBeenCalledTimes(1);
    expect(r.toolCalls).toHaveLength(1);
    expect(r.toolCalls[0]?.name).toBe("getEngineSnapshot");
    expect(r.assistantText).toBe("Here's what I found.");
    expect(events.map((e) => e.type)).toEqual([
      "tool_call_start",
      "tool_call_end",
      "text_delta",
      "done",
    ]);
  });

  it("retries on empty turns and surfaces validation-failed after the cap", async () => {
    const events: Array<{ type: string }> = [];
    const provider = stubProvider([
      [{ type: "done", usage: { input_tokens: 0, output_tokens: 0 } }],
      [{ type: "done", usage: { input_tokens: 0, output_tokens: 0 } }],
      [{ type: "done", usage: { input_tokens: 0, output_tokens: 0 } }],
    ]);
    const r = await runChatTurn({
      provider,
      supabase: fakeSupabase(),
      userId: "u1",
      tz: "UTC",
      threadId: "t1",
      priorMessages: [],
      userMessage: "Hi",
      assistantMessageId: "a1",
      onEvent: (e) => events.push(e),
    });
    expect(r.validationResult).toBe("failed");
    expect(r.errorCode).toBe("validation-failed");
    expect(r.retryCount).toBe(3);
    expect(events.at(-1)?.type).toBe("error");
  });

  it("surfaces provider errors verbatim", async () => {
    const provider: LlmProvider = {
      name: "anthropic",
      chat(_args) {
        return (async function* () {
          const err = Object.assign(new Error("boom"), {
            errorCode: "rate-limited",
          });
          throw err;
          yield { type: "done", usage: { input_tokens: 0, output_tokens: 0 } } as LlmEvent;
        })();
      },
    };
    const events: Array<{ type: string }> = [];
    const r = await runChatTurn({
      provider,
      supabase: fakeSupabase(),
      userId: "u1",
      tz: "UTC",
      threadId: "t1",
      priorMessages: [],
      userMessage: "Hi",
      assistantMessageId: "a1",
      onEvent: (e) => events.push(e),
    });
    expect(r.errorCode).toBe("rate-limited");
    expect(events.at(-1)?.type).toBe("error");
  });

  it("computePromptHash is stable and deterministic", () => {
    const h1 = computePromptHash("sys", [{ role: "user", content: "x" }], []);
    const h2 = computePromptHash("sys", [{ role: "user", content: "x" }], []);
    const h3 = computePromptHash("sys", [{ role: "user", content: "y" }], []);
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });
});
