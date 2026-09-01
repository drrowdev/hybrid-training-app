/**
 * Shared "remaining sessions in the active block" reader + bulk
 * prescription updater. Used by the two mid-block adaptive features
 * (ADR 0013 volume autoregulation, ADR 0014 limitation response) that
 * must edit an already-materialized block.
 *
 * Blocks are materialized eagerly at creation, so a mid-block change
 * cannot flow through the generation-time overlay — it must rewrite the
 * stored `planned_sessions.prescription` rows directly. Both features
 * only ever touch UN-STARTED future rows. A soft-deleted unfinished link is
 * unstarted; active, completed, deleted-completed and skipped rows are immutable.
 *
 * All queries are user-scoped (pass an authenticated client; RLS plus
 * the explicit `user_id` predicate guard ownership).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Prescription } from "@hta/db";
import { isUnstartedLinkedSession } from "@/lib/sessions/linked-session-state";
import { currentBlockWeekIndexAt } from "@/lib/dates";

export type RemainingSession = {
  id: string;
  weekIndex: number;
  dayIndex: number;
  title: string;
  role: string;
  prescription: Prescription;
  expectedCompletedSessionId?: string | null;
};

export type ActiveBlockRemaining = {
  blockId: string;
  archetype: string;
  weeks: number;
  /** Calendar week index the user is currently in (0-based, clamped). */
  currentWeekIndex: number;
  /** Un-started future rows, ordered by (weekIndex, dayIndex). */
  remaining: RemainingSession[];
};

/**
 * Load the active block and its un-started sessions. Returns null when
 * the user has no active block.
 *
 * `currentWeekIndex` is derived from the block's Monday and the user's local
 * date, so every adaptive feature agrees on "this week".
 */
export async function getActiveBlockRemainingSessions(
  supabase: SupabaseClient,
  userId: string,
  timezone: string,
  now = new Date(),
): Promise<ActiveBlockRemaining | null> {
  const { data: block } = await supabase
    .from("training_blocks")
    .select("id, archetype, started_on, weeks")
    .eq("user_id", userId)
    .eq("status", "active")
    .is("deleted_at", null)
    .maybeSingle();
  if (!block) return null;

  const currentWeekIndex = currentBlockWeekIndexAt(
    block.started_on,
    block.weeks,
    timezone,
    now,
  );

  const { data: rows } = await supabase
    .from("planned_sessions")
    .select(
      "id, week_index, day_index, title, role, prescription, completed_session_id, sessions(deleted_at, completed_at)",
    )
    .eq("user_id", userId)
    .eq("block_id", block.id)
    .is("skipped_at", null)
    .order("week_index", { ascending: true })
    .order("day_index", { ascending: true });

  const remaining: RemainingSession[] = (
    (rows ?? []) as Array<{
      id: string;
      week_index: number;
      day_index: number;
      title: string;
      role: string;
      prescription: Prescription;
      completed_session_id: string | null;
      sessions:
        | {
            deleted_at: string | null;
            completed_at: string | null;
          }
        | Array<{
            deleted_at: string | null;
            completed_at: string | null;
          }>
        | null;
    }>
  )
    .filter((row) =>
      isUnstartedLinkedSession(
        row.completed_session_id,
        row.sessions,
      ),
    )
    .map((r) => ({
      id: r.id,
      weekIndex: r.week_index,
      dayIndex: r.day_index,
      title: r.title,
      role: r.role,
      prescription: r.prescription,
      expectedCompletedSessionId: r.completed_session_id,
    }));

  return {
    blockId: block.id,
    archetype: block.archetype as string,
    weeks: block.weeks as number,
    currentWeekIndex,
    remaining,
  };
}

/**
 * Persist new prescriptions onto specific planned-session rows. Each
 * update is re-scoped to `(id, user_id, block_id)` and re-asserts the
 * un-started predicate so a session that was logged between read and
 * write is never clobbered. Returns the number of rows actually written.
 */
export async function applyPrescriptionUpdates(
  supabase: SupabaseClient,
  userId: string,
  blockId: string,
  updates: ReadonlyArray<{
    id: string;
    prescription: Prescription;
    expectedCompletedSessionId?: string | null;
  }>,
): Promise<{ updated: number; error?: string }> {
  let updated = 0;
  for (const u of updates) {
    const updateBase = supabase
      .from("planned_sessions")
      .update({ prescription: u.prescription }, { count: "exact" })
      .eq("id", u.id)
      .eq("user_id", userId)
      .eq("block_id", blockId);
    const expected = u.expectedCompletedSessionId;
    const guarded =
      expected != null
        ? updateBase.eq("completed_session_id", expected)
        : updateBase.is("completed_session_id", null);
    const { error, count } = await guarded
      .is("skipped_at", null);
    if (error) return { updated, error: error.message };
    updated += count ?? 0;
  }
  return { updated };
}
