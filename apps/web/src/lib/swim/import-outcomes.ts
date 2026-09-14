import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { isMissingRpc } from "@/lib/supabase/rpc-errors";

export const importOutcomeSchema = z.object({
  id: z.string().uuid(), workout_id: z.string().uuid(), match_id: z.string().uuid().nullable(),
  revision: z.number().int().positive(), created_at: z.string(),
  metadata: z.object({
    outcome: z.enum(["completed", "stopped_early"]).nullable(),
    previousOutcomeId: z.string().uuid().nullable(),
    workoutRevision: z.number().int().positive().max(2147483647).nullable(),
  }).strict(),
}).strict().refine((row) =>
  (row.match_id === null) === (row.metadata.outcome === null) &&
  (row.match_id === null) === (row.metadata.workoutRevision === null));
export type SwimImportOutcome = z.infer<typeof importOutcomeSchema>;
export const importOutcomeColumns = "id,workout_id,match_id,revision,metadata,created_at";

export async function swimImportOutcomesAvailable(client: SupabaseClient): Promise<boolean> {
  const { data, error } = await client.rpc("swim_import_outcomes_ready").abortSignal(AbortSignal.timeout(10_000));
  if (error) {
    if (isMissingRpc(error)) return false;
    throw new Error("Swim outcomes could not be loaded.");
  }
  if (data !== true) throw new Error("Swim outcomes returned an invalid response.");
  return true;
}

export async function loadSwimImportOutcome(client: SupabaseClient, userId: string, workoutId: string) {
  const result = await client.from("swim_current_import_outcomes").select(importOutcomeColumns)
    .eq("user_id", userId).eq("workout_id", workoutId).maybeSingle();
  const parsed = importOutcomeSchema.nullable().safeParse(result.data);
  if (result.error || !parsed.success) throw new Error("The swim outcome could not be loaded.");
  return parsed.data;
}

export async function exportSwimImportOutcomes(client: SupabaseClient, userId: string) {
  const rows: SwimImportOutcome[] = [];
  for (let offset = 0; ; offset += 1000) {
    const result = await client.from("swim_import_outcomes").select(importOutcomeColumns)
      .eq("user_id", userId).order("id").range(offset, offset + 999);
    const parsed = z.array(importOutcomeSchema).safeParse(result.data);
    if (result.error || !parsed.success) throw new Error("Swim outcomes could not be exported.");
    rows.push(...parsed.data);
    if (parsed.data.length < 1000) return rows;
  }
}
