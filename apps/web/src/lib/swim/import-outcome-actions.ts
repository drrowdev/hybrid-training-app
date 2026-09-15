"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { swimImportOutcomesAvailable } from "./import-outcomes";
import type { MatchActionResult } from "./import-matching";

const inputSchema = z.object({
  requestId: z.string().uuid(), workoutId: z.string().uuid(),
  matchId: z.string().uuid().nullable(), outcome: z.enum(["completed", "stopped_early"]).nullable(),
  expectedOutcomeId: z.string().uuid().nullable(), workoutRevision: z.number().int().positive().max(2147483647).nullable(),
}).strict().refine((value) => (value.outcome === null) === (value.matchId === null) &&
  (value.outcome === null) === (value.workoutRevision === null));

export async function saveSwimImportOutcome(input: unknown): Promise<MatchActionResult<string> & { warning?: string }> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a matched recording and workout outcome." };
  const { data: { user } } = await getAuthUser();
  if (!user) return { ok: false, error: "Sign in to confirm the swim." };
  const value = parsed.data;
  const client = await createClient();
  if ((value.outcome !== null && process.env.SWIM_IMPORT_OUTCOMES_ENABLED !== "true") ||
      !await swimImportOutcomesAvailable(client)) {
    return { ok: false, error: "Swim confirmation is not available yet." };
  }
  const { data, error } = await client.rpc("swim_confirm_import_outcome", {
    p_request_id: value.requestId, p_workout_id: value.workoutId, p_match_id: value.matchId,
    p_outcome: value.outcome, p_expected_outcome_id: value.expectedOutcomeId,
    p_expected_workout_revision: value.workoutRevision,
  });
  if (error) return { ok: false, error: error.code === "40001"
    ? "The recording, match or workout changed. Reload before confirming."
    : "The outcome could not be saved. Reload before trying again." };
  if (!z.string().uuid().safeParse(data).success || data !== value.requestId) {
    return { ok: false, error: "The outcome is unconfirmed. Reload before trying again." };
  }
  try {
    revalidatePath("/app/swim", "layout");
    revalidatePath("/app/plan");
    revalidatePath("/app/plan/history");
    revalidatePath("/app/sessions");
    revalidatePath("/app");
  } catch {
    return { ok: true, value: data, warning: parsed.data.outcome === null
      ? "Confirmation removed. Reload the page to see the update."
      : "Outcome saved. Reload the page to see the update." };
  }
  return { ok: true, value: data };
}
