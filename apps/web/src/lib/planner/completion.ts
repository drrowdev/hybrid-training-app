/**
 * Block auto-completion.
 *
 * When the last planned_session of a block lands (i.e. every planned
 * row is either linked to a completed session or explicitly skipped),
 * flip the block's status from 'active' to 'completed' so the wiki/UI
 * can distinguish "I finished" from "I abandoned" (manual End block,
 * which writes 'archived').
 *
 * Status semantics (post this PR):
 *   - 'active'    : block has un-touched planned_sessions remaining
 *   - 'completed' : every planned_session is done or skipped — fired
 *                   automatically by maybeCompleteBlock
 *   - 'archived'  : user manually pressed "End block" via the planner UI
 *
 * Atomicity is best-effort. A brief race where every session is logged
 * but the block row hasn't flipped yet is acceptable; the next call to
 * maybeCompleteBlock (or a page-load that exercises this code path)
 * reconciles. Existing 'archived' and 'completed' blocks are never
 * touched — manual archive always wins, and the no-op case is silent.
 *
 * When the flip fires, `completed_at` and `ended_at` are written to
 * NOW() alongside the status change (migration 0025). The `status='active'`
 * guard on the UPDATE keeps that idempotent — a second invocation
 * doesn't overwrite the original timestamp.
 *
 * "Done" criterion mirrors the planner UI: a raw link counts only when its
 * session exists and is not soft-deleted. Unlinked/cancelled rows remain;
 * skipped rows count as settled.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveLinkedSession } from "@/lib/sessions/linked-session-state";

export async function maybeCompleteBlock(
  supabase: SupabaseClient,
  blockId: string,
): Promise<void> {
  // 1. Fast guard: only flip 'active' blocks. 'archived' (manual end)
  //    and 'completed' (already flipped) must not be overwritten.
  const { data: block, error: bErr } = await supabase
    .from("training_blocks")
    .select("id, status")
    .eq("id", blockId)
    .maybeSingle();
  if (bErr || !block) return;
  if (block.status !== "active") return;

  // 2. Any planned_session still untouched? A raw link only counts when its
  // linked session still exists and is not soft-deleted.
  const { data: planned, error: rErr } = await supabase
    .from("planned_sessions")
    .select("id, completed_session_id, skipped_at, sessions(deleted_at)")
    .eq("block_id", blockId);
  if (rErr) return;
  if (!planned || planned.length === 0) return;
  const hasRemaining = planned.some((row) => {
    if (row.skipped_at != null) return false;
    const session = Array.isArray(row.sessions)
      ? row.sessions[0]
      : row.sessions;
    return (
      resolveLinkedSession(
        (row.completed_session_id as string | null) ?? null,
        session && row.completed_session_id
          ? {
              id: row.completed_session_id as string,
              completedAt: null,
              deletedAt: (session.deleted_at as string | null) ?? null,
            }
          : null,
      ).completedSessionId == null
    );
  });
  if (hasRemaining) return;

  // 3. Flip. Guarded by `status='active'` so a concurrent endBlock
  //    (which writes 'archived') wins the race rather than getting
  //    overwritten back to 'completed'. The `status='active'` guard
  //    also makes the timestamp write idempotent — re-running this
  //    on a row that's already 'completed' is a no-op (zero rows
  //    matched), so completed_at/ended_at are written exactly once.
  const nowIso = new Date().toISOString();
  await supabase
    .from("training_blocks")
    .update({ status: "completed", completed_at: nowIso, ended_at: nowIso })
    .eq("id", blockId)
    .eq("status", "active");
}
