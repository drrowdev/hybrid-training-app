import type { SwimWorkout } from "@hta/domain";
import { assertSwimSafety, swimWorkoutSafetyExposure } from "./safety";
import { SwimActionError } from "./server-context";

export async function checkSwimWorkouts(
  client: Parameters<typeof assertSwimSafety>[0], userId: string, workouts: readonly SwimWorkout[],
) {
  const regions = new Set(workouts.flatMap((workout) => swimWorkoutSafetyExposure(workout).regions));
  const slugs = new Set(workouts.map((workout) => workout.sections.some((section) =>
    section.items.some((item) => item.effort !== "easy" && item.effort !== "steady"))
    ? "swim-intervals" : "swim-easy"));
  const { data, error } = await client.from("movements").select("id,slug").in("slug", [...slugs]);
  if (error || !data || [...slugs].some((slug) => !data.some((row) => row.slug === slug))) {
    throw new SwimActionError("Could not check swim movements. Try again.", "transient");
  }
  await assertSwimSafety(client, userId, { regions: [...regions], movementIds: data.map((row) => row.id) });
}
