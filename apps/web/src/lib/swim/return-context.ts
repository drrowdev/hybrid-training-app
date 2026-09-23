export type SwimOrigin = "today" | "plan" | "history" | "sessions";

export function parseSwimOrigin(origin: unknown): SwimOrigin | undefined {
  return origin === "today" || origin === "plan" || origin === "history" || origin === "sessions" ? origin : undefined;
}

export function swimWorkoutHref(id: string, origin: SwimOrigin) {
  return `/app/swim/${id}?from=${origin}`;
}

export function swimRecordingHref(id: string, origin?: SwimOrigin, workoutId?: string) {
  const query = new URLSearchParams();
  if (workoutId) query.set("workout", workoutId);
  if (origin) query.set("from", origin);
  return `/app/swim/recordings/${id}${query.size ? `?${query}` : ""}`;
}

export function swimReturnDestination(origin: unknown) {
  if (origin === "today") return { href: "/app", label: "Today" };
  if (origin === "plan") return { href: "/app/plan", label: "Plan" };
  if (origin === "history") return { href: "/app/plan/history", label: "Program history" };
  if (origin === "sessions") return { href: "/app/sessions", label: "Sessions" };
  return { href: "/app/swim", label: "Swimming" };
}
