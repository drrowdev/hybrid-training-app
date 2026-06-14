/**
 * Active-block fatigue proxy (shared I/O).
 *
 * Gathers the {@link computeFatigueProxy} inputs from live state for the user's
 * active block: acute/chronic tonnage from the weekly recovery rollup, the
 * trailing-14-day cardio interference scalar, the strength:cardio day mix, and
 * the subjective recovery markers. Extracted so the early-deload recommendation
 * (which pulls a SCHEDULED deload forward) and the user-initiated recovery-week
 * nudge (which INSERTS a deload, used by programs with no scheduled deload like
 * Tactical Barbell) read the SAME fatigue definition — they must never drift.
 *
 * Read-only.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeConcurrentScalarFromBlocks } from "@/lib/engine/concurrent-scalar";
import { cardioBlocksFromLogs } from "@/lib/stats/muscle-volume";
import { getWeeklyRecoveryRollup } from "@/lib/engine/recovered-weeks";
import {
  computeFatigueProxy,
  type FatigueArchetypeKey,
} from "@/lib/planner/fatigue-proxy";

/** Min logged weeks of history before the proxy is trusted. */
export const MIN_WEEKS_FOR_PROXY = 3;

export type ActiveBlockFatigue = {
  proxy: number;
  /** True once ≥ MIN_WEEKS_FOR_PROXY logged weeks exist — the proxy is trustworthy. */
  dataSufficient: boolean;
  terms: { load: number; cardio: number; subjective: number };
  key: FatigueArchetypeKey;
  currentWeekIndex: number;
  /** A reactive OR early deload already fired this block. */
  recentDeloadThisBlock: boolean;
};

export async function computeActiveBlockFatigue(
  supabase: SupabaseClient,
  userId: string,
  block: { id: string; archetype: string | null; started_on: string; weeks: number },
  tz: string,
): Promise<ActiveBlockFatigue> {
  const startedOn = new Date(block.started_on + "T00:00:00");
  const daysSinceStart = Math.floor((Date.now() - startedOn.getTime()) / 86_400_000);
  const currentWeekIndex = Math.max(
    0,
    Math.min(block.weeks - 1, Math.floor(daysSinceStart / 7)),
  );

  // A deload (reactive OR earlier early-deload) already this block.
  const { count: reactiveDeloads } = await supabase
    .from("tm_history")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("reason", "deload")
    .gte("created_at", `${block.started_on}T00:00:00Z`);

  // Tonnage rollup (acute = most recent logged week, chronic = mean of prior 3).
  const rollup = await getWeeklyRecoveryRollup(supabase, userId, { weeks: 8, tz });
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
    .eq("user_id", userId)
    .is("deleted_at", null)
    .gte("performed_at", sinceIso);
  const sessionIds = ((recentSessions ?? []) as Array<{ id: string }>).map((s) => s.id);
  let concurrentScalar = 1.0;
  let cardioSessionCount = 0;
  if (sessionIds.length > 0) {
    const { data: cardio } = await supabase
      .from("cardio_logs")
      .select("session_id, duration_sec, modality, hr_zones, rpe")
      .in("session_id", sessionIds);
    const cardioRows = (cardio ?? []) as Array<{
      session_id: string | null;
      modality: string | null;
      duration_sec: number | null;
      hr_zones?: unknown;
      rpe?: number | null;
    }>;
    cardioSessionCount = new Set(
      cardioRows.map((c) => c.session_id).filter(Boolean),
    ).size;
    const blocks = cardioBlocksFromLogs(cardioRows);
    concurrentScalar = computeConcurrentScalarFromBlocks(blocks);
  }
  const loadMix = {
    strengthDays: Math.max(0, sessionIds.length - cardioSessionCount),
    cardioDays: cardioSessionCount,
  };

  const { proxy, terms, key } = computeFatigueProxy({
    archetype: block.archetype ?? "",
    loadMix,
    acuteTonnage,
    chronicTonnage,
    concurrentScalar,
    avgFatigue: recent?.avgFatigue ?? null,
    avgSoreness: recent?.avgSoreness ?? null,
    maxSrpe: recent?.maxSrpe ?? null,
  });

  return {
    proxy,
    dataSufficient,
    terms,
    key,
    currentWeekIndex,
    recentDeloadThisBlock: (reactiveDeloads ?? 0) > 0,
  };
}
