import { z } from "zod";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { requireSwimSetup, requireSwimStorage } from "./capability";
import { getSwimWorkout, listSwimPlans, listSwimWorkouts } from "./storage";
import type { ActionResult } from "@/lib/offline/outbox-core";
import { SwimInputError } from "./input-error";

export class SwimActionError extends Error {
  constructor(message: string, readonly errorCode: NonNullable<ActionResult["errorCode"]>) { super(message); }
}

export async function swimContext(setup = false) {
  const client = await createClient();
  const { data: { user } } = await getAuthUser();
  if (!user) throw new SwimActionError("Sign in to save your swim.", "auth");
  if (setup) await requireSwimSetup(client);
  else await requireSwimStorage(client);
  return { client, user };
}

export async function ownedSwimWorkout(client: Awaited<ReturnType<typeof createClient>>, userId: string, workoutId: string) {
  if (!z.string().uuid().safeParse(workoutId).success) throw new SwimActionError("Invalid swim workout.", "validation");
  const workout = await getSwimWorkout(client, workoutId);
  if (!workout || workout.user_id !== userId) throw new SwimActionError("Swim workout not found.", "not_found");
  return workout;
}

export async function ownedSwimPlan(client: Awaited<ReturnType<typeof createClient>>, userId: string, planId: string, revision?: number) {
  if (!z.string().uuid().safeParse(planId).success) throw new SwimActionError("Invalid swim plan.", "validation");
  const plan = (await listSwimPlans(client)).find((row) => row.id === planId && row.user_id === userId);
  if (!plan) throw new SwimActionError("Swim plan not found.", "not_found");
  if (revision !== undefined && plan.revision !== revision) throw new SwimActionError("Your swim plan changed. Reload and try again.", "validation");
  const workouts = (await listSwimWorkouts(client, planId)).filter((row) => row.user_id === userId);
  return { plan, workouts };
}

export function swimActionFailure(cause: unknown): ActionResult {
  if (cause instanceof SwimActionError) return { error: cause.message, errorCode: cause.errorCode };
  if (cause instanceof SwimInputError) return { error: cause.message, errorCode: "validation" };
  if (cause instanceof SyntaxError) return { error: "Check your swim entries and try again.", errorCode: "validation" };
  if (cause instanceof z.ZodError) return { error: "Check your swim entries and try again.", errorCode: "validation" };
  const error = cause instanceof Error ? cause : new Error("Could not save your swim. Try again.");
  const database = error.cause as { code?: string } | undefined;
  if (database?.code === "42501") return { error: "You cannot change this swim.", errorCode: "forbidden" };
  if (database?.code === "P0001" || database?.code === "40001" || database?.code === "23505" || database?.code === "23514") {
    return { error: error.message, errorCode: "validation" };
  }
  return { error: error.message, errorCode: "transient" };
}
