import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { independentProgramsAvailable } from "@/lib/programs/ownership";
import { loadTrainingSchedule } from "@/lib/schedule/storage";

export const swimRehabOriginSchema = z.object({
  version: z.literal(1), planId: z.string().uuid(), workoutId: z.string().uuid(),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), protocolId: z.string().uuid(),
  protocolRevision: z.number().int().positive(), protocolName: z.string().optional(),
});

export function readSwimRehabOrigin(prescription: unknown) {
  if (typeof prescription !== "object" || prescription === null || !("meta" in prescription)) return null;
  const meta = prescription.meta;
  if (typeof meta !== "object" || meta === null || !("swimRehab" in meta)) return null;
  const parsed = swimRehabOriginSchema.safeParse(meta.swimRehab);
  if (!parsed.success) throw new Error("The swimming rehab workout could not be read. Reload and try again.");
  return parsed.data;
}

const sessionSchema = z.object({
  id: z.string().uuid(), title: z.string().nullable(), prescription: z.unknown(),
  completed_at: z.string().nullable(), deleted_at: z.string().nullable(),
});
const receiptSchema = z.object({
  context: z.object({
    kind: z.literal("swim-rehab-start-v1"), origin: swimRehabOriginSchema, sessionId: z.string().uuid(),
  }),
});
const workoutSchema = z.object({
  id: z.string().uuid(), plan_id: z.string().uuid(), scheduled_date: z.string(),
  status: z.enum(["scheduled", "started", "completed", "skipped"]),
});
const planSchema = z.object({ id: z.string().uuid(), status: z.enum(["active", "paused", "finished", "archived"]) });

export async function readSwimRehabSession(client: SupabaseClient, userId: string, sessionId: string) {
  const result = await client.from("sessions").select("id,title,prescription,completed_at,deleted_at")
    .eq("user_id", userId).eq("id", sessionId).maybeSingle();
  if (result.error) throw new Error("Could not read your rehab workout. Try again.");
  return result.data === null ? null : sessionSchema.parse(result.data);
}

export async function readSwimRehabReceipts(client: SupabaseClient, userId: string, workoutId: string, protocolId?: string) {
  let query = client.from("engine_override_events").select("context").eq("user_id", userId)
    .eq("context->>kind", "swim-rehab-start-v1").eq("context->origin->>workoutId", workoutId);
  if (protocolId) query = query.eq("context->origin->>protocolId", protocolId);
  const result = await query;
  if (result.error) throw new Error("Could not check your previous rehab starts. Try again.");
  const receipts = z.array(receiptSchema).parse(result.data).map((row) => row.context);
  if (new Set(receipts.map((receipt) => receipt.origin.protocolId)).size !== receipts.length ||
      receipts.some((receipt) => receipt.origin.workoutId !== workoutId ||
        (protocolId !== undefined && receipt.origin.protocolId !== protocolId))) {
    throw new Error("The rehab workout receipts could not be confirmed. Reload and try again.");
  }
  return receipts;
}

export interface SwimRehabWorkoutContext {
  workoutId: string;
  revision: string;
  canStart: boolean;
  entries: {
    protocolId: string; name: string; sessionId: string | null;
    status: "available" | "started" | "completed" | "deleted" | "removed";
  }[];
}

export async function loadSwimRehabWorkouts(
  client: SupabaseClient, userId: string, workoutId: string,
): Promise<SwimRehabWorkoutContext | null> {
  if (!await independentProgramsAvailable(client)) return null;
  const snapshot = await loadTrainingSchedule(client);
  const workoutResult = await client.from("swim_workouts").select("id,plan_id,scheduled_date,status")
    .eq("user_id", userId).eq("id", workoutId).maybeSingle();
  if (workoutResult.error || !workoutResult.data) throw new Error("Swimming workout not found.");
  const workout = workoutSchema.parse(workoutResult.data);
  const [planResult, bindingsResult, receipts] = await Promise.all([
    client.from("swim_plans").select("id,status").eq("user_id", userId).eq("id", workout.plan_id).maybeSingle(),
    client.from("swim_plan_rehab_bindings").select("rehab_protocol_id").eq("user_id", userId).eq("plan_id", workout.plan_id),
    readSwimRehabReceipts(client, userId, workoutId),
  ]);
  if (planResult.error || bindingsResult.error || !planResult.data) throw new Error("Could not load your attached rehab. Try again.");
  const plan = planSchema.parse(planResult.data);
  const attachedIds = z.array(z.object({ rehab_protocol_id: z.string().uuid() })).parse(bindingsResult.data)
    .map((binding) => binding.rehab_protocol_id);
  const sessionIds = receipts.map((receipt) => receipt.sessionId);
  const [protocolResult, sessionResult] = await Promise.all([
    attachedIds.length ? client.from("rehab_protocols").select("id,name").eq("user_id", userId).in("id", attachedIds)
      : Promise.resolve({ data: [], error: null }),
    sessionIds.length ? client.from("sessions").select("id,title,prescription,completed_at,deleted_at")
      .eq("user_id", userId).in("id", sessionIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (protocolResult.error || sessionResult.error) throw new Error("Could not load your rehab workouts. Try again.");
  const protocols = z.array(z.object({ id: z.string().uuid(), name: z.string() })).parse(protocolResult.data);
  const sessions = z.array(sessionSchema).parse(sessionResult.data);
  if (attachedIds.some((id) => !protocols.some((protocol) => protocol.id === id))) {
    throw new Error("An attached rehab protocol could not be read. Reload and try again.");
  }
  const entries: SwimRehabWorkoutContext["entries"] = receipts.map((receipt) => {
    const session = sessions.find((entry) => entry.id === receipt.sessionId);
    if (receipt.origin.planId !== plan.id || (session &&
        JSON.stringify(readSwimRehabOrigin(session.prescription)) !== JSON.stringify(receipt.origin))) {
      throw new Error("The rehab workout no longer matches its swimming program. Reload and try again.");
    }
    return {
      protocolId: receipt.origin.protocolId, name: receipt.origin.protocolName ?? session?.title ?? "Rehab",
      sessionId: session?.id ?? null,
      status: !session ? "removed" : session.deleted_at ? "deleted" : session.completed_at ? "completed" : "started",
    };
  });
  for (const protocol of protocols) {
    if (!entries.some((entry) => entry.protocolId === protocol.id)) {
      entries.push({ protocolId: protocol.id, name: protocol.name, sessionId: null, status: "available" });
    }
  }
  return { workoutId, revision: snapshot.revision,
    canStart: ["active", "finished"].includes(plan.status) && workout.status !== "skipped", entries };
}
