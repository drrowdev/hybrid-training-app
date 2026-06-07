import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  buildLlmTools,
  computePromptHash,
  MAX_TOOL_CALLS_PER_TURN,
  runChatTurn,
  zodToJsonSchema,
} from "../orchestrator";
import { SYSTEM_PROMPT } from "../prompts/system.v2";
import type { AnyTool } from "../tools";
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

function stubTool<T extends Record<string, unknown>>(
  name: string,
  handler: (input: T) => unknown,
  inputSchema = z.object({}).strict() as unknown as AnyTool["inputSchema"],
): AnyTool {
  return {
    name,
    description: `stub ${name}`,
    inputSchema,
    outputSchema: z.unknown() as unknown as AnyTool["outputSchema"],
    handler: async (input: unknown) =>
      handler(input as T) as unknown as Promise<unknown>,
  } as AnyTool;
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
      catalogueOverride: [],
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

  it("dispatches a catalogue tool in-process when the model requests it", async () => {
    const profileSpy = vi.fn(() => ({ experience_tier: "intermediate" }));
    const tools: AnyTool[] = [stubTool("getProfile", profileSpy)];
    const provider = stubProvider([
      [
        { type: "tool_call", id: "tc-1", name: "getProfile", args: {} },
        { type: "done", usage: { input_tokens: 0, output_tokens: 0 } },
      ],
      [
        { type: "text_delta", delta: "You're an intermediate lifter." },
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
      userMessage: "What kind of lifter am I?",
      assistantMessageId: "a1",
      onEvent: (e) => events.push(e),
      catalogueOverride: tools,
    });
    expect(profileSpy).toHaveBeenCalledTimes(1);
    expect(r.toolCalls).toHaveLength(1);
    expect(r.toolCalls[0]?.name).toBe("getProfile");
    expect(r.toolCalls[0]?.result).toEqual({
      experience_tier: "intermediate",
    });
    expect(r.assistantText).toBe("You're an intermediate lifter.");
    expect(events.map((e) => e.type)).toEqual([
      "tool_call_start",
      "tool_call_end",
      "text_delta",
      "done",
    ]);
  });

  it("parses tool args through the Zod schema and forwards them", async () => {
    const calls: unknown[] = [];
    const schema = z
      .object({ daysBack: z.number().int().min(1).max(90) })
      .strict() as unknown as AnyTool["inputSchema"];
    const tools: AnyTool[] = [
      stubTool(
        "getRecentSessions",
        (input) => {
          calls.push(input);
          return { sessions: [] };
        },
        schema,
      ),
    ];
    const provider = stubProvider([
      [
        {
          type: "tool_call",
          id: "tc-1",
          name: "getRecentSessions",
          args: { daysBack: 14 },
        },
        { type: "done", usage: { input_tokens: 0, output_tokens: 0 } },
      ],
      [
        { type: "text_delta", delta: "ok" },
        { type: "done", usage: { input_tokens: 1, output_tokens: 1 } },
      ],
    ]);
    await runChatTurn({
      provider,
      supabase: fakeSupabase(),
      userId: "u1",
      tz: "UTC",
      threadId: "t1",
      priorMessages: [],
      userMessage: "Show me the last 2 weeks.",
      assistantMessageId: "a1",
      onEvent: () => {},
      catalogueOverride: tools,
    });
    expect(calls).toEqual([{ daysBack: 14 }]);
  });

  it("returns a structured error payload when a handler throws", async () => {
    const tools: AnyTool[] = [
      stubTool("getProfile", () => {
        throw new Error("db down");
      }),
    ];
    const provider = stubProvider([
      [
        { type: "tool_call", id: "tc-1", name: "getProfile", args: {} },
        { type: "done", usage: { input_tokens: 0, output_tokens: 0 } },
      ],
      [
        { type: "text_delta", delta: "couldn't fetch profile" },
        { type: "done", usage: { input_tokens: 1, output_tokens: 1 } },
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
      onEvent: () => {},
      catalogueOverride: tools,
    });
    expect(r.toolCalls[0]?.result).toMatchObject({
      error: "tool-failed",
      tool: "getProfile",
    });
  });

  it("stops dispatching at MAX_TOOL_CALLS_PER_TURN and appends a budget note", async () => {
    const spy = vi.fn(() => ({ ok: true }));
    const tools: AnyTool[] = [stubTool("getProfile", spy)];
    // Emit MAX+2 tool calls in a single stream so the cap clamps mid-loop.
    const overshoot = MAX_TOOL_CALLS_PER_TURN + 2;
    const events: LlmEvent[] = [];
    for (let i = 0; i < overshoot; i++) {
      events.push({
        type: "tool_call",
        id: `tc-${i}`,
        name: "getProfile",
        args: {},
      });
    }
    events.push({ type: "done", usage: { input_tokens: 0, output_tokens: 0 } });
    // Second stream: model gets a synthesis chance after the cap. It tries
    // one more tool call (which we MUST refuse) plus a final text reply.
    const synthesis: LlmEvent[] = [
      { type: "tool_call", id: "tc-late", name: "getProfile", args: {} },
      { type: "text_delta", delta: "Based on what I gathered: ..." },
      { type: "done", usage: { input_tokens: 0, output_tokens: 0 } },
    ];
    const provider = stubProvider([events, synthesis]);
    const r = await runChatTurn({
      provider,
      supabase: fakeSupabase(),
      userId: "u1",
      tz: "UTC",
      threadId: "t1",
      priorMessages: [],
      userMessage: "loop?",
      assistantMessageId: "a1",
      onEvent: () => {},
      catalogueOverride: tools,
    });
    // Cap is enforced — late tool call is refused, spy is not invoked again.
    expect(spy).toHaveBeenCalledTimes(MAX_TOOL_CALLS_PER_TURN);
    expect(r.toolCalls).toHaveLength(MAX_TOOL_CALLS_PER_TURN);
    // The model got a synthesis turn — its text is preserved alongside the note.
    expect(r.assistantText).toMatch(/Based on what I gathered/);
    expect(r.assistantText).toMatch(/tool budget exhausted/i);
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
      catalogueOverride: [],
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
          yield {
            type: "done",
            usage: { input_tokens: 0, output_tokens: 0 },
          } as LlmEvent;
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
      catalogueOverride: [],
    });
    expect(r.errorCode).toBe("rate-limited");
    expect(events.at(-1)?.type).toBe("error");
  });

  it("appends the session-context line to the system prompt when contextSessionId is set", async () => {
    let capturedSystem = "";
    const provider: LlmProvider = {
      name: "anthropic",
      chat(args: LlmRequestArgs): AsyncIterable<LlmEvent> {
        capturedSystem = args.system;
        return (async function* () {
          yield { type: "text_delta", delta: "ok" };
          yield { type: "done", usage: { input_tokens: 1, output_tokens: 1 } };
        })();
      },
    };
    await runChatTurn({
      provider,
      supabase: fakeSupabase(),
      userId: "u1",
      tz: "UTC",
      threadId: "t1",
      priorMessages: [],
      userMessage: "Why is this workout programmed this way?",
      contextSessionId: "sess-123",
      assistantMessageId: "a1",
      onEvent: () => {},
      catalogueOverride: [],
    });
    expect(capturedSystem).toContain(SYSTEM_PROMPT);
    expect(capturedSystem).toContain("currently viewing session sess-123");
    expect(capturedSystem).toContain(
      'call getSessionDetail with sessionId="sess-123"',
    );
  });

  it("leaves the system prompt byte-identical when contextSessionId is absent", async () => {
    let capturedSystem = "";
    const provider: LlmProvider = {
      name: "anthropic",
      chat(args: LlmRequestArgs): AsyncIterable<LlmEvent> {
        capturedSystem = args.system;
        return (async function* () {
          yield { type: "text_delta", delta: "ok" };
          yield { type: "done", usage: { input_tokens: 1, output_tokens: 1 } };
        })();
      },
    };
    await runChatTurn({
      provider,
      supabase: fakeSupabase(),
      userId: "u1",
      tz: "UTC",
      threadId: "t1",
      priorMessages: [],
      userMessage: "Hi",
      assistantMessageId: "a1",
      onEvent: () => {},
      catalogueOverride: [],
    });
    expect(capturedSystem).toBe(SYSTEM_PROMPT);
    expect(capturedSystem).not.toContain("currently viewing session");
  });

  it("precedes each tool result with the assistant tool-call turn (provider contract)", async () => {
    // Regression: a tool result that isn't preceded by the matching assistant
    // tool_use/tool_calls turn is rejected by every provider (400 → "bad
    // input"). The second provider call must see …user, assistant(toolCalls),
    // tool(result).
    let secondCallMessages: LlmRequestArgs["messages"] | null = null;
    let call = 0;
    const provider: LlmProvider = {
      name: "anthropic",
      chat(args: LlmRequestArgs): AsyncIterable<LlmEvent> {
        call += 1;
        if (call === 2) secondCallMessages = args.messages;
        const first = call === 1;
        return (async function* () {
          if (first) {
            yield { type: "tool_call", id: "tc-1", name: "getProfile", args: {} };
          } else {
            yield { type: "text_delta", delta: "done" };
          }
          yield { type: "done", usage: { input_tokens: 1, output_tokens: 1 } };
        })();
      },
    };
    await runChatTurn({
      provider,
      supabase: fakeSupabase(),
      userId: "u1",
      tz: "UTC",
      threadId: "t1",
      priorMessages: [],
      userMessage: "What kind of lifter am I?",
      assistantMessageId: "a1",
      onEvent: () => {},
      catalogueOverride: [stubTool("getProfile", () => ({ tier: "intermediate" }))],
    });

    const msgs = secondCallMessages as LlmRequestArgs["messages"] | null;
    expect(msgs).not.toBeNull();
    const toolIdx = msgs!.findIndex((m) => m.role === "tool");
    expect(toolIdx).toBeGreaterThan(0);
    const prev = msgs![toolIdx - 1]!;
    expect(prev.role).toBe("assistant");
    expect("toolCalls" in prev && prev.toolCalls[0]?.id).toBe("tc-1");
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

describe("orchestrator — buildLlmTools + zodToJsonSchema", () => {
  it("advertises the catalogue's 12 tools when given the real catalogue", async () => {
    const { catalogue } = await import("../tools");
    const tools = buildLlmTools(catalogue);
    expect(tools).toHaveLength(12);
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "getActiveBlock",
        "getBodyweightTrend",
        "getCardioAnalysis",
        "getEngineState",
        "getKnowledge",
        "getLiftProgress",
        "getMemories",
        "getPrTimeline",
        "getProfile",
        "getRecentSessions",
        "getSessionDetail",
        "getWeeklyAggregates",
      ].sort(),
    );
    for (const t of tools) {
      expect(t.inputSchema).toMatchObject({ type: "object" });
    }
  });

  it("converts a daysBack-style schema to JSON Schema with min/max + integer", () => {
    const s = z
      .object({
        daysBack: z
          .number()
          .int()
          .min(1)
          .max(90)
          .describe("Number of past days to include (1-90)."),
      })
      .strict();
    const json = zodToJsonSchema(s);
    expect(json).toMatchObject({
      type: "object",
      properties: {
        daysBack: {
          type: "integer",
          minimum: 1,
          maximum: 90,
        },
      },
      required: ["daysBack"],
      additionalProperties: false,
    });
  });

  it("marks optional strings as non-required", () => {
    const s = z.object({ movement: z.string().min(1).max(120).optional() }).strict();
    const json = zodToJsonSchema(s);
    expect(json).toMatchObject({
      type: "object",
      properties: { movement: { type: "string", minLength: 1, maxLength: 120 } },
      additionalProperties: false,
    });
    expect((json as { required?: string[] }).required).toBeUndefined();
  });
});
