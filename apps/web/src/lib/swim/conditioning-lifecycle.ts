import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { conditioningStorageAvailable } from "./conditioning-storage";
import { isMissingRpc } from "../supabase/rpc-errors";
import { SwimActionError } from "./server-context";

const plan = { planId: z.string().uuid(), planRevision: z.number().int().positive() };
const workout = { ...plan, workoutId: z.string().uuid(), workoutRevision: z.number().int().positive() };
const reason = z.string().trim().min(1).max(1000);
export const conditioningChangeSchema = z.discriminatedUnion("command", [
  z.object({ ...plan, command: z.literal("pause") }).strict(),
  z.object({ ...plan, command: z.literal("resume") }).strict(),
  z.object({ ...plan, command: z.literal("finish") }).strict(),
  z.object({ ...workout, command: z.literal("skip"), reason }).strict(),
  z.object({ ...workout, command: z.literal("unskip") }).strict(),
  z.object({ ...workout, command: z.literal("move"), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reason,
    warnings: z.array(z.string().max(160)).max(2),
  }).strict(),
]);
export type ConditioningChange = z.infer<typeof conditioningChangeSchema>;

export async function conditioningLifecycleAvailable(client: SupabaseClient) {
  const { data, error } = await client.rpc("swim_conditioning_lifecycle_ready").abortSignal(AbortSignal.timeout(10_000));
  if (error && isMissingRpc(error)) return false;
  if (error || data !== true) throw new Error("The swimming controls could not be loaded.");
  return true;
}

export async function conditioningPlanLink(client: SupabaseClient, userId: string, planId: string) {
  if (!await conditioningStorageAvailable(client)) return null;
  const { data, error } = await client.from("swim_conditioning_sessions")
    .select("block_id,planned_session_id").eq("user_id", userId).eq("plan_id", planId)
    .order("id").limit(1).returns<{ block_id: string | null; planned_session_id: string | null }[]>()
    .abortSignal(AbortSignal.timeout(10_000));
  if (error || !data) throw new Error("The swimming programme could not be loaded.");
  return data[0] ?? null;
}

function changeFailure(error: { code?: string; message?: string }): never {
  if (error.message === "CONDITIONING_DATE_OCCUPIED" || error.code === "23505") {
    throw new SwimActionError("That slot already has a workout. Choose another date.", "validation");
  }
  if (error.message === "CONDITIONING_DATE_OUTSIDE_PROGRAM") {
    throw new SwimActionError("Choose a future date in this swim's week, within the programme.", "validation");
  }
  if (error.code === "40001") throw new SwimActionError("Your programme changed. Reload and try again.", "validation");
  if (error.code === "42501") throw new SwimActionError("You cannot change this swim.", "forbidden");
  if (error.code === "P0001") throw new SwimActionError("Swimming is currently restricted. Review your active limitations.", "validation");
  if (error.code === "22023") throw new SwimActionError("This change could not be saved. Reload and try again.", "validation");
  throw new SwimActionError("Could not save this change. Try again.", "transient");
}

export async function replayConditioningChange(client: SupabaseClient, requestId: string, input: ConditioningChange) {
  const { data, error } = await client.rpc("swim_replay_conditioning_change", {
    p_plan_id: input.planId, p_request_id: requestId, p_input: input,
  }).abortSignal(AbortSignal.timeout(10_000));
  if (error) changeFailure(error);
  if (data !== null && data !== requestId) throw new Error("The saved swimming change could not be confirmed.");
  return data === requestId;
}

export async function saveConditioningChange(client: SupabaseClient, requestId: string, input: ConditioningChange) {
  const { data, error } = await client.rpc("swim_change_conditioning", {
    p_request_id: z.string().uuid().parse(requestId), p_input: conditioningChangeSchema.parse(input),
  }).abortSignal(AbortSignal.timeout(20_000));
  if (error) changeFailure(error);
  if (data !== requestId) throw new Error("The saved swimming change could not be confirmed.");
}
