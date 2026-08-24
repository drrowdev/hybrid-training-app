import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Archive every *other* currently-active training block for a user, leaving
 * the just-created block (`exceptBlockId`) as the sole active block.
 *
 * Why this exists (data-integrity fix):
 * Block creation previously archived the prior active block *before* inserting
 * the new block and its planned_sessions. Because those are separate,
 * non-transactional Supabase calls, any failure after the archive (e.g. the
 * `focus_muscles` schema-cache error, or a planned_sessions insert failure)
 * left the user with their old block archived and no replacement — zero active
 * blocks, a stuck account.
 *
 * The fix reorders the operations so the new block + its planned_sessions are
 * fully committed *first*, and only then is the prior block archived as the
 * final, conditional step. If anything fails earlier, the old block is never
 * touched and stays active.
 *
 * There is no DB-level one-active-block constraint, so the brief window where
 * both the old and new block are active is harmless: `getActiveBlock` selects
 * `status='active'` ordered `started_on DESC LIMIT 1` (newest wins), and no
 * query inside the creation action reads active blocks. Should this archive
 * step itself fail, the caller treats it as non-fatal — a recoverable
 * two-active state (newest-wins hides the stale one) is strictly better than
 * the pre-fix zero-active failure.
 *
 * RLS: callers pass the user-scoped Supabase client; the explicit
 * `user_id` filter plus the `training_blocks` update policy ensure a user can
 * only archive their own blocks.
 */
export async function archivePriorActiveBlocks(
  supabase: SupabaseClient,
  userId: string,
  exceptBlockId: string,
): Promise<{ error: string | null }> {
  const now = new Date().toISOString();
  const { data: archived, error } = await supabase
    .from("training_blocks")
    .update({ status: "archived", archived_at: now, ended_at: now })
    .eq("user_id", userId)
    .eq("status", "active")
    .neq("id", exceptBlockId)
    .select("id");
  if (error) return { error: error.message };

  // A nudge is advice about a specific plan. Once that plan is archived the
  // advice cannot be acted on, so retiring it here stops it sitting on Today
  // pointing at a block the lifter has left.
  const ids = (archived ?? []).map((b) => b.id as string);
  if (ids.length > 0) {
    await supabase
      .from("program_recommendations")
      .update({ status: "dismissed", resolved_at: now })
      .eq("user_id", userId)
      .eq("status", "pending")
      .in("block_id", ids);
  }
  return { error: null };
}

/**
 * Soft-delete the user's ABANDONED in-progress sessions — started but never
 * logged into (zero set_logs and zero cardio_logs) and never completed.
 *
 * Called when a new program is deployed: starting fresh abandons any half-opened
 * session from the program you just replaced, so leaving it around surfaces a
 * stale "Resume today's workout" card pointing at the archived program's work.
 * Sessions with ANY logged work are left untouched (the user did something worth
 * keeping); only truly-empty shells are cleared. Best-effort and non-fatal — a
 * failure here never blocks the deploy.
 *
 * RLS: user-scoped client + explicit `user_id` filter; a user only ever touches
 * their own sessions.
 */
export async function discardAbandonedInProgressSessions(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
  const { data: open } = await supabase
    .from("sessions")
    .select("id")
    .eq("user_id", userId)
    .is("completed_at", null)
    .is("deleted_at", null);
  const ids = (open ?? []).map((s) => s.id as string);
  if (ids.length === 0) return;

  const [{ data: setRows }, { data: cardioRows }] = await Promise.all([
    supabase.from("set_logs").select("session_id").in("session_id", ids),
    supabase.from("cardio_logs").select("session_id").in("session_id", ids),
  ]);
  const logged = new Set<string>([
    ...(setRows ?? []).map((r) => r.session_id as string),
    ...(cardioRows ?? []).map((r) => r.session_id as string),
  ]);
  const abandoned = ids.filter((id) => !logged.has(id));
  if (abandoned.length === 0) return;

  await supabase
    .from("sessions")
    .update({ deleted_at: new Date().toISOString() })
    .in("id", abandoned)
    .eq("user_id", userId);
}
