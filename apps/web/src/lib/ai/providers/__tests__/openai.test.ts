import { describe, expect, it } from "vitest";
import { OpenAiProvider } from "../openai";
import type { LlmEvent } from "../types";

async function collect(iter: AsyncIterable<LlmEvent>): Promise<LlmEvent[]> {
  const out: LlmEvent[] = [];
  for await (const e of iter) out.push(e);
  return out;
}

function fakeClient(chunks: unknown[]): {
  chat: {
    completions: {
      create: (args: unknown) => Promise<AsyncIterable<unknown>>;
    };
  };
} {
  return {
    chat: {
      completions: {
        create: async () => ({
          async *[Symbol.asyncIterator]() {
            for (const c of chunks) yield c;
          },
        }),
      },
    },
  };
}

describe("OpenAiProvider event normalization", () => {
  it("emits text_delta from delta.content chunks", async () => {
    const client = fakeClient([
      { choices: [{ delta: { content: "Hi " } }] },
      { choices: [{ delta: { content: "there" } }] },
      {
        choices: [{ delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 4 },
      },
    ]);
    const events = await collect(
      new OpenAiProvider({ apiKey: "k", client }).chat({
        system: "s",
        messages: [],
        tools: [],
        stream: true,
      }),
    );
    expect(events).toEqual([
      { type: "text_delta", delta: "Hi " },
      { type: "text_delta", delta: "there" },
      { type: "done", usage: { input_tokens: 10, output_tokens: 4 } },
    ]);
  });

  it("buffers tool_calls deltas and flushes on finish_reason=tool_calls", async () => {
    const client = fakeClient([
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  function: { name: "getEngineSnapshot", arguments: '{"a":' },
                },
              ],
            },
          },
        ],
      },
      {
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, function: { arguments: "2}" } }],
            },
          },
        ],
      },
      {
        choices: [{ delta: {}, finish_reason: "tool_calls" }],
        usage: { prompt_tokens: 5, completion_tokens: 3 },
      },
    ]);
    const events = await collect(
      new OpenAiProvider({ apiKey: "k", client }).chat({
        system: "s",
        messages: [],
        tools: [
          {
            name: "getEngineSnapshot",
            description: "x",
            inputSchema: {},
          },
        ],
        stream: true,
      }),
    );
    expect(events).toContainEqual({
      type: "tool_call",
      id: "call_1",
      name: "getEngineSnapshot",
      args: { a: 2 },
    });
    expect(events[events.length - 1]).toEqual({
      type: "done",
      usage: { input_tokens: 5, output_tokens: 3 },
    });
  });
});
