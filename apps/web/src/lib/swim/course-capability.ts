import type { SupabaseClient } from "@supabase/supabase-js";

export async function privateSwimCourseAvailable(client: SupabaseClient): Promise<boolean> {
  if (process.env.SWIM_PRIVATE_COURSE_ENABLED !== "true") return false;
  const { data, error } = await client.rpc("swim_untimed_course_ready").abortSignal(AbortSignal.timeout(10_000));
  if (error || data !== true) throw new Error("Plan imports are currently unavailable.");
  return true;
}
