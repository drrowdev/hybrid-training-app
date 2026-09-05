import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  SwimPlanDefinition,
  SwimPlanState,
  SwimWorkoutDefinition,
  SwimActualResult,
} from "@hta/db";
import { requireSwimSetup } from "./capability";

export type SwimPlanStatus = "active" | "paused" | "finished" | "archived";
export type SwimWorkoutStatus = "scheduled" | "started" | "completed" | "skipped";
export type SwimSlot = "single" | "am" | "pm";
export type StoredSwimWorkoutDefinition = SwimWorkoutDefinition;
export type SwimPlanRow = {
  id: string; user_id: string; status: SwimPlanStatus;
  started_on: string; ends_on: string; revision: number;
  definition: SwimPlanDefinition; state: SwimPlanState;
  created_at: string; updated_at: string;
};
export type SwimWorkoutRow = {
  id: string; user_id: string; plan_id: string; scheduled_date: string;
  slot: SwimSlot; revision: number; status: SwimWorkoutStatus;
  session_id: string | null; definition: StoredSwimWorkoutDefinition;
  created_at: string; updated_at: string;
};
export type SwimPlanWithWorkouts = { plan: SwimPlanRow; workouts: SwimWorkoutRow[] };
export type SwimCompletion = {
  workout: SwimWorkoutRow; session_id: string; cardio_log_id: string; transitioned: boolean;
};
export type SwimWorkoutInput = {
  scheduled_date: string; slot: SwimSlot; definition: SwimWorkoutDefinition;
};
export type CreateSwimPlanInput = {
  startedOn: string; endsOn: string; definition: SwimPlanDefinition;
  state: SwimPlanState; workouts: SwimWorkoutInput[];
};
export type UpdateSwimPlanInput = {
  planId: string; expectedRevision: number; definition: SwimPlanDefinition; state: SwimPlanState;
  workouts: (SwimWorkoutInput & { id: string; expected_revision: number })[];
};
export type CompleteSwimWorkoutInput = {
  workoutId: string; expectedRevision: number; result: SwimActualResult;
  clientLogId: string; completionEntryId: string; notes?: string | null; allowChangedCourse?: boolean;
};
export type EditSwimResultInput = Omit<CompleteSwimWorkoutInput, "clientLogId" | "completionEntryId">;

async function rpc<T>(client: SupabaseClient, name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(`Swimming: ${error.message}`, { cause: error });
  if (data === null || data === undefined) throw new Error(`Swimming: ${name} returned no data.`);
  return data as T;
}

export async function listSwimPlans(client: SupabaseClient): Promise<SwimPlanRow[]> {
  const { data, error } = await client.from("swim_plans").select("*").order("created_at", { ascending: false });
  if (error) throw new Error(`Swimming plans: ${error.message}`, { cause: error });
  return (data ?? []) as SwimPlanRow[];
}

export async function listSwimWorkouts(client: SupabaseClient, planId?: string): Promise<SwimWorkoutRow[]> {
  let query = client.from("swim_workouts").select("*").order("scheduled_date").order("id");
  if (planId) query = query.eq("plan_id", planId);
  const { data, error } = await query;
  if (error) throw new Error(`Swimming workouts: ${error.message}`, { cause: error });
  return (data ?? []) as SwimWorkoutRow[];
}

export async function getSwimWorkout(client: SupabaseClient, workoutId: string): Promise<SwimWorkoutRow | null> {
  const { data, error } = await client.from("swim_workouts").select("*").eq("id", workoutId).maybeSingle();
  if (error) throw new Error(`Swimming workout: ${error.message}`, { cause: error });
  return data as SwimWorkoutRow | null;
}

export async function getSwimWorkoutForSession(client: SupabaseClient, sessionId: string): Promise<SwimWorkoutRow | null> {
  const { data, error } = await client.from("swim_workouts").select("*").eq("session_id", sessionId).maybeSingle();
  if (error) throw new Error(`Swimming workout: ${error.message}`, { cause: error });
  return data as SwimWorkoutRow | null;
}

export async function getSwimResult(client: SupabaseClient, sessionId: string): Promise<SwimActualResult | null> {
  const { data, error } = await client.from("cardio_logs").select("swim_result")
    .eq("session_id", sessionId).not("swim_result", "is", null).maybeSingle();
  if (error) throw new Error(`Swimming result: ${error.message}`, { cause: error });
  return (data?.swim_result ?? null) as SwimActualResult | null;
}

export async function createSwimPlan(client: SupabaseClient, input: CreateSwimPlanInput): Promise<SwimPlanWithWorkouts> {
  await requireSwimSetup(client);
  return rpc(client, "swim_create_plan", {
    p_started_on: input.startedOn, p_ends_on: input.endsOn,
    p_definition: input.definition, p_state: input.state, p_workouts: input.workouts,
  });
}

export function startSwimWorkout(client: SupabaseClient, workoutId: string, expectedRevision: number): Promise<SwimWorkoutRow> {
  return rpc(client, "swim_start_workout", { p_workout_id: workoutId, p_expected_revision: expectedRevision });
}

export function updateSwimPlan(client: SupabaseClient, input: UpdateSwimPlanInput): Promise<SwimPlanWithWorkouts> {
  return rpc(client, "swim_update_plan", {
    p_plan_id: input.planId, p_expected_revision: input.expectedRevision,
    p_definition: input.definition, p_state: input.state, p_workouts: input.workouts,
  });
}

export function setSwimPlanStatus(client: SupabaseClient, planId: string, expectedRevision: number, status: SwimPlanStatus): Promise<SwimPlanRow> {
  return rpc(client, "swim_set_plan_status", { p_plan_id: planId, p_expected_revision: expectedRevision, p_status: status });
}

export function skipSwimWorkout(client: SupabaseClient, workoutId: string, expectedRevision: number, reason?: string): Promise<SwimWorkoutRow> {
  return rpc(client, "swim_skip_workout", { p_workout_id: workoutId, p_expected_revision: expectedRevision, p_reason: reason ?? null });
}

export function resumeSwimPlan(client: SupabaseClient, input: UpdateSwimPlanInput): Promise<SwimPlanWithWorkouts> {
  return rpc(client, "swim_resume_plan", {
    p_plan_id: input.planId, p_expected_revision: input.expectedRevision,
    p_definition: input.definition, p_state: input.state, p_workouts: input.workouts,
  });
}

export function completeSwimWorkout(client: SupabaseClient, input: CompleteSwimWorkoutInput): Promise<SwimCompletion> {
  return rpc(client, "swim_complete_workout", {
    p_workout_id: input.workoutId, p_expected_revision: input.expectedRevision, p_result: input.result,
    p_client_log_id: input.clientLogId, p_completion_entry_id: input.completionEntryId,
    p_notes: input.notes ?? null, p_allow_changed_course: input.allowChangedCourse ?? false,
  });
}

export function editSwimResult(client: SupabaseClient, input: EditSwimResultInput): Promise<SwimCompletion> {
  return rpc(client, "swim_edit_result", {
    p_workout_id: input.workoutId, p_expected_revision: input.expectedRevision,
    p_result: input.result, p_notes: input.notes ?? null, p_allow_changed_course: input.allowChangedCourse ?? false,
    p_notes_supplied: input.notes !== undefined,
  });
}
