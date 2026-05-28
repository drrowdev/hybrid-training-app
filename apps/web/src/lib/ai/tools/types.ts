/**
 * Shared types for the MCP / in-app tool catalogue.
 *
 * ADR 0003 §"Tool catalogue interface". The catalogue is the single
 * source of truth — both the MCP server route and (after PR B) the
 * in-app orchestrator call the same `handler(input, ctx)` directly.
 *
 * Handlers receive a Supabase client already bound to the caller's
 * RLS context. Tools MUST NEVER instantiate a service-role client.
 *
 * Read-only in v1. No write tools live in this catalogue.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z, ZodType } from "zod";

export type ToolContext = {
  /** Authenticated user id. Tools that filter by user_id MUST use this. */
  readonly userId: string;
  /**
   * Supabase client scoped to the user's RLS context — created by
   * either the MCP bearer-auth adapter or the in-app server client.
   * Tools must never bypass RLS by reaching for a service-role client.
   */
  readonly supabase: SupabaseClient;
  /** IANA timezone for the user (falls back to "UTC"). */
  readonly tz: string;
};

/**
 * The catalogue tool contract. Input/output are Zod schemas so the
 * same definition feeds the MCP SDK's `registerTool` and the in-app
 * orchestrator's tool-list declaration. `outputSchema` exists so the
 * MCP SDK can advertise the response shape to hosts (Claude/ChatGPT
 * surface it in their connector UI).
 */
export type Tool<Input = unknown, Output = unknown> = {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: ZodType<Input>;
  readonly outputSchema: ZodType<Output>;
  handler(input: Input, ctx: ToolContext): Promise<Output>;
};

export type AnyTool = Tool<unknown, unknown>;

/** Helper: derive the input type from a tool's schema. */
export type ToolInput<T> = T extends Tool<infer I, unknown> ? I : never;
/** Helper: derive the output type from a tool's schema. */
export type ToolOutput<T> = T extends Tool<unknown, infer O> ? O : never;

/**
 * Defensive helper for tool handlers that need to bound a numeric
 * parameter from the model. The MCP SDK validates against the Zod
 * schema first, but external clients can pass through edge inputs
 * (NaN, +Infinity) that survive schema parsing under loose configs.
 * Always clamp before using the value in a query.
 */
export function clamp(value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value)) return lo;
  return Math.max(lo, Math.min(hi, Math.floor(value)));
}

export type { z };
