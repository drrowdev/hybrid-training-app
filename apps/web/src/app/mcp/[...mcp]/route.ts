/**
 * MCP server route — single catch-all that delegates JSON-RPC routing
 * to the MCP SDK's Web-Standards Streamable HTTP transport.
 *
 * ADR 0003 §"MCP server route":
 *   - Streamable HTTP transport (spec 2025-06-18). HTTP+SSE is out.
 *   - Stateless across requests: each request rebuilds an `McpServer`
 *     bound to the authenticated user's RLS context.
 *   - The catalogue (`@/lib/ai/tools`) is the single source of truth;
 *     this route is a thin wrapper that registers all 8 tools.
 *
 * Observability: every successful tool call writes a metadata row to
 * `mcp_tool_calls` via `logMcpToolCall` — same privacy contract as
 * `ai_call_logs` (no input args, no output bytes).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { catalogue, type AnyTool, type ToolContext } from "@/lib/ai/tools";
import { requireMcpBearerAuth } from "@/lib/ai/mcp/auth";
import { logMcpToolCall } from "@/lib/ai/mcp/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Builds a fresh McpServer bound to `ctx`. Exported so the smoke test
 * can exercise the same code path the route uses without spinning up
 * an HTTP server. The catalogue is the single source of truth — the
 * smoke test asserts every entry is registered.
 */
export function buildMcpServerForContext(ctx: ToolContext): McpServer {
  const server = new McpServer(
    { name: "hybrid-training", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );
  for (const tool of catalogue) {
    registerTool(server, tool, ctx);
  }
  return server;
}

function registerTool(
  server: McpServer,
  tool: AnyTool,
  ctx: ToolContext,
): void {
  // The MCP SDK overloads `registerTool` with a generic ZodRawShape /
  // AnySchema input. Our catalogue's `Tool<Input, Output>` is more
  // general, so we cast through `unknown` here — the runtime contract
  // is enforced by `tool.inputSchema.parse(...)` inside the callback.
  const handler = async (rawInput: unknown) => {
    const started = Date.now();
    let errorCode: string | null = null;
    let resultBytes = 0;
    try {
      const parsed = tool.inputSchema.parse(rawInput ?? {});
      const output = await tool.handler(parsed, ctx);
      const text = JSON.stringify(output);
      resultBytes = Buffer.byteLength(text, "utf-8");
      return {
        content: [{ type: "text" as const, text }],
      };
    } catch (err) {
      errorCode = (err as { code?: string }).code ?? "tool-error";
      const message = (err as Error).message ?? "Tool handler failed.";
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ error: errorCode, message }),
          },
        ],
      };
    } finally {
      void logMcpToolCall({
        userId: ctx.userId,
        toolName: tool.name,
        latencyMs: Date.now() - started,
        resultSizeBytes: resultBytes,
        errorCode,
      });
    }
  };

  (server.registerTool as unknown as (
    name: string,
    config: {
      description: string;
      inputSchema: unknown;
      outputSchema: unknown;
    },
    cb: (input: unknown) => Promise<unknown>,
  ) => void)(
    tool.name,
    {
      description: tool.description,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
    },
    handler,
  );
}

async function handle(req: Request): Promise<Response> {
  const auth = await requireMcpBearerAuth(req);
  if (!auth.ok) return auth.response;
  const server = buildMcpServerForContext(auth.ctx);
  // Stateless mode: no session id generator. Each request rebuilds
  // server + transport, preserving per-user isolation by construction.
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    await transport.close().catch(() => {});
    await server.close().catch(() => {});
  }
}

export async function GET(req: Request): Promise<Response> {
  return handle(req);
}
export async function POST(req: Request): Promise<Response> {
  return handle(req);
}
export async function DELETE(req: Request): Promise<Response> {
  return handle(req);
}
