/**
 * Overdue planned-session helpers.
 *
 * A planned_sessions row is **overdue** when ALL of:
 *   - `date < today` (today computed in the user's IANA timezone via
 *     `todayYmd(tz)`)
 *   - `completed_session_id IS NULL` (no logged session linked)
 *   - `skipped_at IS NULL` (user has not explicitly skipped)
 *
 * Rows in any other state — today, future, completed, or skipped —
 * are never overdue. The helpers below are pure (no I/O, no Date.now)
 * so they're trivially unit-testable across timezone edge cases.
 *
 * The structural input type keeps these helpers usable for both the
 * planner-internal `PlannedDay` shape and the client-side
 * `PlanSessionInput` shape rendered by `PlanRedesign`. We only need
 * the three fields that define the overdue rule.
 */
import { daysBetweenYmd } from "@/lib/dates";

/**
 * Minimal shape needed to evaluate overdue. Both PlannedDay and
 * PlanSessionInput satisfy this — PlanSessionInput uses
 * `done`/`skipped` booleans rather than the raw column names, so
 * callers may need to map first. The helper keeps the rule next to
 * the data so the underlying column semantics stay the source of
 * truth.
 */
export type OverdueCandidate = {
  /** YYYY-MM-DD calendar date of the planned slot. */
  date: string;
  /** Linked completed session id, or null when the row is unlinked. */
  completedSessionId: string | null;
  /** ISO timestamp when the user clicked Skip, or null when not skipped. */
  skippedAt: string | null;
};

/**
 * True when the planned row is overdue relative to `todayYmd`.
 *
 * `todayYmd` MUST be the user-local today computed via
 * `todayYmd(profile.timezone)` from `@/lib/dates`. Pure string
 * compare — YYYY-MM-DD is lexicographically sortable.
 */
export function isOverdue(p: OverdueCandidate, todayYmd: string): boolean {
  if (p.completedSessionId !== null) return false;
  if (p.skippedAt !== null) return false;
  return p.date < todayYmd;
}

export type OverdueSummary<T extends OverdueCandidate> = {
  /** Number of overdue rows. */
  count: number;
  /** Oldest (lexicographically smallest) date among overdue rows, or null when count is 0. */
  oldestDate: string | null;
  /** Overdue rows in original order. */
  items: T[];
};

/**
 * Summarise a list of planned sessions for the overdue notice.
 *
 * Stable order: items are returned in the same order the caller
 * supplied them — callers that want chronological order should sort
 * first. `oldestDate` is the minimum date regardless of input order.
 */
export function summariseOverdue<T extends OverdueCandidate>(
  plannedSessions: T[],
  todayYmd: string,
): OverdueSummary<T> {
  const items = plannedSessions.filter((p) => isOverdue(p, todayYmd));
  let oldestDate: string | null = null;
  for (const p of items) {
    if (oldestDate === null || p.date < oldestDate) oldestDate = p.date;
  }
  return { count: items.length, oldestDate, items };
}

/**
 * Whole calendar days between an overdue row's date and today
 * (`today - date`). Always a positive integer when the row is
 * overdue. Useful for the "Overdue · N day(s)" pill label.
 */
export function overdueDays(p: OverdueCandidate, todayYmd: string): number {
  return daysBetweenYmd(p.date, todayYmd);
}
