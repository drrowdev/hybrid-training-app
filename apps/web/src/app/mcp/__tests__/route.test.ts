/**
 * MCP route smoke test — boots an `McpServer` in-process via the same
 * `buildMcpServerForContext` helper the route uses, drives a
 * `tools/list` JSON-RPC roundtrip through an in-memory transport
 * pair, and asserts all 10 catalogue tools register.
 *
 * Verification gate from ADR 0003 §"Verification gates" #2 (the
 * Streamable HTTP slice is exercised by the route handler itself in
 * a future Playwright integration test; this lighter-weight smoke
 * test catches catalogue/registration regressions at unit speed).
 */
import { describe, expect, it } from "vitest";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { SupabaseClient } from "@supabase/supabase-js";

import { buildMcpServerForContext } from "../[...mcp]/route";

describe("MCP server route — tools/list", () => {
  it("registers all 10 catalogue tools and answers tools/list", async () => {
    const server = buildMcpServerForContext({
      userId: "smoke-test-user",
      supabase: {} as unknown as SupabaseClient,
      tz: "UTC",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const client = new Client({ name: "smoke", version: "0.0.0" });
    await client.connect(clientTransport);

    const listed = await client.listTools();
    const names = listed.tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "getActiveBlock",
        "getCardioAnalysis",
        "getEngineState",
        "getKnowledge",
        "getMemories",
        "getPrTimeline",
        "getProfile",
        "getRecentSessions",
        "getSessionDetail",
        "getWeeklyAggregates",
      ].sort(),
    );

    await client.close();
    await server.close();
  });
});
