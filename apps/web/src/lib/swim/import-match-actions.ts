"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getAuthUser } from "../supabase/server";
import { parseSwimDate } from "./forms";
import type { SwimPlanRow, SwimWorkoutRow } from "./storage";
import { workoutPresentation } from "./presentation";
import { swimImportMatchingAvailable, type MatchActionResult, type MatchWorkoutChoice } from "./import-matching";

export async function findSwimMatchWorkouts(date: string): Promise<MatchActionResult<MatchWorkoutChoice[]>> {
  try { parseSwimDate(date); }
  catch (error) {
    if (error instanceof z.ZodError) return { ok: false, error: "Choose a valid workout date." };
    throw error;
  }
  const { data: { user } } = await getAuthUser();
  if (!user) return { ok: false, error: "Sign in to choose a workout." };
  const client = await createClient();
  if (process.env.SWIM_IMPORT_MATCHING_ENABLED !== "true" || !await swimImportMatchingAvailable(client)) {
    return { ok: false, error: "Matching is not available yet." };
  }
  const { data, error } = await client.from("swim_workouts").select("*,swim_plans!inner(started_on,definition)").eq("user_id", user.id)
    .eq("scheduled_date", date).order("id").limit(101)
    .returns<(SwimWorkoutRow & { swim_plans: Pick<SwimPlanRow, "started_on" | "definition"> })[]>();
  if (error || !data) return { ok: false, error: "Workouts could not be loaded. Try again." };
  if (data.length > 100) return { ok: false, error: "Too many workouts on this date to display." };
  const choices: MatchWorkoutChoice[] = [];
  for (const row of data) {
    if (row.user_id !== user.id || row.scheduled_date !== date) {
      return { ok: false, error: "The schedule changed. Choose the date again." };
    }
    const view = workoutPresentation(row.definition.issued);
    choices.push({
      id: row.id, revision: row.revision, date: row.scheduled_date,
      title: row.definition.courseSource?.title ?? view.title,
      distance: view.total, pool: view.course,
      plan: `${row.swim_plans.definition.privateCourse?.title ?? "Swimming plan"} · ${row.swim_plans.started_on}`,
      slot: row.slot === "single" ? "" : row.slot.toUpperCase(),
    });
  }
  return { ok: true, value: choices };
}

const inputSchema = z.object({
  requestId: z.string().uuid(), importId: z.string().uuid(),
  workoutId: z.string().uuid().nullable(), expectedMatchId: z.string().uuid().nullable(),
  workoutRevision: z.number().int().positive().nullable(),
}).strict().refine((input) => (input.workoutId === null) === (input.workoutRevision === null));

export async function saveSwimImportMatch(input: unknown): Promise<MatchActionResult<string>> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a valid recording and workout." };
  const { data: { user } } = await getAuthUser();
  if (!user) return { ok: false, error: "Sign in to change the match." };
  const value = parsed.data;
  const client = await createClient();
  if ((value.workoutId && process.env.SWIM_IMPORT_MATCHING_ENABLED !== "true") || !await swimImportMatchingAvailable(client)) {
    return { ok: false, error: "Matching is not available yet." };
  }
  const { data, error } = await client.rpc("swim_match_import", {
    p_request_id: value.requestId, p_import_id: value.importId, p_workout_id: value.workoutId,
    p_expected_match_id: value.expectedMatchId, p_expected_workout_revision: value.workoutRevision,
  });
  if (error) return { ok: false, error: error.code === "40001"
    ? "The recording, workout or match changed. Reload before trying again."
    : "The match could not be saved. Reload before trying again." };
  if (!z.string().uuid().safeParse(data).success || data !== value.requestId) {
    return { ok: false, error: "The match is unconfirmed. Reload before trying again." };
  }
  revalidatePath("/app/settings/swimming");
  revalidatePath("/app/swim", "layout");
  return { ok: true, value: data };
}
