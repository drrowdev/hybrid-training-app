import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Season-block activation (ADR 0051 Phase 0, slice D).
 *
 * Called best-effort from the program-deploy actions when the wizard was
 * deep-linked from a Season roadmap (`?seasonBlockId=`). It advances the
 * roadmap to track the block the user just deployed:
 *   - the previously-active Season block (the one they were running) flips to
 *     `done`;
 *   - the target planned block flips to `active` and is linked to the freshly
 *     materialised `training_blocks` row via `block_id`.
 *
 * User-scoped (RLS): the caller passes a request-scoped Supabase client and we
 * additionally filter every write by `user_id`. Only `planned` blocks can be
 * activated, so a stale / foreign / already-consumed id is a no-op.
 *
 * Non-fatal by contract: a valid program deploy must never be rolled back
 * because the secondary Season linkage failed. Callers wrap this in a
 * try/catch and ignore the outcome.
 */
export async function activateSeasonBlock(
  supabase: SupabaseClient,
  userId: string,
  seasonBlockId: string,
  blockId: string,
): Promise<void> {
  const { data: target } = await supabase
    .from("season_blocks")
    .select("id, season_id, status")
    .eq("id", seasonBlockId)
    .eq("user_id", userId)
    .maybeSingle();
  // Only a still-planned block the user owns can be activated.
  if (!target || target.status !== "planned") return;
  const seasonId = target.season_id as string;

  // Advancing past whatever block was active in this Season (if any).
  await supabase
    .from("season_blocks")
    .update({ status: "done" })
    .eq("season_id", seasonId)
    .eq("user_id", userId)
    .eq("status", "active");

  // Activate the target + link the materialised training block. The status
  // guard keeps this idempotent if two deploys race.
  await supabase
    .from("season_blocks")
    .update({ status: "active", block_id: blockId })
    .eq("id", seasonBlockId)
    .eq("user_id", userId)
    .eq("status", "planned");
}
