import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { listSwimPlans } from "./storage";
import { swimPlanDefinition } from "./model";

export function replacementPlanId(form: FormData): string | undefined {
  const value = form.get("replacePlanId");
  return value ? z.string().uuid().parse(value) : undefined;
}

export async function loadSwimReplacement(client: SupabaseClient, userId: string, id?: string) {
  if (!id) return undefined;
  const plan = (await listSwimPlans(client)).find((entry) => entry.id === id && entry.user_id === userId);
  if (!plan || !["active", "paused"].includes(plan.status)) {
    throw new Error("This swimming plan is no longer available to replace.");
  }
  const definition = swimPlanDefinition(plan);
  return { id: plan.id, revision: plan.revision, name: definition.privateCourse?.title ??
    (definition.setup.goal === "endurance" ? "Swim endurance" : "Swim technique") };
}
