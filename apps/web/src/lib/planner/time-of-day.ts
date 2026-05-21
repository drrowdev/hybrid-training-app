/**
 * Time-of-day helpers for two-a-day session planning.
 *
 * The data model stores `planned_at` as a UTC timestamptz. The UI displays
 * time-of-day in the user's profile timezone. Block scheduling never knew
 * absolute times at v1 — instead, AM and PM sessions are derived at render
 * time from the profile's am/pm window defaults, and only persisted to
 * `planned_at` when the user explicitly overrides them.
 *
 * Why no library: the math is a few lines via Intl.DateTimeFormat, and the
 * one operation we need (convert local-time-on-a-specific-date in tz X to a
 * UTC instant) is fully covered.
 */

export type SessionSlotLocal = "am" | "pm" | "single";

/** Returns the timezone offset (in minutes) for a given UTC instant in a tz. */
function offsetMinutesForTz(tz: string, utcInstant: Date): number {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = f.formatToParts(utcInstant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  // Hour can come back as "24" at midnight in some locales; normalise.
  const hour = get("hour") === 24 ? 0 : get("hour");
  const localAsUTC = Date.UTC(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second"));
  return Math.round((localAsUTC - utcInstant.getTime()) / 60000);
}

/**
 * Convert a YYYY-MM-DD date + HH:mm time-of-day in the given timezone
 * to the corresponding UTC instant. Handles DST correctly via Intl.
 */
export function localTimeToUTC(dayDate: string, hhmm: string, tz: string): Date {
  const [hh, mm] = hhmm.split(":").map((s) => Number.parseInt(s, 10));
  const [yy, mo, dd] = dayDate.split("-").map((s) => Number.parseInt(s, 10));
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || !Number.isFinite(yy) || !Number.isFinite(mo) || !Number.isFinite(dd)) {
    throw new Error(`Invalid date/time inputs: ${dayDate}T${hhmm}`);
  }
  // First approximation: treat the local datetime as if it were UTC.
  const guess = new Date(Date.UTC(yy, mo - 1, dd, hh, mm, 0));
  const offset = offsetMinutesForTz(tz, guess);
  return new Date(guess.getTime() - offset * 60000);
}

/** Format a UTC instant as HH:mm in the given timezone. */
export function formatTimeInTz(utc: Date | string, tz: string): string {
  const d = typeof utc === "string" ? new Date(utc) : utc;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(d)
    .replace(/^24:/, "00:");
}

/**
 * Compute the effective time-of-day (HH:mm) for a session slot.
 * If `plannedAt` is set, formats it in the user's tz. Otherwise falls back
 * to the user's profile window defaults for that slot.
 */
export function effectiveTimeOfDay({
  slot,
  plannedAt,
  amWindowStart,
  pmWindowStart,
  timezone,
}: {
  slot: SessionSlotLocal;
  plannedAt: string | null;
  amWindowStart: string; // "07:00:00" — comes back from Postgres as full HH:mm:ss
  pmWindowStart: string;
  timezone: string;
}): string | null {
  if (plannedAt) {
    return formatTimeInTz(plannedAt, timezone);
  }
  if (slot === "am") return amWindowStart.slice(0, 5);
  if (slot === "pm") return pmWindowStart.slice(0, 5);
  return null; // "single" sessions don't expose a time-of-day
}

/**
 * Given two HH:mm strings, return the gap in hours (>= 0).
 * Assumes both are same-day; we never expect a "PM" earlier than "AM" so
 * a negative diff is treated as 0.
 */
export function gapHoursBetween(am: string, pm: string): number {
  const [ah, am_min] = am.split(":").map((s) => Number.parseInt(s, 10));
  const [ph, pm_min] = pm.split(":").map((s) => Number.parseInt(s, 10));
  if (!Number.isFinite(ah) || !Number.isFinite(am_min) || !Number.isFinite(ph) || !Number.isFinite(pm_min)) {
    return 0;
  }
  const diffMin = (ph * 60 + pm_min) - (ah * 60 + am_min);
  return Math.max(0, diffMin / 60);
}
