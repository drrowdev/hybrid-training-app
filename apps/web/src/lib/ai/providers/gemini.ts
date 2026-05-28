/**
 * Gemini provider — real implementation, never invoked by app routes
 * in PR 1. Uses `generateContentStream` with function declarations.
 *
 * Maps Gemini's chunked response to the canonical `LlmEvent` union:
 *   candidates[0].content.parts[].text             → text_delta
 *   candidates[0].content.parts[].functionCall     → tool_call
 *   final chunk usageMetadata                      → done w/ usage
 */
import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  type LlmEvent,
  type LlmProvider,
  type LlmRequestArgs,
  LlmProviderError,
  classifyProviderError,
} from "./types";

const DEFAULT_MODEL = "gemini-1.5-flash-latest";

type GeminiModelLike = {
  generateContentStream: (args: unknown) => Promise<{
    stream: AsyncIterable<unknown>;
    response: Promise<unknown>;
  }>;
};

type GeminiClientLike = {
  getGenerativeModel: (args: { model: string }) => GeminiModelLike;
};

export class GeminiProvider implements LlmProvider {
  readonly name = "gemini" as const;

  private readonly client: GeminiClientLike;
  private readonly model: string;
  private readonly system: string | undefined;

  constructor(opts: {
    apiKey: string;
    model?: string;
    client?: GeminiClientLike;
  }) {
    this.model = opts.model ?? DEFAULT_MODEL;
    this.client =
      opts.client ??
      (new GoogleGenerativeAI(opts.apiKey) as unknown as GeminiClientLike);
    this.system = undefined;
  }

  async *chat(args: LlmRequestArgs): AsyncIterable<LlmEvent> {
    const model = this.client.getGenerativeModel({ model: this.model });

    const contents: Array<Record<string, unknown>> = [];
    for (const m of args.messages) {
      if (m.role === "tool") {
        contents.push({
          role: "function",
          parts: [
            {
              functionResponse: {
                name: m.toolCallId,
                response: { result: m.result },
              },
            },
          ],
        });
      } else {
        contents.push({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        });
      }
    }

    const tools =
      args.tools.length > 0
        ? [
            {
              functionDeclarations: args.tools.map((t) => ({
                name: t.name,
                description: t.description,
                parameters: t.inputSchema,
              })),
            },
          ]
        : undefined;

    let result: {
      stream: AsyncIterable<unknown>;
      response: Promise<unknown>;
    };
    try {
      result = await model.generateContentStream({
        contents,
        systemInstruction: { role: "system", parts: [{ text: args.system }] },
        tools,
      });
    } catch (err) {
      throw new LlmProviderError(
        classifyProviderError(err),
        "gemini stream open failed",
      );
    }

    const usage = { input_tokens: 0, output_tokens: 0 };

    try {
      for await (const chunk of result.stream) {
        const c = chunk as Record<string, unknown>;
        const candidates = (c.candidates ?? []) as Array<Record<string, unknown>>;
        for (const cand of candidates) {
          const content = (cand.content ?? {}) as Record<string, unknown>;
          const parts = (content.parts ?? []) as Array<Record<string, unknown>>;
          for (const part of parts) {
            if (typeof part.text === "string" && part.text.length > 0) {
              yield { type: "text_delta", delta: part.text };
            }
            const fc = part.functionCall as Record<string, unknown> | undefined;
            if (fc && typeof fc.name === "string") {
              yield {
                type: "tool_call",
                id: String(fc.name),
                name: String(fc.name),
                args: (fc.args ?? {}) as unknown,
              };
            }
          }
        }
        const meta = c.usageMetadata as Record<string, unknown> | undefined;
        if (meta) {
          if (typeof meta.promptTokenCount === "number")
            usage.input_tokens = meta.promptTokenCount;
          if (typeof meta.candidatesTokenCount === "number")
            usage.output_tokens = meta.candidatesTokenCount;
        }
      }
    } catch (err) {
      throw new LlmProviderError(
        classifyProviderError(err),
        "gemini stream failed",
      );
    }

    yield { type: "done", usage };
  }
}
