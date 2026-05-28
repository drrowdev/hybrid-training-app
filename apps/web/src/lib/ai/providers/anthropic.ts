/**
 * Anthropic provider — real implementation, never invoked by app
 * routes in PR 1 (no orchestrator wired yet). Tests exercise the
 * event-normalisation path with a mocked SDK.
 *
 * Maps Anthropic's native streaming events to the canonical
 * `LlmEvent` union:
 *   content_block_delta (text_delta)        → text_delta
 *   content_block_start (tool_use)          → buffer until stop
 *   content_block_delta (input_json_delta)  → buffer tool args
 *   content_block_stop  (after tool_use)    → emit tool_call
 *   message_delta + message_stop            → emit done w/ usage
 */
import Anthropic from "@anthropic-ai/sdk";
import {
  type LlmEvent,
  type LlmProvider,
  type LlmRequestArgs,
  LlmProviderError,
  classifyProviderError,
} from "./types";

// Default lives in `./model-catalogue.ts` (getDefaultModel("anthropic")).
// This DEFAULT_MODEL is a hard-coded safety net in case the catalogue
// is somehow not consulted (e.g. unit tests instantiating the
// provider directly without passing `model`). Keep it in sync with the
// catalogue's Recommended-tier entry for anthropic.
const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_MAX_TOKENS = 2048;

type AnthropicLike = {
  messages: {
    stream: (args: unknown) => AsyncIterable<unknown>;
  };
};

export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic" as const;

  private readonly client: AnthropicLike;
  readonly model: string;
  private readonly maxTokens: number;

  constructor(opts: {
    apiKey: string;
    model?: string;
    maxTokens?: number;
    client?: AnthropicLike;
  }) {
    this.model = opts.model ?? DEFAULT_MODEL;
    this.maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.client =
      opts.client ??
      (new Anthropic({ apiKey: opts.apiKey }) as unknown as AnthropicLike);
  }

  async *chat(args: LlmRequestArgs): AsyncIterable<LlmEvent> {
    const messages = args.messages.map((m) => {
      if (m.role === "tool") {
        return {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: m.toolCallId,
              content: JSON.stringify(m.result),
            },
          ],
        };
      }
      return { role: m.role, content: m.content };
    });

    const tools = args.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }));

    let stream: AsyncIterable<unknown>;
    try {
      stream = this.client.messages.stream({
        model: this.model,
        max_tokens: this.maxTokens,
        system: args.system,
        messages,
        tools,
      });
    } catch (err) {
      throw new LlmProviderError(
        classifyProviderError(err),
        "anthropic stream open failed",
      );
    }

    type ToolBuf = { id: string; name: string; jsonText: string };
    const toolBuf = new Map<number, ToolBuf>();
    const usage = { input_tokens: 0, output_tokens: 0 };

    try {
      for await (const ev of stream) {
        const e = ev as Record<string, unknown>;
        const type = e.type as string | undefined;
        if (type === "content_block_start") {
          const idx = e.index as number;
          const block = e.content_block as Record<string, unknown> | undefined;
          if (block?.type === "tool_use") {
            toolBuf.set(idx, {
              id: String(block.id ?? ""),
              name: String(block.name ?? ""),
              jsonText: "",
            });
          }
        } else if (type === "content_block_delta") {
          const idx = e.index as number;
          const delta = e.delta as Record<string, unknown> | undefined;
          if (delta?.type === "text_delta") {
            yield { type: "text_delta", delta: String(delta.text ?? "") };
          } else if (delta?.type === "input_json_delta") {
            const buf = toolBuf.get(idx);
            if (buf) buf.jsonText += String(delta.partial_json ?? "");
          }
        } else if (type === "content_block_stop") {
          const idx = e.index as number;
          const buf = toolBuf.get(idx);
          if (buf) {
            let parsed: unknown = {};
            try {
              parsed = buf.jsonText ? JSON.parse(buf.jsonText) : {};
            } catch {
              parsed = {};
            }
            yield {
              type: "tool_call",
              id: buf.id,
              name: buf.name,
              args: parsed,
            };
            toolBuf.delete(idx);
          }
        } else if (type === "message_delta") {
          const u = e.usage as Record<string, unknown> | undefined;
          if (u) {
            if (typeof u.input_tokens === "number") usage.input_tokens = u.input_tokens;
            if (typeof u.output_tokens === "number")
              usage.output_tokens = u.output_tokens;
          }
        } else if (type === "message_stop") {
          // done emitted after the loop
        }
      }
    } catch (err) {
      throw new LlmProviderError(
        classifyProviderError(err),
        "anthropic stream failed",
      );
    }

    yield { type: "done", usage };
  }
}
