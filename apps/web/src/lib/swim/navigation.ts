import type { SupabaseClient } from "@supabase/supabase-js";
import { getSwimCapability } from "./capability";

export async function getSwimNavigation(client: SupabaseClient, userId: string) {
  const capability = await getSwimCapability(client);
  if (!capability.storageAvailable) return { ...capability, hasPlans: false };
  const { data, error } = await client.from("swim_plans")
    .select("id").eq("user_id", userId).limit(1);
  if (error) throw new Error("Could not load swimming.", { cause: error });
  return { ...capability, hasPlans: !!data?.length };
}

export function swimEntryHref(navigation: { hasPlans: boolean; setupEnabled: boolean }): string | null {
  if (navigation.hasPlans) return "/app/swim";
  return navigation.setupEnabled ? "/app/swim/setup" : null;
}

export async function findSwimWorkoutForSession(client: SupabaseClient, userId: string, sessionId: string): Promise<string | null> {
  const capability = await getSwimCapability(client);
  if (!capability.storageAvailable) return null;
  const { data, error } = await client.from("swim_workouts").select("id")
    .eq("user_id", userId).eq("session_id", sessionId).maybeSingle();
  if (error) throw new Error("Could not load the swim workout.", { cause: error });
  return data?.id ?? null;
}
