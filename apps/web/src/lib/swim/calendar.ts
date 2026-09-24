import type { StandaloneSwimTrainingStatus } from "@hta/domain";
import type { StandaloneSwimState } from "./standalone-state";

export type StandaloneSwimCalendarItem = {
  source: "swim";
  id: string;
  planId: string;
  date: string;
  slot: "single" | "am" | "pm";
  sessionId: string | null;
  status: StandaloneSwimTrainingStatus;
  href: string;
};

/** Independent identities are retained for the future primary-calendar composer. */
export function standaloneSwimCalendar(
  plans: readonly { id: string; status: string }[],
  workouts: readonly {
    id: string; plan_id: string; scheduled_date: string;
    slot: "single" | "am" | "pm"; session_id: string | null;
    status: "scheduled" | "started" | "completed" | "skipped";
    deleted?: boolean;
  }[],
  states: ReadonlyMap<string, StandaloneSwimState> = new Map(),
): StandaloneSwimCalendarItem[] {
  const active = new Set(plans.filter((plan) => plan.status === "active").map((plan) => plan.id));
  return workouts
    .filter((workout) => !workout.deleted && (workout.session_id !== null ||
      states.get(workout.id)?.claim || (active.has(workout.plan_id) && workout.status === "scheduled")))
    .map((workout) => ({
      source: "swim" as const, id: workout.id, planId: workout.plan_id,
      date: workout.scheduled_date, slot: workout.slot, sessionId: workout.session_id,
      status: states.get(workout.id)?.status ?? workout.status, href: `/app/swim/${workout.id}`,
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}
