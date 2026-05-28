import { describe, expect, it } from "vitest";
import { AnthropicProvider } from "../anthropic";
import type { LlmEvent } from "../types";

async function collect(iter: AsyncIterable<LlmEvent>): Promise<LlmEvent[]> {
  const out: LlmEvent[] = [];
  for await (const e of iter) out.push(e);
  return out;
}

function fakeClient(events: unknown[]): {
  messages: {
    stream: (args: unknown) => AsyncIterable<unknown>;
  };
} {
  return {
    messages: {
      stream: () => ({
        async *[Symbol.asyncIterator]() {
          for (const e of events) yield e;
        },
      }),
    },
  };
}

describe("AnthropicProvider event normalization", () => {
  it("emits text_delta from content_block_delta(text_delta)", async () => {
    const client = fakeClient([
      { type: "content_block_start", index: 0, content_block: { type: "text" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello " } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "world" } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", usage: { input_tokens: 5, output_tokens: 7 } },
      { type: "message_stop" },
    ]);
    const p = new AnthropicProvider({ apiKey: "k", client });
    const events = await collect(
      p.chat({ system: "s", messages: [], tools: [], stream: true }),
    );
    expect(events).toEqual([
      { type: "text_delta", delta: "Hello " },
      { type: "text_delta", delta: "world" },
      { type: "done", usage: { input_tokens: 5, output_tokens: 7 } },
    ]);
  });

  it("emits a tool_call after a tool_use block buffers its JSON arg deltas", async () => {
    const client = fakeClient([
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "tu_1", name: "getEngineSnapshot" },
      },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"a":' } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "1}" } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", usage: { input_tokens: 1, output_tokens: 2 } },
      { type: "message_stop" },
    ]);
    const events = await collect(
      new AnthropicProvider({ apiKey: "k", client }).chat({
        system: "s",
        messages: [],
        tools: [],
        stream: true,
      }),
    );
    expect(events).toEqual([
      { type: "tool_call", id: "tu_1", name: "getEngineSnapshot", args: { a: 1 } },
      { type: "done", usage: { input_tokens: 1, output_tokens: 2 } },
    ]);
  });

  it("always emits a done event even when usage is missing", async () => {
    const events = await collect(
      new AnthropicProvider({ apiKey: "k", client: fakeClient([]) }).chat({
        system: "",
        messages: [],
        tools: [],
        stream: true,
      }),
    );
    expect(events[events.length - 1]).toEqual({
      type: "done",
      usage: { input_tokens: 0, output_tokens: 0 },
    });
  });
});
