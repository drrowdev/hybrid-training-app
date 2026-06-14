/**
 * ADR 0032 (Phase 3) — early-deload RECOMMENDATION (server-side read).
 *
 * Computes a combined-load fatigue proxy (archetype-weighted) and, when it
 * crosses the threshold with loading still left before the scheduled deload,
 * surfaces an advisory "bring your deload forward" recommendation. The
 * scheduled deload is the FIXED FALLBACK and always remains. Accepting (see
 * `early-deload-actions.ts`) converts the CURRENT week into a deload.
 *
 * Unique value over the strength-only reactive auto-deload (`engine/deload.ts`):
 * it sees the systemic load of concurrent endurance volume (via the cardio
 * interference scalar), which never shows up as an AMRAP miss.
 *
 * Mirrors the ADR 0013 / 0031 offer pattern; pure logic lives in
 * `fatigue-proxy.ts`.
 */
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { getUserTimezone } from "@/lib/planner/queries";
import { resolveDeloadWeekIndex } from "@/lib/planner/deload-skip";
import { computeActiveBlockFatigue } from "@/lib/planner/block-fatigue";
import {
  shouldRecommendEarlyDeload,
  type FatigueArchetypeKey,
} from "@/lib/planner/fatigue-proxy";

export type EarlyDeloadRecommendation = {
  blockId: string;
  archetype: string;
  archetypeKey: FatigueArchetypeKey;
  currentWeekIndex: number;
  deloadWeekIndex: number;
  proxy: number;
  terms: { load: number; cardio: number; subjective: number };
  /** Un-started current-week sessions that would convert to a deload. */
  sessionCount: number;
};

export async function getEarlyDeloadRecommendation(): Promise<EarlyDeloadRecommendation | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return null;

  const { data: block } = await supabase
    .from("training_blocks")
    .select("id, archetype, started_on, weeks")
    .eq("user_id", user.id)
    .eq("status", "active")
    .is("deleted_at", null)
    .maybeSingle();
  if (!block) return null;

  const archetype = block.archetype as string;
  const weeks = block.weeks as number;
  // De-archetype the deload week (ADR 0046 Phase 3): prefer the materialised
  // plan's role="deload" week, fall back to the archetype config for legacy.
  const { data: deloadWeekRows } = await supabase
    .from("planned_sessions")
    .select("week_index")
    .eq("user_id", user.id)
    .eq("block_id", block.id)
    .eq("role", "deload");
  const deloadSessions = ((deloadWeekRows ?? []) as Array<{ week_index: number }>).map((r) => ({
    weekIndex: r.week_index,
    role: "deload" as const,
  }));
  const deloadWeekIndex = resolveDeloadWeekIndex({ archetype, weeks, sessions: deloadSessions });
  if (deloadWeekIndex == null) return null; // maintenance / no-deload block

  const tz = await getUserTimezone();
  const fatigue = await computeActiveBlockFatigue(
    supabase,
    user.id,
    { id: block.id, archetype, started_on: block.started_on as string, weeks },
    tz,
  );
  const { currentWeekIndex } = fatigue;
  const loadingWeeksLeft = deloadWeekIndex - currentWeekIndex;
  if (loadingWeeksLeft < 2) return null; // basically at the scheduled deload already

  // Current-week un-started sessions (what an early deload would convert).
  const { data: curRows } = await supabase
    .from("planned_sessions")
    .select("id, prescription")
    .eq("user_id", user.id)
    .eq("block_id", block.id)
    .eq("week_index", currentWeekIndex)
    .is("completed_session_id", null)
    .is("skipped_at", null);
  const convertible = ((curRows ?? []) as Array<{ id: string; prescription: { earlyDeload?: boolean } }>).filter(
    (r) => r.prescription?.earlyDeload !== true,
  );
  if (convertible.length === 0) return null;

  const recommend = shouldRecommendEarlyDeload({
    proxy: fatigue.proxy,
    dataSufficient: fatigue.dataSufficient,
    loadingWeeksLeft,
    recentDeloadAlready: fatigue.recentDeloadThisBlock,
  });
  if (!recommend) return null;

  return {
    blockId: block.id,
    archetype,
    archetypeKey: fatigue.key,
    currentWeekIndex,
    deloadWeekIndex,
    proxy: fatigue.proxy,
    terms: fatigue.terms,
    sessionCount: convertible.length,
  };
}
