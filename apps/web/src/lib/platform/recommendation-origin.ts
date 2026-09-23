import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const recommendationSchema = z.object({
  id: z.string().uuid(),
  block_id: z.string().uuid(),
  program_instance_id: z.string().uuid(),
  kind: z.enum(["next-block", "deload"]),
  data: z.record(z.unknown()).nullable(),
  occurrence_key: z.string().nullable(),
  status: z.literal("pending"),
  detail: z.string(),
});
const sourceBlockSchema = z.object({
  id: z.string().uuid(),
  program_kind: z.enum(["strength", "running", "hybrid"]).nullable().optional(),
  status: z.enum(["active", "completed"]),
  deleted_at: z.null(),
});
const sourceInstanceSchema = z.object({
  id: z.string().uuid(), block_id: z.string().uuid(), program_id: z.string().min(1),
  status: z.enum(["active", "archived"]), deleted_at: z.null(),
});

export type ProgramRecommendationOrigin = {
  recommendationId: string;
  blockId: string;
  kind: "next-block" | "deload";
  programId: string;
  phaseId?: string;
  recoveryWarning?: string;
  snapshot: Omit<z.infer<typeof recommendationSchema>, "status" | "detail"> & {
    program_kind: "strength" | "running" | "hybrid" | null;
  };
};

export type ProgramRecommendationSetup = Pick<ProgramRecommendationOrigin,
  "recommendationId" | "programId" | "phaseId" | "kind" | "recoveryWarning">;

export function matchesRecommendationSetup(
  origin: ProgramRecommendationSetup, programId: string, setupValues: Record<string, unknown>,
): boolean {
  return origin.programId === programId && (origin.kind !== "next-block" || origin.phaseId === setupValues.phaseId);
}

export async function loadProgramRecommendationOrigin(
  client: Pick<SupabaseClient, "from">, userId: string, id: string,
): Promise<ProgramRecommendationOrigin> {
  if (!z.string().uuid().safeParse(id).success) throw new Error("This recommendation is unavailable.");
  const result = await client.from("program_recommendations")
    .select("id,block_id,program_instance_id,kind,data,occurrence_key,status,detail")
    .eq("id", id).eq("user_id", userId).maybeSingle();
  if (result.error) throw new Error("Could not load this recommendation. Try again.", { cause: result.error });
  const parsed = recommendationSchema.safeParse(result.data);
  if (!parsed.success) throw new Error("This recommendation is no longer available.");
  const recommendation = parsed.data;
  const [blockResult, instanceResult] = await Promise.all([
    client.from("training_blocks").select("*").eq("id", recommendation.block_id).eq("user_id", userId).maybeSingle(),
    client.from("program_instances").select("id,block_id,program_id,status,deleted_at")
      .eq("id", recommendation.program_instance_id).eq("block_id", recommendation.block_id).eq("user_id", userId).maybeSingle(),
  ]);
  if (blockResult.error || instanceResult.error) {
    throw new Error("Could not load this recommendation's program. Try again.", { cause: blockResult.error ?? instanceResult.error });
  }
  const block = sourceBlockSchema.safeParse(blockResult.data);
  const instance = sourceInstanceSchema.safeParse(instanceResult.data);
  if (!block.success || !instance.success || (block.data.status === "active" && instance.data.status !== "active")) {
    throw new Error("This recommendation's program is no longer available.");
  }
  const phaseId = recommendation.kind === "next-block" ? recommendation.data?.nextPhaseId : undefined;
  const programId = recommendation.kind === "next-block" ? recommendation.data?.programId : instance.data.program_id;
  if (typeof programId !== "string" || !programId ||
    (recommendation.kind === "next-block" && (typeof phaseId !== "string" || !phaseId))) {
    throw new Error("This recommendation can't start a new program.");
  }
  return {
    recommendationId: id, blockId: recommendation.block_id, kind: recommendation.kind, programId,
    ...(typeof phaseId === "string" ? { phaseId } : {}),
    ...(recommendation.kind === "deload" ? { recoveryWarning: recommendation.detail } : {}),
    snapshot: {
      id: recommendation.id, block_id: recommendation.block_id, program_instance_id: recommendation.program_instance_id,
      kind: recommendation.kind, data: recommendation.data, occurrence_key: recommendation.occurrence_key,
      program_kind: block.data.program_kind ?? null,
    },
  };
}
