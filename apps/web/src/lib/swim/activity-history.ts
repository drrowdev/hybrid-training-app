import type { SupabaseClient } from "@supabase/supabase-js";
import { swimCourseWorkoutTitle } from "@hta/domain";
import { z } from "zod";
import { swimImportOutcomesAvailable } from "./import-outcomes";
import { standaloneSwimState, standaloneSwimStateColumns } from "./standalone-state";
import { swimFocusTitle } from "./presentation";
import type { SwimActivity } from "./activity-presentation";

const rowSchema = z.object({
  definition: z.object({
    slotId: z.string().min(1),
    issued: z.object({ focus: z.enum(["technique_base", "endurance", "event_specific"]) }),
    courseSource: z.object({ title: z.string().trim().min(1) }).optional(),
  }),
}).passthrough();

export function swimActivityProjection(raw: unknown, userId: string) {
  const parsed = rowSchema.safeParse(raw);
  if (!parsed.success) throw new Error("The recorded swim could not be loaded.");
  const { definition, ...fields } = parsed.data;
  const state = standaloneSwimState(fields, userId);
  if (fields.session_id !== null || !state.claim ||
    (state.status !== "completed" && state.status !== "stopped_early" && state.status !== "needs_review")) {
    throw new Error("The recorded swim could not be loaded.");
  }
  const activity: SwimActivity = {
    kind: "swim", id: state.id, importId: state.claim.importId,
    title: definition.courseSource
      ? swimCourseWorkoutTitle(definition.courseSource.title, definition.slotId)
      : swimFocusTitle(definition.issued.focus),
    date: state.claim.recordedDate, scheduledDate: state.scheduledDate, status: state.status,
  };
  return { activity, state };
}

/** Native swims are already represented by their sessions. */
export async function loadSwimActivity(client: SupabaseClient, userId: string, limit: number): Promise<SwimActivity[]> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("Invalid activity limit.");
  if (!z.string().uuid().safeParse(userId).success) throw new Error("Recorded swims could not be loaded.");
  if (!await swimImportOutcomesAvailable(client)) return [];
  const { data, error } = await client.from("swim_import_outcome_activity")
    .select(`${standaloneSwimStateColumns},definition`)
    .eq("user_id", userId).is("session_id", null).not("outcome_match_id", "is", null)
    .order("claim_recording_date", { ascending: false }).order("id", { ascending: false })
    .limit(limit).abortSignal(AbortSignal.timeout(10_000));
  if (error || !Array.isArray(data) || data.length > limit) throw new Error("Recorded swims could not be loaded.");
  const ids = new Set<string>();
  return data.map((raw) => {
    const { activity } = swimActivityProjection(raw, userId);
    if (ids.has(activity.id)) throw new Error("The recorded swim could not be loaded.");
    ids.add(activity.id);
    return activity;
  });
}
