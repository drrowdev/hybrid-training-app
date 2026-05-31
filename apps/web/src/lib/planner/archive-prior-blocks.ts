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
  const { error } = await supabase
    .from("training_blocks")
    .update({ status: "archived", archived_at: now, ended_at: now })
    .eq("user_id", userId)
    .eq("status", "active")
    .neq("id", exceptBlockId);
  return { error: error ? error.message : null };
}
