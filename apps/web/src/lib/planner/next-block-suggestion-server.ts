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
 * `getRecentBlocks`) to avoid a duplicate query; this helper adds the cheap
 * "next A-event" lookup and the recent reactive-deload count.
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
  /**
   * Start of the "recent" window for the reactive-deload count — typically
   * the start date of the oldest recent block. Null skips the deload query
   * (no recent blocks ⇒ no deloads to count).
   */
  windowStartYmd: string | null,
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

  // Recent reactive-deload episodes. An accepted reactive deload writes a
  // `tm_history` row with reason = "deload" (see engine/deload.ts +
  // tm-bump-actions.ts). A single cooked period can deload several lifts,
  // so we count distinct *sessions* (deload episodes), not rows — two
  // separate under-recovery episodes in the window trip the rebuild rule.
  let recentReactiveDeloads = 0;
  if (windowStartYmd) {
    const { data: deloadRows } = await supabase
      .from("tm_history")
      .select("id, session_id")
      .eq("user_id", userId)
      .eq("reason", "deload")
      .gte("changed_at", `${windowStartYmd}T00:00:00Z`);
    const episodes = new Set<string>();
    for (const r of deloadRows ?? []) {
      episodes.add((r.session_id as string | null) ?? (r.id as string));
    }
    recentReactiveDeloads = episodes.size;
  }

  const input = {
    recentArchetypes,
    upcomingEventModality,
    recentReactiveDeloads,
  };

  return {
    suggestion: suggestNextArchetype(input),
    realization: suggestRealizationWeek({ recentArchetypes, upcomingEventModality }),
  };
}
