/**
 * Pending program-recommendation reads for the Today banner. Server-only query
 * helper (not a server action) — invoked from the Today server component.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getBlockEditContext } from "./edit-context";

export interface PendingProgramRecommendation {
  id: string;
  kind: string;
  title: string;
  detail: string;
  blockId: string | null;
  data?: Record<string, unknown> | null;
  occurrenceKey?: string | null;
  reviewHref?: string;
}

export async function getPendingProgramRecommendations(
  supabase: Pick<SupabaseClient, "from">,
  userId: string,
  activeBlockIds: readonly string[],
  limit = 3,
): Promise<PendingProgramRecommendation[]> {
  if (activeBlockIds.length === 0) return [];
  const { data, error } = await supabase
    .from("program_recommendations")
    .select("id, kind, title, detail, data, occurrence_key, block_id")
    .eq("user_id", userId)
    .eq("status", "pending")
    .in("block_id", activeBlockIds)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error("Could not read your program recommendations. Try again.");
  return Promise.all((data ?? []).map(async (r) => ({
    id: r.id as string,
    kind: r.kind as string,
    title: r.title as string,
    detail: r.detail as string,
    blockId: (r.block_id as string | null) ?? null,
    data: (r.data as Record<string, unknown> | null) ?? null,
    occurrenceKey: (r.occurrence_key as string | null) ?? null,
    ...(["tm-bump", "tm-test", "tm-reset"].includes(r.kind) ? {
      reviewHref: await getBlockEditContext(r.block_id)
        ? `/app/program?edit=${encodeURIComponent(r.block_id)}`
        : `/app/plan?block=${encodeURIComponent(r.block_id)}`,
    } : {}),
  })));
}
