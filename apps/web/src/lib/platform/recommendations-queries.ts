/**
 * Pending program-recommendation reads for the Today banner. Server-only query
 * helper (not a server action) — invoked from the Today server component.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface PendingProgramRecommendation {
  id: string;
  kind: string;
  title: string;
  detail: string;
  data?: Record<string, unknown> | null;
  occurrenceKey?: string | null;
}

export async function getPendingProgramRecommendations(
  supabase: Pick<SupabaseClient, "from">,
  userId: string,
  limit = 3,
): Promise<PendingProgramRecommendation[]> {
  const { data } = await supabase
    .from("program_recommendations")
    .select("id, kind, title, detail, data, occurrence_key")
    .eq("user_id", userId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    kind: r.kind as string,
    title: r.title as string,
    detail: r.detail as string,
    data: (r.data as Record<string, unknown> | null) ?? null,
    occurrenceKey: (r.occurrence_key as string | null) ?? null,
  }));
}
