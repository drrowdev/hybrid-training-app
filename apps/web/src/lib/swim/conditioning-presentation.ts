import type { swimTrainingState, SwimTrainingStatus } from "@hta/domain";

export type ConditioningSwim = ReturnType<typeof swimTrainingState> & {
  id: string;
  title: string;
  distance: string;
  pool: string;
  recordingDate: string | null;
};
export const SWIM_TRAINING_LABEL: Record<SwimTrainingStatus, string> = {
  scheduled: "Scheduled", started: "In progress", completed: "Completed",
  stopped_early: "Stopped early", skipped: "Skipped", paused: "Paused",
  archived: "Plan ended", unavailable: "Unavailable", needs_review: "Review recording",
};
export type SwimOrigin = "today" | "plan" | "history";
export function conditioningSwimHref(id: string, origin: SwimOrigin) {
  return `/app/swim/${id}?from=${origin}`;
}
export function swimReturnDestination(origin: unknown) {
  if (origin === "today") return { href: "/app", label: "Today" };
  if (origin === "plan") return { href: "/app/plan", label: "Plan" };
  if (origin === "history") return { href: "/app/plan/history", label: "Program history" };
  return { href: "/app/swim", label: "Swimming" };
}
