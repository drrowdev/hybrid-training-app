/**
 * Timezone-aware date helpers.
 *
 * Why this module exists
 * ──────────────────────
 * Most of the app deals in YYYY-MM-DD calendar dates ("the day a session
 * happened from the user's point of view"), not absolute instants. Mixing
 * `new Date().toISOString().slice(0, 10)` (UTC) with `setDate()` (host
 * local) — the bug fixed in PR #15 — silently shifted dates by ±1 day
 * around midnight on any non-UTC host. This module centralises the
 * correct primitives so callers can't accidentally re-introduce that
 * bug.
 *
 * Two kinds of helpers live here:
 *
 *  1. **Wall-clock helpers** — `todayYmd`, `ymdInTimezone`. These convert
 *     an absolute instant into a calendar date, which is inherently
 *     timezone-dependent. Always pass the user's IANA tz string
 *     (`profiles.timezone`).
 *
 *  2. **Pure YYYY-MM-DD arithmetic** — `addDaysToYmd`, `daysBetweenYmd`,
 *     `isoWeekdayYmd`, `mondayOfYmd`. These operate on already-anchored
 *     calendar-date strings and are completely timezone-free. They
 *     anchor the math in UTC internally to dodge DST entirely (adding
 *     N integer days to a UTC midnight always lands on UTC midnight),
 *     but the input/output are tz-agnostic strings.
 */

/**
 * Format a Date as YYYY-MM-DD in the given IANA timezone.
 *
 * Uses `Intl.DateTimeFormat("en-CA")` because en-CA's native short-date
 * format is ISO-8601 (YYYY-MM-DD) — no manual reformat required, and
 * the implementation handles arbitrary IANA zones and DST correctly.
 */
export function ymdInTimezone(date: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * Today as YYYY-MM-DD in the given timezone.
 *
 * Timezone source: the caller should pass the user's profile timezone
 * (`profiles.timezone`, which always has a value — defaults to "UTC").
 * Server-rendered pages typically fetch the profile already; pass that
 * string in. Server actions can use `getUserTimezone()` from
 * `@/lib/planner/queries`.
 *
 * If no tz is provided we fall back to the host's system timezone — on
 * Vercel that's UTC, on local dev it's whatever the developer's machine
 * is set to. The fallback is only safe for non-user-facing call sites
 * (purely cosmetic client-side defaults like an onboarding date picker
 * where the user can adjust).
 */
export function todayYmd(tz?: string): string {
  if (tz) {
    return ymdInTimezone(new Date(), tz);
  }
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ── Pure YYYY-MM-DD arithmetic ────────────────────────────────────────
//
// We anchor everything in UTC so the math is timezone-free: parsing as
// UTC, adding days via setUTCDate, and reading back UTC components
// never crosses a TZ boundary. The date strings themselves carry no
// timezone, so we must NOT mix in `getDate()` / `toISOString()` style
// calls that interpret the same Date through different lenses.

function ymdUtc(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function parseYmdUtc(iso: string): Date {
  const [y, m, d] = iso.split("-").map((s) => Number.parseInt(s, 10));
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * Add an integer number of days to a YYYY-MM-DD string and return the
 * resulting YYYY-MM-DD. Negative values subtract. Does not drift on
 * DST (the math runs on UTC midnights internally).
 */
export function addDaysToYmd(ymd: string, days: number): string {
  const d = parseYmdUtc(ymd);
  d.setUTCDate(d.getUTCDate() + days);
  return ymdUtc(d);
}

/**
 * Whole calendar days from `start` to `end` (`end - start`). Both
 * arguments are YYYY-MM-DD strings; the function is timezone-irrelevant
 * because the math runs on UTC anchors. Returns a negative number when
 * `end` is before `start`.
 */
export function daysBetweenYmd(start: string, end: string): number {
  const ms = parseYmdUtc(end).getTime() - parseYmdUtc(start).getTime();
  return Math.round(ms / 86_400_000);
}

/**
 * Convert a YYYY-MM-DD calendar date to the absolute UTC instant that
 * represents start-of-day (00:00:00.000) in the given IANA timezone.
 *
 * Used by surfaces that let the user retroactively log a workout for a
 * specific calendar date: we need to write a `timestamptz` to the DB
 * that, when read back through the user's tz, lands on the picked
 * date — `ymdToUtc("2026-05-19", "Europe/Helsinki")` returns the UTC
 * instant 2026-05-18T21:00:00Z (or 22:00Z depending on DST).
 *
 * Implementation: probe Intl with a candidate UTC midnight, read back
 * the wall-clock time in the target tz, and shift by the offset. One
 * pass is enough because IANA offsets don't change within a single
 * day at midnight.
 */
export function ymdToUtc(ymd: string, tz: string): Date {
  const candidate = parseYmdUtc(ymd);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(candidate);
  const get = (t: string): number => {
    const p = parts.find((x) => x.type === t);
    return p ? Number.parseInt(p.value, 10) : 0;
  };
  const asUtcOfWall = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  const offsetMs = asUtcOfWall - candidate.getTime();
  return new Date(candidate.getTime() - offsetMs);
}

/**
 * ISO weekday for a YYYY-MM-DD string (Mon=0, Sun=6). Timezone-free.
 */
export function isoWeekdayYmd(ymd: string): number {
  return (parseYmdUtc(ymd).getUTCDay() + 6) % 7;
}

/**
 * Returns the Monday (as YYYY-MM-DD) of the ISO week containing `ymd`.
 * Timezone-free. Useful for weekly bucketing where the bucket key is
 * "the Monday of the user-perceived week".
 */
export function mondayOfYmd(ymd: string): string {
  return addDaysToYmd(ymd, -isoWeekdayYmd(ymd));
}

/**
 * The upcoming Monday (as YYYY-MM-DD) on or after `ymd` — returns `ymd`
 * itself when it is already a Monday, otherwise the next Monday.
 * Timezone-free.
 *
 * Used as the default start date for a new training block: blocks are
 * laid out as full Mon–Sun weeks, so starting mid- or late-week strands
 * the earlier days of week 1 in the past (they render as overdue). Anchoring
 * the start to the upcoming Monday gives a clean week 1 with no past days.
 */
export function upcomingMondayYmd(ymd: string): string {
  const weekday = isoWeekdayYmd(ymd); // Mon=0 … Sun=6
  if (weekday === 0) return ymd;
  return addDaysToYmd(ymd, 7 - weekday);
}
