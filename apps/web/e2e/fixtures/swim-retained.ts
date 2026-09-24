import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import { validateSwimActualResult, type SwimActualResult } from "@hta/domain";
import { completeSwimWorkout, startSwimWorkout, type SwimWorkoutRow } from "../../src/lib/swim/storage";
import type { SeedConfig } from "./seed";

export async function retainedSwimActor(
  config: SeedConfig, user: { email: string; password: string; userId: string },
) {
  const client = createClient(config.supabaseUrl, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signed = await client.auth.signInWithPassword(user);
  if (signed.error || signed.data.user?.id !== user.userId) {
    throw new Error("Could not authenticate the retained swimming fixture.");
  }
  return client;
}

// Compatibility records are arrangement, never evidence of a browser logger.
export async function completeRetainedSwim(
  client: SupabaseClient, workout: SwimWorkoutRow,
  options: {
    lengths?: number; timeMs?: number; rpe?: number;
    strokes?: SwimActualResult["snapshot"]["strokes"];
    equipment?: SwimActualResult["snapshot"]["equipment"];
    notes?: string; splits?: SwimActualResult["splits"]; deviationReason?: string;
  } = {},
) {
  const started = workout.status === "scheduled"
    ? await startSwimWorkout(client, workout.id, workout.revision) : workout;
  if (started.id !== workout.id || started.user_id !== workout.user_id ||
    started.status !== "started" || !started.session_id) {
    throw new Error("Retained swimming fixture requires an uncompleted started workout.");
  }
  const lengths = options.lengths ?? started.definition.issued.totalLengths;
  const result: SwimActualResult = {
    version: 1,
    snapshot: {
      ...started.definition.issued.snapshot,
      strokes: options.strokes ?? started.definition.issued.snapshot.strokes,
      equipment: options.equipment ?? started.definition.issued.snapshot.equipment,
    },
    lengths, timeMs: options.timeMs ?? 900000, rpe: options.rpe ?? 6,
    completion: lengths >= started.definition.issued.totalLengths ? "completed" : "partial",
    ...(options.splits ? { splits: options.splits } : {}),
    provenance: { source: "manual", recordedAt: new Date().toISOString(),
      ...(options.deviationReason ? { deviationReason: options.deviationReason } : {}) },
  };
  if (validateSwimActualResult(result).length) throw new Error("Invalid retained swimming result.");
  const receipt = randomUUID();
  const completed = await completeSwimWorkout(client, {
    workoutId: started.id, expectedRevision: started.revision, result, notes: options.notes,
    clientLogId: receipt, completionEntryId: receipt,
  });
  if (!completed.transitioned || completed.workout.status !== "completed" ||
    completed.workout.id !== started.id || completed.workout.user_id !== started.user_id ||
    completed.workout.revision !== started.revision + 1 || completed.workout.session_id !== started.session_id ||
    completed.session_id !== started.session_id) {
    throw new Error("Retained swimming completion was not confirmed.");
  }
  return completed;
}
