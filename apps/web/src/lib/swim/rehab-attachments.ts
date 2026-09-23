import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { independentProgramsAvailable } from "@/lib/programs/ownership";
import { loadTrainingSchedule } from "@/lib/schedule/storage";
import type { SwimPlanRow } from "./storage";

const protocolSchema = z.object({ id: z.string().uuid(), name: z.string() });
const bindingSchema = z.object({ rehab_protocol_id: z.string().uuid() });
const usagePlanSchema = z.object({
  id: z.string().uuid(), status: z.enum(["active", "paused", "finished", "archived"]),
  definition: z.object({ privateCourse: z.object({ title: z.string() }).optional() }),
});

export interface SwimRehabAttachments {
  planId: string;
  revision: string;
  editable: boolean;
  protocols: { id: string; name: string }[];
  attachedIds: string[];
}

export async function loadSwimRehabAttachments(
  client: SupabaseClient, userId: string, plan: Pick<SwimPlanRow, "id" | "user_id" | "status">,
): Promise<SwimRehabAttachments | null> {
  if (plan.user_id !== userId) throw new Error("Swimming program not found.");
  if (!await independentProgramsAvailable(client)) return null;
  const snapshot = await loadTrainingSchedule(client);
  const [protocols, bindings] = await Promise.all([
    client.from("rehab_protocols").select("id,name").eq("user_id", userId).order("name"),
    client.from("swim_plan_rehab_bindings").select("rehab_protocol_id").eq("user_id", userId).eq("plan_id", plan.id),
  ]);
  if (protocols.error || bindings.error) throw new Error("Could not load your rehab attachments. Try again.");
  const library = z.array(protocolSchema).parse(protocols.data);
  const attachedIds = z.array(bindingSchema).parse(bindings.data).map((binding) => binding.rehab_protocol_id);
  if (attachedIds.some((id) => !library.some((protocol) => protocol.id === id))) {
    throw new Error("A rehab attachment could not be read. Reload and try again.");
  }
  return { planId: plan.id, revision: snapshot.revision, editable: plan.status === "active" || plan.status === "paused",
    protocols: library, attachedIds };
}

export async function loadSwimRehabUsage(client: SupabaseClient, userId: string, protocolId?: string) {
  if (!await independentProgramsAvailable(client)) return [];
  let query = client.from("swim_plan_rehab_bindings").select("rehab_protocol_id,plan_id").eq("user_id", userId);
  if (protocolId) query = query.eq("rehab_protocol_id", protocolId);
  const result = await query;
  if (result.error) throw new Error("Could not check the swimming programs using this protocol. Try again.");
  const bindings = z.array(bindingSchema.extend({ plan_id: z.string().uuid() })).parse(result.data);
  if (bindings.length === 0) return [];
  const resultPlans = await client.from("swim_plans").select("id,status,definition")
    .eq("user_id", userId).in("id", [...new Set(bindings.map((binding) => binding.plan_id))]);
  if (resultPlans.error) throw new Error("Could not read the swimming programs using this protocol. Try again.");
  const plans = z.array(usagePlanSchema).parse(resultPlans.data);
  return bindings.map((binding) => {
    const plan = plans.find((entry) => entry.id === binding.plan_id);
    if (!plan) throw new Error("A swimming program using this protocol could not be read. Reload and try again.");
    return { protocolId: binding.rehab_protocol_id, planId: plan.id,
      name: plan.definition.privateCourse?.title ?? "Swimming",
      active: plan.status === "active" || plan.status === "paused" };
  });
}
