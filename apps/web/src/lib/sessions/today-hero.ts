/**
 * Pure predicate for the Today hero's "Session logged ✓ — rest and
 * recover" state.
 *
 * The day is only "fully logged" when at least one session was completed
 * today AND every PLANNED session for today is itself completed. We check
 * per-session completion rather than comparing counts: an extra standalone
 * activity — e.g. an easy Strava run auto-synced on a day that also has a
 * prescribed session — must NOT mask a still-pending planned session.
 * Counting it would hide the planned card the user still needs to act on.
 *
 * Rest day (no planned sessions) + a logged activity → fully logged, so the
 * hero shows the friendly "rest and recover" copy rather than a blank state.
 */
export function isTodayFullyLogged(input: {
  completedTodayCount: number;
  plannedToday: ReadonlyArray<{ completedAt: string | null }>;
}): boolean {
  return (
    input.completedTodayCount > 0 &&
    input.plannedToday.every((p) => p.completedAt != null)
  );
}
