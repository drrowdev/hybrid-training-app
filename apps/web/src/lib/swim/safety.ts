import type { SupabaseClient } from "@supabase/supabase-js";
import { ALL_REGIONS, swimWorkoutExposure, type Region, type SwimWorkout } from "@hta/domain";
import {
  deriveLimitationsContext,
  type LimitationsContext,
} from "@/lib/planner/limitations-context";
import { MUSCLE_TO_REGION } from "@/lib/limitations/region";
import { REGION_LABELS } from "@/lib/settings/limitations-constants";

export type SwimSafetyExposure = {
  regions: readonly Region[];
  movementIds?: readonly string[];
};

export function swimWorkoutSafetyExposure(
  workout: SwimWorkout,
  movementIds?: readonly string[],
): SwimSafetyExposure {
  return { regions: swimWorkoutExposure(workout).regions, movementIds };
}

export function swimLimitationConflicts(
  context: LimitationsContext,
  exposure: SwimSafetyExposure,
): { regions: Region[]; movementBlocked: boolean } {
  const blockedRegions = new Set(context.blockedRegions);
  const movementIds = exposure.movementIds ?? [];
  const muscleFilterBypassed = movementIds.length > 0 &&
    movementIds.every((id) => context.allowedMovementIds.has(id));
  for (const muscle of muscleFilterBypassed ? [] : context.blockedMuscles) {
    const region = MUSCLE_TO_REGION[muscle];
    if (region) blockedRegions.add(region);
  }
  const regions = ALL_REGIONS.filter(
    (region) => exposure.regions.includes(region) && blockedRegions.has(region),
  );
  const movementBlocked = movementIds.some(
    (id) => context.blockedMovementIds.has(id) && !context.allowedMovementIds.has(id),
  );
  return { regions, movementBlocked };
}

/** Unlike the legacy planner reader, a failed safety read cannot allow a start. */
export async function assertSwimSafety(
  supabase: SupabaseClient,
  userId: string,
  exposure: SwimSafetyExposure,
): Promise<void> {
  const { data, error } = await supabase
    .from("limitations")
    .select("region, kind, resolved_at, affected_muscles, affected_movement_ids, allowed_movement_ids")
    .eq("user_id", userId)
    .is("resolved_at", null);
  if (error) throw new Error("Could not check your limitations. Try again before swimming.");
  if (!data) throw new Error("Could not check your limitations. Try again before swimming.");
  const conflicts = swimLimitationConflicts(deriveLimitationsContext(data), exposure);
  if (conflicts.regions.length > 0) {
    const labels = conflicts.regions.map((region) => REGION_LABELS[region]).join(", ");
    throw new Error(`Review your active limitations before swimming: ${labels}.`);
  }
  if (conflicts.movementBlocked) {
    throw new Error("Swimming is blocked by an active limitation. Review it before starting.");
  }
}
