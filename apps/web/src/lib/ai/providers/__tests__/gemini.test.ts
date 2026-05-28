import { describe, expect, it } from "vitest";
import { GeminiProvider } from "../gemini";
import type { LlmEvent } from "../types";

async function collect(iter: AsyncIterable<LlmEvent>): Promise<LlmEvent[]> {
  const out: LlmEvent[] = [];
  for await (const e of iter) out.push(e);
  return out;
}

function fakeClient(chunks: unknown[]) {
  return {
    getGenerativeModel: () => ({
      generateContentStream: async () => ({
        stream: {
          async *[Symbol.asyncIterator]() {
            for (const c of chunks) yield c;
          },
        },
        response: Promise.resolve({}),
      }),
    }),
  };
}

describe("GeminiProvider event normalization", () => {
  it("emits text_delta from candidates[].content.parts[].text", async () => {
    const client = fakeClient([
      { candidates: [{ content: { parts: [{ text: "Hello " }] } }] },
      { candidates: [{ content: { parts: [{ text: "world" }] } }] },
      { usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 6 } },
    ]);
    const events = await collect(
      new GeminiProvider({ apiKey: "k", client }).chat({
        system: "s",
        messages: [],
        tools: [],
        stream: true,
      }),
    );
    expect(events).toEqual([
      { type: "text_delta", delta: "Hello " },
      { type: "text_delta", delta: "world" },
      { type: "done", usage: { input_tokens: 8, output_tokens: 6 } },
    ]);
  });

  it("emits a tool_call for a functionCall part", async () => {
    const client = fakeClient([
      {
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    name: "getEngineSnapshot",
                    args: { window: "90d" },
                  },
                },
              ],
            },
          },
        ],
      },
      { usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } },
    ]);
    const events = await collect(
      new GeminiProvider({ apiKey: "k", client }).chat({
        system: "s",
        messages: [],
        tools: [
          { name: "getEngineSnapshot", description: "x", inputSchema: {} },
        ],
        stream: true,
      }),
    );
    expect(events).toContainEqual({
      type: "tool_call",
      id: "getEngineSnapshot",
      name: "getEngineSnapshot",
      args: { window: "90d" },
    });
    expect(events[events.length - 1]).toEqual({
      type: "done",
      usage: { input_tokens: 1, output_tokens: 1 },
    });
  });
});
