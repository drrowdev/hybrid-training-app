import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { isMissingRpc } from "../supabase/rpc-errors";
import { importColumns, importSchema } from "./import-storage";

export const matchColumns = "id,activity_id,import_id,workout_id,revision,metadata,created_at";
export const matchSchema = z.object({
  id: z.string().uuid(), activity_id: z.string(), import_id: z.string().uuid(),
  workout_id: z.string().uuid().nullable(), revision: z.number().int().positive(), created_at: z.string(),
  metadata: z.object({
    previousMatchId: z.string().uuid().nullable(),
    workout: z.object({
      revision: z.number().int().positive(), date: z.string(), title: z.string(),
      issued: z.unknown(),
    }).strict().nullable(),
  }).strict(),
}).strict().refine((row) => (row.workout_id === null) === (row.metadata.workout === null));
export type SwimImportMatch = z.infer<typeof matchSchema>;
export type MatchWorkoutChoice = {
  id: string; revision: number; date: string; title: string; distance: string; pool: string; plan: string; slot: string;
};
export type MatchActionResult<T> = { ok: true; value: T } | { ok: false; error: string };

export async function swimImportMatchingAvailable(client: SupabaseClient): Promise<boolean> {
  const { data, error } = await client.rpc("swim_import_matching_ready").abortSignal(AbortSignal.timeout(10_000));
  if (error) {
    if (isMissingRpc(error)) return false;
    throw new Error("Recorded swims could not be loaded.");
  }
  if (data !== true) throw new Error("Recorded swims returned an invalid response.");
  return true;
}

export async function loadRecordingMatch(client: SupabaseClient, userId: string, importId: string) {
  if (!z.string().uuid().safeParse(importId).success) return null;
  const recording = await client.from("swim_imports").select(importColumns).eq("user_id", userId).eq("id", importId).maybeSingle();
  if (recording.error) throw new Error("The recording could not be loaded.");
  if (!recording.data) return null;
  const parsed = importSchema.safeParse(recording.data);
  if (!parsed.success) throw new Error("The recording returned an invalid response.");
  const [current, latest] = await Promise.all([
    client.from("swim_current_import_matches").select(matchColumns).eq("user_id", userId)
      .eq("activity_id", parsed.data.activity_id).maybeSingle(),
    client.from("swim_imports").select("id").eq("user_id", userId).eq("activity_id", parsed.data.activity_id)
      .order("revision", { ascending: false }).limit(1).single(),
  ]);
  const matched = matchSchema.nullable().safeParse(current.data);
  const newest = z.object({ id: z.string().uuid() }).safeParse(latest.data);
  if (current.error || latest.error || !matched.success || !newest.success) throw new Error("The match could not be loaded.");
  return { recording: parsed.data, current: matched.data, latestId: newest.data.id };
}

export async function loadWorkoutRecordingMatches(client: SupabaseClient, userId: string, workoutId: string) {
  if (!await swimImportMatchingAvailable(client)) return [];
  const result = await client.from("swim_current_import_matches").select(matchColumns).eq("user_id", userId)
    .eq("workout_id", workoutId).order("created_at", { ascending: false }).limit(20);
  const parsed = z.array(matchSchema).safeParse(result.data);
  if (result.error || !parsed.success) throw new Error("Matched recordings could not be loaded.");
  if (!parsed.data.length) return [];
  const recordings = await client.from("swim_imports").select("id,date:evidence->>date,distance:evidence->distanceMetres")
    .eq("user_id", userId).in("id", parsed.data.map((match) => match.import_id));
  const summaries = z.array(z.object({ id: z.string().uuid(), date: z.string(), distance: z.number() })).safeParse(recordings.data);
  if (recordings.error || !summaries.success) throw new Error("Matched recordings could not be loaded.");
  return parsed.data.map((match) => {
    const summary = summaries.data.find((row) => row.id === match.import_id);
    if (!summary) throw new Error("A matched recording could not be loaded.");
    return { ...match, date: summary.date, distance: summary.distance };
  });
}

export async function exportSwimImportMatches(client: SupabaseClient, userId: string) {
  const matches: SwimImportMatch[] = [];
  for (let offset = 0; ; offset += 1000) {
    const result = await client.from("swim_import_matches").select(matchColumns).eq("user_id", userId)
      .order("id").range(offset, offset + 999);
    const parsed = z.array(matchSchema).safeParse(result.data);
    if (result.error || !parsed.success) throw new Error("Swimming matches could not be exported.");
    matches.push(...parsed.data);
    if (parsed.data.length < 1000) return matches;
  }
}
