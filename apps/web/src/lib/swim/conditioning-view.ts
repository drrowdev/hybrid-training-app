import { swimTrainingState, swimCourseWorkoutTitle } from "@hta/domain";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SwimWorkoutRow } from "./storage";
import type { SwimImportOutcome } from "./import-outcomes";
import { conditioningStorageAvailable } from "./conditioning-storage";
import { swimWorkoutDefinition } from "./model";
import { workoutPresentation } from "./presentation";
import type { ConditioningSwim } from "./conditioning-presentation";

export type ConditioningSwimRow = Pick<SwimWorkoutRow,
  "id" | "user_id" | "plan_id" | "revision" | "status" | "session_id" | "scheduled_date" | "slot" | "definition"> & {
  planned_session_id: string | null;
  block_id: string | null;
  plan_status: string;
  block_status: string | null;
  block_deleted_at: string | null;
  visible_session_id: string | null;
  native_completed_at: string | null;
  outcome_match_id: string | null;
  outcome_metadata: SwimImportOutcome["metadata"] | null;
  current_match_id: string | null;
  matched_import_id: string | null;
  matched_workout_revision: number | null;
  latest_import_id: string | null;
  recording_date: string | null;
};

export function conditioningSwimView(row: ConditioningSwimRow): ConditioningSwim {
  const presentation = workoutPresentation(row.definition.issued);
  const source = row.definition.courseSource;
  const definition = swimWorkoutDefinition({ ...row, created_at: "", updated_at: "" });
  const state = swimTrainingState({
    planStatus: row.plan_status,
    parentActive: row.block_status === "active" && row.block_deleted_at === null,
    parentExists: row.block_status !== null && row.block_deleted_at === null,
    workoutStatus: row.status, nativeSessionId: row.session_id,
    nativeCompletedAt: row.native_completed_at, nativeVisible: row.visible_session_id !== null,
    evidence: row.outcome_metadata?.outcome ? {
      confirmation: {
        outcome: row.outcome_metadata.outcome, matchId: row.outcome_match_id,
        workoutRevision: row.outcome_metadata.workoutRevision,
      },
      matchId: row.current_match_id ?? "",
      matchedImportId: row.matched_import_id ?? "",
      latestImportId: row.latest_import_id ?? "missing",
      matchedWorkoutRevision: row.matched_workout_revision ?? -1,
      workoutRevision: row.revision,
    } : null,
  });
  return {
    ...state, id: row.id,
    title: source ? swimCourseWorkoutTitle(source.title, definition.slotId) : presentation.title,
    distance: presentation.total, pool: presentation.course,
    recordingDate: state.settled ? row.recording_date : null,
  };
}

/** Read-only even when new setup is disabled. Every page is owner-scoped. */
export async function loadConditioningSwims(
  client: SupabaseClient, userId: string, plannedIds: readonly string[],
  by: "planned_session_id" | "id" = "planned_session_id",
): Promise<Map<string, ConditioningSwim>> {
  const views = new Map<string, ConditioningSwim>();
  if (!plannedIds.length || !await conditioningStorageAvailable(client)) return views;
  const ids = [...new Set(plannedIds)];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const batch = ids.slice(offset, offset + 100);
    const { data, error } = await client.from("swim_conditioning_sessions").select("*")
      .eq("user_id", userId).in(by, batch).limit(101)
      .returns<ConditioningSwimRow[]>().abortSignal(AbortSignal.timeout(10_000));
    if (error || !data || data.length > batch.length ||
        data.some((row) => row.user_id !== userId || !row[by] || !batch.includes(row[by]))) {
      throw new Error("The swimming sessions could not be loaded.");
    }
    for (const row of data) {
      const id = row[by];
      if (!id || views.has(id)) throw new Error("A swimming session was linked more than once.");
      views.set(id, conditioningSwimView(row));
    }
  }
  return views;
}

export async function loadBoundSwimIds(client: SupabaseClient, userId: string): Promise<Set<string>> {
  const ids = new Set<string>();
  if (!await conditioningStorageAvailable(client)) return ids;
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await client.from("swim_conditioning_bindings").select("swim_workout_id")
      .eq("user_id", userId).order("swim_workout_id").range(offset, offset + 499)
      .returns<{ swim_workout_id: string }[]>().abortSignal(AbortSignal.timeout(10_000));
    if (error || !data) throw new Error("The swimming schedule could not be loaded.");
    for (const row of data) ids.add(row.swim_workout_id);
    if (data.length < 500) return ids;
  }
}
