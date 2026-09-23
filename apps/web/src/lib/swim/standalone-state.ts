import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { standaloneSwimTrainingState } from "@hta/domain";
import { importOutcomeMetadataSchema, swimImportOutcomesAvailable } from "./import-outcomes";

const uuid = z.string().uuid();
const nullableId = uuid.nullable();
const revision = z.number().int().positive().max(2147483647);
const date = z.string().date();
const columns = [
  "id", "user_id", "plan_id", "revision", "status", "session_id", "scheduled_date", "plan_status",
  "visible_session_id", "native_completed_at", "outcome_id", "outcome_match_id", "outcome_metadata",
  "current_match_id", "matched_import_id", "matched_workout_revision", "latest_import_id", "recording_date",
  "claim_import_id", "claim_recording_date",
] as const;
export const standaloneSwimStateColumns = columns.join(",");
const rowSchema = z.object({
  id: uuid, user_id: uuid, plan_id: uuid, revision,
  status: z.enum(["scheduled", "started", "completed", "skipped"]),
  plan_status: z.enum(["active", "paused", "finished", "archived"]),
  scheduled_date: date, session_id: nullableId, visible_session_id: nullableId,
  native_completed_at: z.string().datetime({ offset: true }).nullable(),
  outcome_id: nullableId, outcome_match_id: nullableId, outcome_metadata: importOutcomeMetadataSchema.nullable(),
  current_match_id: nullableId, matched_import_id: nullableId, matched_workout_revision: revision.nullable(),
  latest_import_id: nullableId, recording_date: date.nullable(),
  claim_import_id: nullableId, claim_recording_date: date.nullable(),
}).strict().refine((row) => {
  if (row.visible_session_id !== null && row.visible_session_id !== row.session_id ||
    row.native_completed_at !== null && row.visible_session_id === null) return false;
  if ((row.outcome_id === null) !== (row.outcome_metadata === null)) return false;
  const claimed = row.outcome_metadata?.outcome != null;
  if (claimed !== (row.outcome_match_id !== null) || claimed !== (row.claim_import_id !== null) ||
    claimed !== (row.claim_recording_date !== null) || claimed !== (row.outcome_metadata?.workoutRevision != null)) return false;
  if (row.current_match_id === null) {
    return row.matched_import_id === null && row.matched_workout_revision === null &&
      row.latest_import_id === null && row.recording_date === null;
  }
  return claimed && row.current_match_id === row.outcome_match_id && row.matched_import_id !== null &&
    row.matched_import_id === row.claim_import_id &&
    row.matched_workout_revision === row.outcome_metadata?.workoutRevision &&
    row.latest_import_id !== null && row.recording_date !== null &&
    (row.latest_import_id !== row.matched_import_id || row.recording_date === row.claim_recording_date);
});

export function standaloneSwimState(value: unknown, userId: string) {
  const parsed = rowSchema.safeParse(value);
  if (!parsed.success || parsed.data.user_id !== userId) throw new Error("The swim outcome could not be loaded.");
  const row = parsed.data;
  const state = standaloneSwimTrainingState({
    planStatus: row.plan_status, workoutStatus: row.status,
    nativeSessionId: row.session_id, nativeVisible: row.visible_session_id !== null,
    nativeCompletedAt: row.native_completed_at,
    evidence: row.outcome_metadata ? {
      confirmation: {
        outcome: row.outcome_metadata.outcome, matchId: row.outcome_match_id,
        workoutRevision: row.outcome_metadata.workoutRevision,
      },
      matchId: row.current_match_id, matchedImportId: row.matched_import_id,
      latestImportId: row.latest_import_id, matchedWorkoutRevision: row.matched_workout_revision,
      workoutRevision: row.revision,
    } : null,
  });
  return {
    ...state, id: row.id, planId: row.plan_id, workoutRevision: row.revision,
    scheduledDate: row.scheduled_date, outcomeId: row.outcome_id,
    claim: row.outcome_metadata?.outcome && row.claim_import_id && row.claim_recording_date ? {
      outcome: row.outcome_metadata.outcome, importId: row.claim_import_id, recordedDate: row.claim_recording_date,
    } : null,
  };
}
export type StandaloneSwimState = ReturnType<typeof standaloneSwimState>;

/** Read capability is independent of whether creating new confirmations is enabled. */
export async function loadStandaloneSwimStates(
  client: SupabaseClient, userId: string, workoutIds: readonly string[],
): Promise<Map<string, StandaloneSwimState>> {
  if (!uuid.safeParse(userId).success || !z.array(uuid).safeParse(workoutIds).success) {
    throw new Error("The swimming workouts could not be loaded.");
  }
  const result = new Map<string, StandaloneSwimState>();
  if (!workoutIds.length || !await swimImportOutcomesAvailable(client)) return result;
  const ids = [...new Set(workoutIds)];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const batch = ids.slice(offset, offset + 100);
    const { data, error } = await client.from("swim_import_outcome_activity").select(standaloneSwimStateColumns)
      .eq("user_id", userId).in("id", batch).limit(101).abortSignal(AbortSignal.timeout(10_000));
    if (error || !Array.isArray(data) || data.length !== batch.length) {
      throw new Error("The swimming workouts could not be loaded.");
    }
    for (const raw of data) {
      const state = standaloneSwimState(raw, userId);
      if (!batch.includes(state.id) || result.has(state.id)) throw new Error("The swimming workouts could not be loaded.");
      result.set(state.id, state);
    }
  }
  return result;
}
