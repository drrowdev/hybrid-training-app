import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { accountMaxMovementIds, scheduledProgressionCandidates, type ProgressionProgram } from "@hta/domain";
import { isMissingScheduleFunction } from "@/lib/schedule/storage";

export function progressionStorageUnavailable(error: { code?: string; message?: string } | null): boolean {
  return isMissingScheduleFunction(error, "generate_scheduled_max_progression") ||
    (!!error && error.code === "23514" && !!error.message?.includes("tm_suggestions_source_chk"));
}

const movementSchema = z.object({
  pattern: z.string(), primary_region: z.string(), primary_muscles: z.array(z.string()),
});
const maxSchema = z.object({
  movement_id: z.string(), one_rm_kg: z.coerce.number().nullable(), updated_at: z.string(),
  movements: z.union([movementSchema, z.array(movementSchema)]),
});
const suggestionSchema = z.object({
  movement_id: z.string(), source: z.string(), status: z.string(), resolved_at: z.string().nullable(),
  created_at: z.string(), current_tm_kg: z.coerce.number().nullable(),
});
const planSchema = z.object({
  block_id: z.string(),
  prescription: z.object({ items: z.array(z.object({
    movementId: z.string(), percentTm: z.number().nullable().optional(), meta: z.record(z.unknown()).optional(),
  })) }),
});

export async function generateScheduledProgression(
  client: SupabaseClient, userId: string,
  blocks: readonly { id: string; programKind: string | null }[],
  profile: { units?: string; intake?: unknown },
): Promise<{ available: boolean; activeMovementIds: Set<string> }> {
  const intake = z.record(z.unknown()).parse(profile.intake ?? {});
  if (profile.units !== "metric" || intake.suggestScheduled1RmIncreases === false) {
    return { available: false, activeMovementIds: new Set() };
  }
  const [plans, maxes, suggestions] = await Promise.all([
    blocks.length ? client.from("planned_sessions").select("block_id,prescription").eq("user_id", userId).in("block_id", blocks.map((block) => block.id))
      : Promise.resolve({ data: [], error: null }),
    client.from("training_maxes").select("movement_id,one_rm_kg,updated_at,movements(pattern,primary_region,primary_muscles)").eq("user_id", userId),
    client.from("tm_suggestions").select("movement_id,source,status,resolved_at,created_at,current_tm_kg").eq("user_id", userId),
  ]);
  if (plans.error || maxes.error || suggestions.error) {
    throw new Error("Couldn't read 1RM suggestions. Try again.", { cause: plans.error ?? maxes.error ?? suggestions.error });
  }
  const programs: ProgressionProgram[] = z.array(planSchema).parse(plans.data).map((plan) => ({
    active: true, owned: blocks.find((block) => block.id === plan.block_id)?.programKind != null, items: plan.prescription.items,
  }));
  const parsedMaxes = z.array(maxSchema).parse(maxes.data);
  const activeMovementIds = accountMaxMovementIds(programs);
  const candidates = scheduledProgressionCandidates({
    now: new Date(), enabled: true, units: profile.units, programs,
    maxes: parsedMaxes.flatMap((max) => {
      const movement = Array.isArray(max.movements) ? max.movements[0] : max.movements;
      return max.one_rm_kg == null || !movement ? [] : [{
        movementId: max.movement_id, oneRmKg: max.one_rm_kg, updatedAt: max.updated_at,
        movement: { pattern: movement.pattern, primaryRegion: movement.primary_region, primaryMuscles: movement.primary_muscles },
      }];
    }),
    suggestions: z.array(suggestionSchema).parse(suggestions.data).filter((suggestion) => {
      if (suggestion.source !== "scheduled_progression" || suggestion.status !== "pending") return true;
      const max = parsedMaxes.find((row) => row.movement_id === suggestion.movement_id);
      return max && max.one_rm_kg === suggestion.current_tm_kg && Date.parse(max.updated_at) <= Date.parse(suggestion.created_at);
    }).map((suggestion) => ({
      movementId: suggestion.movement_id, source: suggestion.source, status: suggestion.status, resolvedAt: suggestion.resolved_at,
    })),
  });
  const result = await client.rpc("generate_scheduled_max_progression", { p_candidates: candidates });
  if (progressionStorageUnavailable(result.error)) return { available: false, activeMovementIds };
  if (result.error) throw new Error("Couldn't prepare 1RM suggestions. Try again.", { cause: result.error });
  if (!Number.isInteger(result.data) || result.data < 0) throw new Error("Couldn't save your choices. Try again.");
  return { available: true, activeMovementIds };
}
