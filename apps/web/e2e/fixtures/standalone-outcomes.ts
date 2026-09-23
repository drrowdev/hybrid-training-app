import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { importOutcomeSchema } from "../../src/lib/swim/import-outcomes";

export function standaloneOutcomeNativeQueries(actor: SupabaseClient, userId: string) {
  return {
    sessions: actor.from("sessions").select("id").eq("user_id", userId),
    cardio_logs: actor.from("cardio_logs").select("id,sessions!inner(user_id)").eq("sessions.user_id", userId),
    set_logs: actor.from("set_logs").select("id,sessions!inner(user_id)").eq("sessions.user_id", userId),
    training_blocks: actor.from("training_blocks").select("id").eq("user_id", userId),
    planned_sessions: actor.from("planned_sessions").select("id").eq("user_id", userId),
  };
}

export const standaloneOutcomeExportSchema = z.object({
  schema: z.literal("hybrid-training-app/export-v2"), format_version: z.literal(2),
  swimming_import_outcomes_available: z.literal(true), swim_import_outcomes: z.array(importOutcomeSchema),
  swim_imports: z.array(z.object({ id: z.string().uuid(), evidence: z.object({ date: z.string() }) })),
  sessions: z.array(z.unknown()), cardio_logs: z.array(z.unknown()), set_logs: z.array(z.unknown()),
  training_blocks: z.array(z.unknown()), planned_sessions: z.array(z.unknown()),
});
