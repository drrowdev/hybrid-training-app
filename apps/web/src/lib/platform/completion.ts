import type { SupabaseClient } from "@supabase/supabase-js";
import { maybeCompleteBlock } from "@/lib/planner/completion";
import { applyProgramProgression } from "./progression";

export const PROGRAM_PROGRESS_RETRY_MESSAGE = "Workout saved. Program progress is waiting to sync.";

export async function reconcileCompletedProgram(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string,
): Promise<void> {
  const linked = await supabase.from("planned_sessions").select("block_id")
    .eq("user_id", userId).eq("completed_session_id", sessionId).maybeSingle();
  if (linked.error) throw new Error("Could not read the workout's program.", { cause: linked.error });
  if (!linked.data?.block_id) return;
  const blockId = linked.data.block_id as string;
  await applyProgramProgression({ supabase, userId, sessionId, blockId });
  await maybeCompleteBlock(supabase, blockId);
}
