/**
 * User-initiated deload week — read-only preview (ADR 0049).
 *
 * Resolves the user's active block + current week, mirrors the NEXT programmed
 * week's structure into a 5/3/1-style light recovery week (via the pure
 * `buildDeloadWeek`), and reports where it would be inserted and whether an
 * A-priority event would be pushed by the extra week (warn-only, v1).
 *
 * Read-only: no writes. The insert action recomputes this server-side before
 * mutating (never trusts a client-sent week).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Prescription } from "@hta/db";
import { buildDeloadWeek, type DeloadSessionSpec } from "./deload-week";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { getUserTimezone } from "@/lib/planner/queries";
import { computeActiveBlockFatigue } from "@/lib/planner/block-fatigue";
import { EARLY_DELOAD_THRESHOLD } from "@/lib/planner/fatigue-proxy";

export type DeloadWeekPreview = {
  blockId: string;
  /** The deload is inserted immediately after this (0-based) week index. */
  afterWeek: number;
  /** The week index the inserted deload will occupy. */
  deloadWeekIndex: number;
  /** The recovery-week sessions (already at deload loading). */
  sessions: DeloadSessionSpec[];
  /** True when a future A-priority event falls in the block and would shift by a week. */
  eventWarning: boolean;
};

/** Current 0-based week index of an active block (rolling, clamped to the block). */
function currentWeekIndex(startedOn: string, weeks: number): number {
  const startMs = new Date(startedOn + "T00:00:00").getTime();
  const days = Math.floor((Date.now() - startMs) / 86_400_000);
  return Math.max(0, Math.min(weeks - 1, Math.floor(days / 7)));
}

export async function getDeloadWeekPreview(
  supabase: SupabaseClient,
  userId: string,
): Promise<DeloadWeekPreview | null> {
  const { data: block } = await supabase
    .from("training_blocks")
    .select("id, started_on, weeks")
    .eq("user_id", userId)
    .eq("status", "active")
    .is("deleted_at", null)
    .maybeSingle();
  if (!block) return null;

  const weeks = block.weeks as number;
  const cur = currentWeekIndex(block.started_on as string, weeks);
  // Insert after the current week; mirror the NEXT programmed week's structure
  // (clamped to the last week when the user is already in it).
  const afterWeek = cur;
  const mirrorWeek = Math.min(cur + 1, weeks - 1);

  const { data: rows } = await supabase
    .from("planned_sessions")
    .select("day_index, slot, title, session_modality, prescription")
    .eq("user_id", userId)
    .eq("block_id", block.id)
    .eq("week_index", mirrorWeek);
  if (!rows || rows.length === 0) return null;

  const sessions = buildDeloadWeek(
    rows.map((r) => ({
      dayIndex: r.day_index as number,
      slot: (r.slot as string) ?? "single",
      title: (r.title as string | null) ?? null,
      sessionModality: (r.session_modality as string | null) ?? null,
      prescription: (r.prescription as Prescription | null) ?? null,
    })),
  );
  if (sessions.length === 0) return null;

  // Warn (don't block) when a future A-event would be pushed by the extra week.
  const todayIso = new Date().toISOString().slice(0, 10);
  const { data: evt } = await supabase
    .from("events")
    .select("id")
    .eq("user_id", userId)
    .eq("priority", "A")
    .gte("event_date", todayIso)
    .limit(1)
    .maybeSingle();

  return {
    blockId: block.id as string,
    afterWeek,
    deloadWeekIndex: afterWeek + 1,
    sessions,
    eventWarning: !!evt,
  };
}

/**
 * Whether to PROACTIVELY surface the recovery-week nudge (vs. the always-present
 * quiet control). Fires only when the user shows real accumulated fatigue, using
 * the SAME proxy + threshold as the early-deload recommendation
 * (`EARLY_DELOAD_THRESHOLD`). `dataSufficient` (≥3 logged weeks) gates out fresh
 * blocks, so a brand-new block never nags. Suppressed right after a deload.
 *
 * Self-contained server read; returns false when there's no active block.
 */
export async function getDeloadWeekFatigueSignal(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return false;

  const { data: block } = await supabase
    .from("training_blocks")
    .select("id, archetype, started_on, weeks")
    .eq("user_id", user.id)
    .eq("status", "active")
    .is("deleted_at", null)
    .maybeSingle();
  if (!block) return false;

  const tz = await getUserTimezone();
  const fatigue = await computeActiveBlockFatigue(
    supabase,
    user.id,
    {
      id: block.id as string,
      archetype: (block.archetype as string | null) ?? null,
      started_on: block.started_on as string,
      weeks: block.weeks as number,
    },
    tz,
  );
  return (
    fatigue.dataSufficient &&
    !fatigue.recentDeloadThisBlock &&
    fatigue.proxy >= EARLY_DELOAD_THRESHOLD
  );
}
