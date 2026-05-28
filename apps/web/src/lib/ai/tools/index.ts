/**
 * Tool catalogue — single source of truth for both the MCP server
 * route and (after PR B) the in-app orchestrator.
 *
 * Order matches ADR 0003 §"Initial 8 tools".
 */
export type { Tool, ToolContext, AnyTool, ToolInput, ToolOutput } from "./types";

import type { AnyTool } from "./types";

import { getProfile } from "./getProfile";
import { getActiveBlock } from "./getActiveBlock";
import { getRecentSessions } from "./getRecentSessions";
import { getWeeklyAggregates } from "./getWeeklyAggregates";
import { getPrTimeline } from "./getPrTimeline";
import { getEngineState } from "./getEngineState";
import { getMemories } from "./getMemories";
import { getKnowledge } from "./getKnowledge";

export {
  getProfile,
  getActiveBlock,
  getRecentSessions,
  getWeeklyAggregates,
  getPrTimeline,
  getEngineState,
  getMemories,
  getKnowledge,
};

/**
 * The 8 tools registered with both surfaces. Adding a tool here adds
 * it to both the MCP route and (post-PR B) the in-app orchestrator —
 * by design.
 */
export const catalogue: readonly AnyTool[] = [
  getProfile as AnyTool,
  getActiveBlock as AnyTool,
  getRecentSessions as AnyTool,
  getWeeklyAggregates as AnyTool,
  getPrTimeline as AnyTool,
  getEngineState as AnyTool,
  getMemories as AnyTool,
  getKnowledge as AnyTool,
] as const;
