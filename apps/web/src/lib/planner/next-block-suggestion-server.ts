import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ArchetypeId } from "./archetypes";
import { taperModalityForEvent } from "./taper";
import {
  suggestNextArchetype,
  suggestRealizationWeek,
  type NextBlockSuggestion,
} from "./next-block-suggestion";

/**
 * Server glue for the ADR 0010 next-block nudge.
 *
 * Gathers the pure suggestion function's inputs from the user's data and
 * returns the suggestion + realization opportunity. Read-only and
 * user-scoped: the caller passes a request-scoped (RLS-enforced) Supabase
 * client, and every query is explicitly filtered to `userId`.
 *
 * The recent archetype history is passed in (the plan page already loads
 * `getRecentBlocks`) to avoid a duplicate query; this helper only adds the
 * cheap "next A-event" lookup.
 */
export type NextBlockNudge = {
  suggestion: NextBlockSuggestion | null;
  realization: { reason: string } | null;
};

export async function getNextBlockNudge(
  supabase: SupabaseClient,
  userId: string,
  recentArchetypes: ArchetypeId[],
  todayYmd: string,
): Promise<NextBlockNudge> {
  // Next future A-priority event → peaking modality (ADR 0008 mapping).
  const { data: evt } = await supabase
    .from("events")
    .select("event_date, priority, modality")
    .eq("user_id", userId)
    .eq("priority", "A")
    .gte("event_date", todayYmd)
    .order("event_date", { ascending: true })
    .limit(1)
    .maybeSingle();
  const upcomingEventModality = evt ? taperModalityForEvent(evt.modality) : null;

  // NOTE: reactive-deload count is not persisted as a queryable signal yet,
  // so rule 1 (recovery-aware) is dormant from this surface. The pure
  // function already supports it; wire the count when a stored signal lands.
  const input = {
    recentArchetypes,
    upcomingEventModality,
    recentReactiveDeloads: 0,
  };

  return {
    suggestion: suggestNextArchetype(input),
    realization: suggestRealizationWeek({ recentArchetypes, upcomingEventModality }),
  };
}
