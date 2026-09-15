import type { swimTrainingState, SwimTrainingStatus } from "@hta/domain";

export type ConditioningSwim = ReturnType<typeof swimTrainingState> & {
  id: string;
  title: string;
  distance: string;
  pool: string;
  recordingDate: string | null;
  controls?: {
    planId: string; planRevision: number; workoutRevision: number;
    planStatus: "active" | "paused"; editable: boolean;
  };
};
export const SWIM_TRAINING_LABEL: Record<SwimTrainingStatus, string> = {
  scheduled: "Scheduled", started: "In progress", completed: "Completed",
  stopped_early: "Stopped early", skipped: "Skipped", paused: "Paused",
  archived: "Plan ended", unavailable: "Unavailable", needs_review: "Review recording",
};
export type SwimOrigin = "today" | "plan" | "history" | "sessions";
export function parseSwimOrigin(origin: unknown): SwimOrigin | undefined {
  return origin === "today" || origin === "plan" || origin === "history" || origin === "sessions" ? origin : undefined;
}
export function conditioningSwimHref(id: string, origin: SwimOrigin) {
  return `/app/swim/${id}?from=${origin}`;
}
export function swimReturnDestination(origin: unknown) {
  if (origin === "today") return { href: "/app", label: "Today" };
  if (origin === "plan") return { href: "/app/plan", label: "Plan" };
  if (origin === "history") return { href: "/app/plan/history", label: "Program history" };
  if (origin === "sessions") return { href: "/app/sessions", label: "Sessions" };
  return { href: "/app/swim", label: "Swimming" };
}
