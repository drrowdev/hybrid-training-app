/**
 * Pending program-recommendation reads for the Today banner. Server-only query
 * helper (not a server action) — invoked from the Today server component.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getBlockEditContext } from "./edit-context";
import { archetypeDisplayName } from "@/lib/planner/queries";

export interface PendingProgramRecommendation {
  id: string;
  kind: string;
  title: string;
  detail: string;
  blockId: string | null;
  data?: Record<string, unknown> | null;
  occurrenceKey?: string | null;
  reviewHref?: string;
  programName?: string;
  programStatus?: "active" | "completed";
  sourceProgramId?: string | null;
}

export async function getPendingProgramRecommendations(
  supabase: Pick<SupabaseClient, "from">,
  userId: string,
  blockIds?: readonly string[],
  limit = 3,
): Promise<PendingProgramRecommendation[]> {
  if (blockIds?.length === 0) return [];
  let blocksQuery = supabase.from("training_blocks")
    .select("id,archetype,notes,status,program_id")
    .eq("user_id", userId).in("status", ["active", "completed"]).is("deleted_at", null);
  if (blockIds) blocksQuery = blocksQuery.in("id", [...blockIds]);
  const blocks = await blocksQuery;
  if (blocks.error) throw new Error("Could not read your program recommendations. Try again.");
  const sources = new Map((blocks.data ?? []).map((block) => [block.id, block]));
  if (sources.size === 0) return [];
  const { data, error } = await supabase
    .from("program_recommendations")
    .select("id, kind, title, detail, data, occurrence_key, block_id")
    .eq("user_id", userId)
    .eq("status", "pending")
    .in("block_id", [...sources.keys()])
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error("Could not read your program recommendations. Try again.");
  return Promise.all((data ?? []).map(async (r) => {
    const source = sources.get(r.block_id);
    if (!source) throw new Error("This recommendation's program is unavailable.");
    return {
      id: r.id as string,
      kind: r.kind as string,
      title: r.title as string,
      detail: r.detail as string,
      blockId: (r.block_id as string | null) ?? null,
      data: (r.data as Record<string, unknown> | null) ?? null,
      occurrenceKey: (r.occurrence_key as string | null) ?? null,
      programName: archetypeDisplayName(source.archetype, source.notes),
      programStatus: source.status as "active" | "completed",
      sourceProgramId: (source.program_id as string | null) ?? null,
      ...(["tm-bump", "tm-test", "tm-reset"].includes(r.kind) ? {
        reviewHref: source.status === "completed" ? `/app/stats/blocks/${encodeURIComponent(r.block_id)}`
          : await getBlockEditContext(r.block_id)
          ? `/app/program?edit=${encodeURIComponent(r.block_id)}`
          : `/app/plan?block=${encodeURIComponent(r.block_id)}`,
      } : {}),
    };
  }));
}
