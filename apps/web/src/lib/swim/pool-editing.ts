import type { SupabaseClient } from "@supabase/supabase-js";
import { swimmingPool, type PoolCourse } from "@hta/domain";
import type { SwimPlanRow, SwimWorkoutRow } from "./storage";
import type { SwimPoolEditContext } from "./view-types";

export async function swimPoolEditingAvailable(client: SupabaseClient): Promise<boolean> {
  if (process.env.SWIM_POOL_EDITING_ENABLED !== "true") return false;
  const { data, error } = await client.rpc("swim_pool_editing_ready").abortSignal(AbortSignal.timeout(10_000));
  if (error || data !== true) throw new Error("Pool changes are currently unavailable.");
  return true;
}

export function swimProgrammePool(plan: SwimPlanRow): PoolCourse {
  return swimmingPool(plan.definition.setup.course, plan.state.poolCourse);
}

export function swimPoolEditContext(plan: SwimPlanRow, today: string, workout?: SwimWorkoutRow): SwimPoolEditContext | undefined {
  if (plan.status !== "active" && plan.status !== "paused") return undefined;
  if (workout && (workout.status !== "scheduled" || workout.session_id || workout.scheduled_date < today)) return undefined;
  return {
    planId: plan.id, revision: plan.revision, defaultCourse: swimProgrammePool(plan),
    ...(workout ? { workout: {
      id: workout.id, revision: workout.revision, course: workout.definition.issued.snapshot.course,
      ...(workout.definition.poolCourse ? { override: workout.definition.poolCourse } : {}),
    } } : {}),
  };
}
