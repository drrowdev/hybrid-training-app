import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingRpc } from "../supabase/rpc-errors";

const bindingSchema = z.object({
  user_id: z.string().uuid(), planned_session_id: z.string().uuid().nullable(),
  swim_workout_id: z.string().uuid(), block_id: z.string().uuid().nullable(),
  metadata: z.object({
    version: z.literal(1), workoutRevision: z.number().int().positive(),
    plannedPrescription: z.record(z.unknown()), plannedSessionId: z.string().uuid(), blockId: z.string().uuid(),
  }).strict(),
  created_at: z.string(),
}).strict();
const saveSchema = z.object({
  user_id: z.string().uuid(), request_id: z.string().uuid(),
  block_id: z.string().uuid().nullable(), program_instance_id: z.string().uuid().nullable(),
  swim_plan_id: z.string().uuid(),
  metadata: z.object({ fingerprint: z.string().regex(/^[a-f0-9]{64}$/), skipped: z.number().int().nonnegative() }).strict(),
  created_at: z.string(),
}).strict();

export async function conditioningStorageAvailable(client: SupabaseClient, includeBenchmarks = false): Promise<boolean> {
  const names = includeBenchmarks
    ? ["swim_conditioning_ready", "swim_conditioning_benchmarks_ready"]
    : ["swim_conditioning_ready"];
  for (const name of names) {
    const { data, error } = await client.rpc(name).abortSignal(AbortSignal.timeout(10_000));
    if (error && isMissingRpc(error)) return false;
    if (error || data !== true) throw new Error("Programme conditioning availability could not be checked.");
  }
  return true;
}

async function readAll<S extends typeof bindingSchema | typeof saveSchema>(
  client: SupabaseClient, userId: string,
  table: "swim_conditioning_bindings" | "swim_conditioning_saves", schema: S, key: string,
): Promise<z.infer<S>[]> {
  const result: z.infer<S>[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await client.from(table).select(Object.keys(schema.shape).join(","))
      .eq("user_id", userId).order(key).range(offset, offset + 499);
    const parsed = z.array(schema).safeParse(data);
    if (error || !parsed.success || parsed.data.some((row) => row.user_id !== userId)) {
      throw new Error("Programme conditioning history could not be exported.");
    }
    result.push(...parsed.data);
    if (parsed.data.length < 500) return result;
  }
}

export async function exportSwimConditioning(client: SupabaseClient, userId: string) {
  const [bindings, saves] = await Promise.all([
    readAll(client, userId, "swim_conditioning_bindings", bindingSchema, "swim_workout_id"),
    readAll(client, userId, "swim_conditioning_saves", saveSchema, "request_id"),
  ]);
  return { bindings, saves };
}
