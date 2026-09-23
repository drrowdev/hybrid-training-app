import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { swimActivityProjection } from "./activity-history";
import { swimImportOutcomesAvailable } from "./import-outcomes";
import { standaloneSwimStateColumns } from "./standalone-state";

/** A current match can move; retained claims still belong to their original recording. */
export async function loadRecordingSwimClaims(client: SupabaseClient, userId: string, importId: string) {
  if (![userId, importId].every((value) => z.string().uuid().safeParse(value).success)) {
    throw new Error("The recording confirmations could not be loaded.");
  }
  if (!await swimImportOutcomesAvailable(client)) return [];
  const { data, error } = await client.from("swim_import_outcome_activity")
    .select(`${standaloneSwimStateColumns},definition`)
    .eq("user_id", userId).eq("claim_import_id", importId)
    .is("session_id", null).not("outcome_match_id", "is", null)
    .order("id").limit(101).abortSignal(AbortSignal.timeout(10_000));
  if (error || !Array.isArray(data) || data.length > 100) {
    throw new Error("The recording confirmations could not be loaded.");
  }
  const ids = new Set<string>();
  return data.map((raw) => {
    const { activity, state } = swimActivityProjection(raw, userId);
    if (activity.importId !== importId || ids.has(activity.id) || !state.outcomeId || !state.claim) {
      throw new Error("The recording confirmation could not be loaded.");
    }
    ids.add(activity.id);
    return {
      ...activity, outcomeId: state.outcomeId, workoutRevision: state.workoutRevision,
      claimedOutcome: state.claim.outcome,
    };
  });
}
