export type StandaloneSwimCalendarItem = {
  source: "swim";
  id: string;
  planId: string;
  date: string;
  slot: "single" | "am" | "pm";
  sessionId: string | null;
  status: "scheduled" | "started" | "completed" | "skipped";
  href: string;
};

/** Independent identities are retained for the future primary-calendar composer. */
export function standaloneSwimCalendar(
  plans: readonly { id: string; status: string }[],
  workouts: readonly {
    id: string; plan_id: string; scheduled_date: string;
    slot: "single" | "am" | "pm"; session_id: string | null;
    status: StandaloneSwimCalendarItem["status"];
    deleted?: boolean;
  }[],
): StandaloneSwimCalendarItem[] {
  const active = new Set(plans.filter((plan) => plan.status === "active").map((plan) => plan.id));
  return workouts
    .filter((workout) => !workout.deleted && (workout.session_id !== null || (active.has(workout.plan_id) && workout.status === "scheduled")))
    .map((workout) => ({
      source: "swim" as const, id: workout.id, planId: workout.plan_id,
      date: workout.scheduled_date, slot: workout.slot, sessionId: workout.session_id,
      status: workout.status, href: `/app/swim/${workout.id}`,
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}
