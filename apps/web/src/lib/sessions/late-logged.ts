/**
 * Derived "late-logged" flag for a logged session.
 *
 * A session is late-logged when its `performed_at` (the timestamp the
 * user attributes the workout to — usually NOW(), but can be
 * back-dated by the retroactive date picker) falls on a calendar day
 * strictly AFTER the planned date in the user's timezone.
 *
 * We deliberately do NOT store this on the row. It's pure derivation
 * from `planned_sessions.date` (calendar) and `sessions.performed_at`
 * (instant) — surfaces that care (adherence breakdown, audit notes)
 * compute it on read.
 */
import { ymdInTimezone } from "@/lib/dates";

export function isLateLogged(
  plannedDateYmd: string | null,
  sessionPerformedAt: string | Date,
  tz: string,
): boolean {
  if (!plannedDateYmd) return false;
  const performedAt =
    sessionPerformedAt instanceof Date
      ? sessionPerformedAt
      : new Date(sessionPerformedAt);
  if (Number.isNaN(performedAt.getTime())) return false;
  const performedYmd = ymdInTimezone(performedAt, tz);
  return performedYmd > plannedDateYmd;
}
