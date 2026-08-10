/**
 * ADR 0031 (Phase 2) — autoregulated deload-skip OFFER (server-side).
 *
 * When the user reaches (or is one week away from) the block's programmed
 * deload AND their recent loading weeks logged as "recovered" (DC-K1 /
 * `isRecoveredWeek`) AND no reactive deload has fired this block, we offer to
 * SKIP the deload and keep accumulating.
 *
 * Grounding (ADR 0030 / CP-2 row 51): the deload is a fatigue-management valve,
 * not a fixed requirement — 5/3/1 explicitly lets recovered/advanced lifters
 * skip it, Tactical Barbell keeps accumulating "for a lengthy period" while
 * fresh. The recovered-weeks signal is the conservative, evidence-aligned
 * proxy for "you haven't accrued the fatigue this deload is meant to dissipate."
 *
 * Default is ALWAYS to take the deload — this only ever SURFACES a choice.
 * Mirrors the ADR 0013 volume-autoreg offer/accept pattern.
 */
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { isRecoveredWeek } from "@hta/engine";
import { getWeeklyRecoveryRollup } from "@/lib/engine/recovered-weeks";
import { getUserTimezone } from "@/lib/planner/queries";
import {
  DELOAD_SKIP_RECOVERED_WEEKS,
  resolveDeloadWeekIndex,
  isDeloadSkipEligible,
} from "@/lib/planner/deload-skip";
import type { Prescription } from "@hta/db";
import { isUnstartedLinkedSession } from "@/lib/sessions/linked-session-state";

export type { DeloadSkipOffer } from "@/lib/planner/deload-skip";
import type { DeloadSkipOffer } from "@/lib/planner/deload-skip";

export async function getDeloadSkipOffer(): Promise<DeloadSkipOffer | null> {
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
  // Resolve the deload week from the materialised plan (role="deload"), falling
  // back to the archetype config for legacy blocks (ADR 0046 Phase 3). This makes
  // the skip offer work for foreign programs (5/3/1 7th week, TB deload, …) whose
  // archetype is NULL; byte-identical for native (Hybrid tags the same week).
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

  const startedOn = new Date(block.started_on + "T00:00:00");
  const daysSinceStart = Math.floor((Date.now() - startedOn.getTime()) / 86_400_000);
  const currentWeekIndex = Math.max(0, Math.min(weeks - 1, Math.floor(daysSinceStart / 7)));

  // The deload week must still have un-started, not-already-skipped sessions.
  const { data: deloadRows } = await supabase
    .from("planned_sessions")
    .select(
      "id, prescription, completed_session_id, sessions(deleted_at, completed_at)",
    )
    .eq("user_id", user.id)
    .eq("block_id", block.id)
    .eq("week_index", deloadWeekIndex)
    .is("skipped_at", null);
  const skippable = (
    (deloadRows ?? []) as Array<{
      id: string;
      prescription: Prescription;
      completed_session_id: string | null;
      sessions:
        | { deleted_at: string | null; completed_at: string | null }
        | Array<{ deleted_at: string | null; completed_at: string | null }>
        | null;
    }>
  ).filter(
    (r) =>
      isUnstartedLinkedSession(r.completed_session_id, r.sessions) &&
      r.prescription?.deloadSkipped !== true,
  );

  // A reactive auto-deload firing this block means the user genuinely needed
  // to back off — never offer to skip.
  const { count: reactiveDeloads } = await supabase
    .from("tm_history")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("reason", "deload")
    .gte("created_at", `${block.started_on}T00:00:00Z`);

  // Recovery signal: the most recent logged weeks must all be "recovered".
  const tz = await getUserTimezone();
  const rollup = await getWeeklyRecoveryRollup(supabase, user.id, { weeks: 8, tz });
  const recentLoggedRecovered = rollup
    .filter((w) => w.loggedSessions > 0)
    .map((w) => isRecoveredWeek(w).isRecovered);

  const eligible = isDeloadSkipEligible({
    deloadWeekIndex,
    currentWeekIndex,
    skippableSessionCount: skippable.length,
    reactiveDeloadCount: reactiveDeloads ?? 0,
    recentLoggedRecovered,
  });
  if (!eligible) return null;

  return {
    blockId: block.id,
    archetype,
    deloadWeekIndex,
    recoveredWeeks: DELOAD_SKIP_RECOVERED_WEEKS,
    sessionCount: skippable.length,
  };
}
