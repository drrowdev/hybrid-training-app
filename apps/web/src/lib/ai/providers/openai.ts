/**
 * OpenAI provider — real implementation, never invoked by app routes
 * in PR 1. Chat Completions API with tools + streaming.
 *
 * Maps OpenAI's native streaming chunks to the canonical `LlmEvent`
 * union:
 *   delta.content                 → text_delta
 *   delta.tool_calls[].function   → buffer per index
 *   finish_reason: "tool_calls"   → flush buffered tool_calls
 *   finish_reason: "stop"         → done
 *   chunk.usage                   → carried into done
 */
import OpenAI from "openai";
import {
  type LlmEvent,
  type LlmProvider,
  type LlmRequestArgs,
  LlmProviderError,
  classifyProviderError,
} from "./types";

// Default lives in `./model-catalogue.ts` (getDefaultModel("openai")).
// This DEFAULT_MODEL is a hard-coded safety net in case the catalogue
// is somehow not consulted (e.g. unit tests instantiating the
// provider directly without passing `model`). Keep it in sync with the
// catalogue's Recommended-tier entry for openai.
const DEFAULT_MODEL = "gpt-5.1";

type OpenAiLike = {
  chat: {
    completions: {
      create: (args: unknown) => Promise<AsyncIterable<unknown>>;
    };
  };
};

export class OpenAiProvider implements LlmProvider {
  readonly name = "openai" as const;

  private readonly client: OpenAiLike;
  readonly model: string;

  constructor(opts: { apiKey: string; model?: string; client?: OpenAiLike }) {
    this.model = opts.model ?? DEFAULT_MODEL;
    this.client =
      opts.client ?? (new OpenAI({ apiKey: opts.apiKey }) as unknown as OpenAiLike);
  }

  async *chat(args: LlmRequestArgs): AsyncIterable<LlmEvent> {
    const messages: Array<Record<string, unknown>> = [
      { role: "system", content: args.system },
    ];
    for (const m of args.messages) {
      if (m.role === "tool") {
        messages.push({
          role: "tool",
          tool_call_id: m.toolCallId,
          content: JSON.stringify(m.result),
        });
      } else {
        messages.push({ role: m.role, content: m.content });
      }
    }

    const tools = args.tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }));

    let stream: AsyncIterable<unknown>;
    try {
      stream = await this.client.chat.completions.create({
        model: this.model,
        messages,
        tools: tools.length > 0 ? tools : undefined,
        tool_choice: tools.length > 0 ? "auto" : undefined,
        stream: true,
        stream_options: { include_usage: true },
      });
    } catch (err) {
      throw new LlmProviderError(
        classifyProviderError(err),
        "openai stream open failed",
      );
    }

    type ToolBuf = { id: string; name: string; jsonText: string };
    const toolBuf = new Map<number, ToolBuf>();
    const usage = { input_tokens: 0, output_tokens: 0 };
    let flushed = false;

    const flushToolCalls = (): LlmEvent[] => {
      const out: LlmEvent[] = [];
      const indices = Array.from(toolBuf.keys()).sort((a, b) => a - b);
      for (const idx of indices) {
        const buf = toolBuf.get(idx)!;
        let parsed: unknown = {};
        try {
          parsed = buf.jsonText ? JSON.parse(buf.jsonText) : {};
        } catch {
          parsed = {};
        }
        out.push({ type: "tool_call", id: buf.id, name: buf.name, args: parsed });
      }
      toolBuf.clear();
      return out;
    };

    try {
      for await (const chunk of stream) {
        const c = chunk as Record<string, unknown>;
        const choices = (c.choices ?? []) as Array<Record<string, unknown>>;
        const choice = choices[0];
        const u = c.usage as Record<string, unknown> | undefined;
        if (u) {
          if (typeof u.prompt_tokens === "number") usage.input_tokens = u.prompt_tokens;
          if (typeof u.completion_tokens === "number")
            usage.output_tokens = u.completion_tokens;
        }
        if (!choice) continue;
        const delta = (choice.delta ?? {}) as Record<string, unknown>;
        if (typeof delta.content === "string" && delta.content.length > 0) {
          yield { type: "text_delta", delta: delta.content };
        }
        const tcs = delta.tool_calls as Array<Record<string, unknown>> | undefined;
        if (Array.isArray(tcs)) {
          for (const tc of tcs) {
            const idx = (tc.index as number) ?? 0;
            const fn = (tc.function ?? {}) as Record<string, unknown>;
            const buf = toolBuf.get(idx) ?? { id: "", name: "", jsonText: "" };
            if (typeof tc.id === "string" && tc.id) buf.id = tc.id;
            if (typeof fn.name === "string" && fn.name) buf.name = fn.name;
            if (typeof fn.arguments === "string") buf.jsonText += fn.arguments;
            toolBuf.set(idx, buf);
          }
        }
        const finish = choice.finish_reason as string | undefined;
        if (finish === "tool_calls" && !flushed) {
          flushed = true;
          for (const ev of flushToolCalls()) yield ev;
        }
      }
    } catch (err) {
      throw new LlmProviderError(
        classifyProviderError(err),
        "openai stream failed",
      );
    }

    if (!flushed && toolBuf.size > 0) {
      for (const ev of flushToolCalls()) yield ev;
    }
    yield { type: "done", usage };
  }
}
