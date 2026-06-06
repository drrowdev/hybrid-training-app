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
import { computeConcurrentScalarFromBlocks } from "@/lib/engine/concurrent-scalar";
import { cardioBlocksFromLogs } from "@/lib/stats/muscle-volume";
import { getWeeklyRecoveryRollup } from "@/lib/engine/recovered-weeks";
import { getUserTimezone } from "@/lib/planner/queries";
import { deloadWeekIndexFor } from "@/lib/planner/deload-skip";
import {
  computeFatigueProxy,
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

/** Min logged weeks of history before the proxy is trusted (fixed fallback). */
const MIN_WEEKS_FOR_PROXY = 3;

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
  const deloadWeekIndex = deloadWeekIndexFor(archetype, weeks);
  if (deloadWeekIndex == null) return null; // maintenance / no-deload block

  const startedOn = new Date(block.started_on + "T00:00:00");
  const daysSinceStart = Math.floor((Date.now() - startedOn.getTime()) / 86_400_000);
  const currentWeekIndex = Math.max(0, Math.min(weeks - 1, Math.floor(daysSinceStart / 7)));
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

  // A deload (reactive OR earlier early-deload) already this block → don't stack.
  const { count: reactiveDeloads } = await supabase
    .from("tm_history")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("reason", "deload")
    .gte("created_at", `${block.started_on}T00:00:00Z`);

  // ── Fatigue-proxy inputs ──────────────────────────────────────────
  const tz = await getUserTimezone();
  const rollup = await getWeeklyRecoveryRollup(supabase, user.id, { weeks: 8, tz });
  const logged = rollup.filter((w) => w.loggedSessions > 0); // most-recent-first
  const dataSufficient = logged.length >= MIN_WEEKS_FOR_PROXY;

  const acuteTonnage = logged[0]?.weeklyTonnageKg ?? 0;
  const chronicWeeks = logged.slice(1, 4);
  const chronicTonnage =
    chronicWeeks.length > 0
      ? chronicWeeks.reduce((a, w) => a + w.weeklyTonnageKg, 0) / chronicWeeks.length
      : 0;
  const recent = logged[0];

  // Cardio interference over the trailing 14 days.
  const sinceIso = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const { data: recentSessions } = await supabase
    .from("sessions")
    .select("id")
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .gte("performed_at", sinceIso);
  const sessionIds = ((recentSessions ?? []) as Array<{ id: string }>).map((s) => s.id);
  let concurrentScalar = 1.0;
  if (sessionIds.length > 0) {
    const { data: cardio } = await supabase
      .from("cardio_logs")
      .select("duration_sec, modality, hr_zones, rpe")
      .in("session_id", sessionIds);
    const blocks = cardioBlocksFromLogs(
      (cardio ?? []) as Array<{
        modality: string | null;
        duration_sec: number | null;
        hr_zones?: unknown;
        rpe?: number | null;
      }>,
    );
    concurrentScalar = computeConcurrentScalarFromBlocks(blocks);
  }

  const { proxy, terms, key } = computeFatigueProxy({
    archetype,
    acuteTonnage,
    chronicTonnage,
    concurrentScalar,
    avgFatigue: recent?.avgFatigue ?? null,
    avgSoreness: recent?.avgSoreness ?? null,
    maxSrpe: recent?.maxSrpe ?? null,
  });

  const recommend = shouldRecommendEarlyDeload({
    proxy,
    dataSufficient,
    loadingWeeksLeft,
    recentDeloadAlready: (reactiveDeloads ?? 0) > 0,
  });
  if (!recommend) return null;

  return {
    blockId: block.id,
    archetype,
    archetypeKey: key,
    currentWeekIndex,
    deloadWeekIndex,
    proxy,
    terms,
    sessionCount: convertible.length,
  };
}
