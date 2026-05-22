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
 * "Done" criterion mirrors the existing planner queries: a planned
 * session counts as remaining iff `completed_session_id IS NULL AND
 * skipped_at IS NULL`. Treating skipped rows as done matches user
 * intent (a user who skipped a session and finished the rest has
 * finished the block, not abandoned it).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

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

  // 2. Any planned_session still un-touched? If yes, nothing to do.
  const { count: remaining, error: rErr } = await supabase
    .from("planned_sessions")
    .select("id", { count: "exact", head: true })
    .eq("block_id", blockId)
    .is("completed_session_id", null)
    .is("skipped_at", null);
  if (rErr) return;
  if ((remaining ?? 0) > 0) return;

  // 3. Sanity guard: a block with zero planned_sessions shouldn't flip
  //    (it never started). Skip silently.
  const { count: total } = await supabase
    .from("planned_sessions")
    .select("id", { count: "exact", head: true })
    .eq("block_id", blockId);
  if ((total ?? 0) === 0) return;

  // 4. Flip. Guarded by `status='active'` so a concurrent endBlock
  //    (which writes 'archived') wins the race rather than getting
  //    overwritten back to 'completed'.
  await supabase
    .from("training_blocks")
    .update({ status: "completed" })
    .eq("id", blockId)
    .eq("status", "active");
}
