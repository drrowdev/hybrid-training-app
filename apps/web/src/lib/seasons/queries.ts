/**
 * Season read queries (ADR 0051 Phase 0). User-scoped (RLS) reads of the active
 * Season + its blocks, in position order. Returns null when the user has no
 * active Season (the common case — the feature is opt-in).
 */
import { createClient, getAuthUser } from "@/lib/supabase/server";

export type SeasonBlock = {
  id: string;
  position: number;
  programId: string;
  templateRef: string | null;
  emphasis: string;
  intentNote: string | null;
  plannedWeeks: number | null;
  status: "planned" | "active" | "done" | "skipped";
  blockId: string | null;
};

export type ActiveSeason = {
  id: string;
  name: string;
  blocks: SeasonBlock[];
};

export async function getActiveSeason(): Promise<ActiveSeason | null> {
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data: season } = await supabase
    .from("training_seasons")
    .select("id, name")
    .eq("user_id", user.id)
    .eq("status", "active")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!season) return null;

  const { data: rows } = await supabase
    .from("season_blocks")
    .select("id, position, program_id, template_ref, emphasis, intent_note, planned_weeks, status, block_id")
    .eq("season_id", season.id as string)
    .eq("user_id", user.id)
    .order("position", { ascending: true });

  const blocks: SeasonBlock[] = (rows ?? []).map((r) => ({
    id: r.id as string,
    position: r.position as number,
    programId: r.program_id as string,
    templateRef: (r.template_ref as string | null) ?? null,
    emphasis: (r.emphasis as string) ?? "base",
    intentNote: (r.intent_note as string | null) ?? null,
    plannedWeeks: (r.planned_weeks as number | null) ?? null,
    status: (r.status as SeasonBlock["status"]) ?? "planned",
    blockId: (r.block_id as string | null) ?? null,
  }));

  return { id: season.id as string, name: season.name as string, blocks };
}
