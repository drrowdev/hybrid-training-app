/**
 * getMemories — persistent AI-curated memories for the current user.
 *
 * Data source: `memories WHERE user_id = auth.uid()`, ordered most
 * recent first, capped at 100.
 */
import { z } from "zod";
import type { Tool } from "./types";

const memorySchema = z.object({
  category: z.string(),
  text: z.string(),
  created_at: z.string(),
});

const outputSchema = z.object({
  memories: z.array(memorySchema),
});

const inputSchema = z.object({}).strict();

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

const MAX_MEMORIES = 100;

export const getMemories: Tool<Input, Output> = {
  name: "getMemories",
  description:
    "Returns the user's stored memories — short persistent facts, preferences, goals, or constraints curated for the AI assistant.",
  inputSchema,
  outputSchema,
  async handler(_input, ctx) {
    const { data } = await ctx.supabase
      .from("memories")
      .select("category, text, created_at")
      .eq("user_id", ctx.userId)
      .order("created_at", { ascending: false })
      .limit(MAX_MEMORIES);

    const rows = (data ?? []) as Array<{
      category: string;
      text: string;
      created_at: string;
    }>;

    return {
      memories: rows.map((r) => ({
        category: r.category,
        text: r.text,
        created_at: r.created_at,
      })),
    };
  },
};
