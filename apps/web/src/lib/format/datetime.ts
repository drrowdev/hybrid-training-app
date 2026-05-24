/**
 * Time + date formatting that respects the user's preference.
 *
 * Two columns on `profiles` drive this (migration 0041):
 *   * `time_format`  — '12h' | '24h' | NULL
 *   * `date_format`  — 'iso' | 'dmy_long' | 'mdy_long' | 'dmy_short' |
 *                      'mdy_short' | NULL
 *
 * A NULL column means "fall back to a locale-inferred default". The
 * fallback is derived from the user's IANA timezone region:
 *
 *   Europe/*               → 24h + dmy_short
 *   America/*              → 12h + mdy_short
 *   Asia/*                 → 24h + iso
 *   Africa/* + Australia/* → 24h + dmy_short
 *   (anything else / null) → 24h + iso
 *
 * Per DC-Q6 brand purity, no third-party formatting libraries — we
 * use the platform `Intl.DateTimeFormat` for everything. `formatToParts`
 * is used to hand-assemble each format so the output is stable across
 * Node runtimes (ICU minor versions differ in punctuation).
 */

export type TimeFormat = "12h" | "24h";
export type DateFormat = "iso" | "dmy_long" | "mdy_long" | "dmy_short" | "mdy_short";

export type ProfileForFormat =
  | {
      timezone?: string | null;
      time_format?: string | null;
      date_format?: string | null;
    }
  | null
  | undefined;

export type DateMode = "date" | "short_date" | "weekday_short";

export const TIME_FORMAT_OPTIONS: ReadonlyArray<{
  id: TimeFormat;
  label: string;
  example: string;
}> = [
  { id: "24h", label: "24-hour", example: "17:30" },
  { id: "12h", label: "12-hour", example: "5:30 PM" },
];

export const DATE_FORMAT_OPTIONS: ReadonlyArray<{
  id: DateFormat;
  label: string;
  example: string;
}> = [
  { id: "iso", label: "ISO", example: "2026-05-24" },
  { id: "dmy_long", label: "Day Month Year", example: "24 May 2026" },
  { id: "mdy_long", label: "Month Day, Year", example: "May 24, 2026" },
  { id: "dmy_short", label: "DD/MM/YYYY", example: "24/05/2026" },
  { id: "mdy_short", label: "MM/DD/YYYY", example: "05/24/2026" },
];

const TIME_FORMAT_IDS: ReadonlySet<TimeFormat> = new Set(["12h", "24h"]);
const DATE_FORMAT_IDS: ReadonlySet<DateFormat> = new Set([
  "iso",
  "dmy_long",
  "mdy_long",
  "dmy_short",
  "mdy_short",
]);

export function isTimeFormat(v: unknown): v is TimeFormat {
  return typeof v === "string" && TIME_FORMAT_IDS.has(v as TimeFormat);
}

export function isDateFormat(v: unknown): v is DateFormat {
  return typeof v === "string" && DATE_FORMAT_IDS.has(v as DateFormat);
}

// ── Locale-from-timezone fallback ────────────────────────────────────

function regionFromTimezone(tz: string | null | undefined): string {
  if (!tz) return "";
  const slash = tz.indexOf("/");
  return slash >= 0 ? tz.slice(0, slash) : tz;
}

function inferTimeFormat(tz: string | null | undefined): TimeFormat {
  if (regionFromTimezone(tz) === "America") return "12h";
  return "24h";
}

function inferDateFormat(tz: string | null | undefined): DateFormat {
  const region = regionFromTimezone(tz);
  if (region === "Europe") return "dmy_short";
  if (region === "America") return "mdy_short";
  if (region === "Africa" || region === "Australia") return "dmy_short";
  return "iso";
}

export function resolveTimeFormat(profile: ProfileForFormat): TimeFormat {
  const explicit = profile?.time_format;
  if (isTimeFormat(explicit)) return explicit;
  return inferTimeFormat(profile?.timezone ?? null);
}

export function resolveDateFormat(profile: ProfileForFormat): DateFormat {
  const explicit = profile?.date_format;
  if (isDateFormat(explicit)) return explicit;
  return inferDateFormat(profile?.timezone ?? null);
}

// ── Input coercion ───────────────────────────────────────────────────

function asDate(d: Date | string): Date {
  if (d instanceof Date) return d;
  return new Date(d);
}

// ── Format primitives via Intl.DateTimeFormat#formatToParts ─────────

type PartMap = Partial<Record<Intl.DateTimeFormatPartTypes, string>>;

function partsOf(
  d: Date,
  tz: string | undefined,
  opts: Intl.DateTimeFormatOptions,
): PartMap {
  const fmt = new Intl.DateTimeFormat("en-US", { ...opts, timeZone: tz });
  const out: PartMap = {};
  for (const p of fmt.formatToParts(d)) {
    out[p.type] = p.value;
  }
  return out;
}

const MONTH_NAMES_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const MONTH_NAMES_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const WEEKDAY_NAMES_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type CalendarParts = {
  year: string;
  monthIdx: number;
  monthNum: string;
  day: string;
  weekdayIdx: number;
};

function calendarParts(d: Date, tz: string | undefined): CalendarParts {
  const p = partsOf(d, tz, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const monthNum = p.month ?? "01";
  const monthIdx = Math.max(0, Math.min(11, Number.parseInt(monthNum, 10) - 1));
  const wkShort = p.weekday ?? "Sun";
  const weekdayIdx = WEEKDAY_NAMES_SHORT.findIndex(
    (w) => w.toLowerCase() === wkShort.toLowerCase(),
  );
  return {
    year: p.year ?? "1970",
    monthIdx,
    monthNum,
    day: p.day ?? "01",
    weekdayIdx: weekdayIdx < 0 ? 0 : weekdayIdx,
  };
}

// ── Public formatters ───────────────────────────────────────────────

export function formatTime(d: Date | string, profile: ProfileForFormat): string {
  const date = asDate(d);
  const tz = profile?.timezone ?? undefined;
  const fmt = resolveTimeFormat(profile);
  if (fmt === "24h") {
    const p = partsOf(date, tz, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    // Some runtimes emit "24" for midnight when hour12=false; normalise.
    const hh = (p.hour ?? "00") === "24" ? "00" : (p.hour ?? "00");
    return `${hh}:${p.minute ?? "00"}`;
  }
  const p = partsOf(date, tz, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${p.hour ?? "12"}:${p.minute ?? "00"} ${p.dayPeriod ?? ""}`.trim();
}

export function formatDate(
  d: Date | string,
  profile: ProfileForFormat,
  mode: DateMode = "date",
): string {
  const date = asDate(d);
  const tz = profile?.timezone ?? undefined;
  const fmt = resolveDateFormat(profile);
  const cp = calendarParts(date, tz);

  if (mode === "weekday_short") {
    const wk = WEEKDAY_NAMES_SHORT[cp.weekdayIdx]!;
    const monShort = MONTH_NAMES_SHORT[cp.monthIdx]!;
    const dayNum = String(Number.parseInt(cp.day, 10));
    if (fmt === "mdy_short" || fmt === "mdy_long") return `${wk} ${monShort} ${dayNum}`;
    if (fmt === "iso") return `${wk} ${cp.year}-${cp.monthNum}-${cp.day}`;
    return `${wk} ${dayNum} ${monShort}`;
  }

  if (mode === "short_date") {
    const monShort = MONTH_NAMES_SHORT[cp.monthIdx]!;
    const dayNum = String(Number.parseInt(cp.day, 10));
    if (fmt === "mdy_short" || fmt === "mdy_long") return `${monShort} ${dayNum}`;
    if (fmt === "iso") return `${cp.monthNum}-${cp.day}`;
    return `${dayNum} ${monShort}`;
  }

  switch (fmt) {
    case "iso":
      return `${cp.year}-${cp.monthNum}-${cp.day}`;
    case "dmy_long":
      return `${Number.parseInt(cp.day, 10)} ${MONTH_NAMES_LONG[cp.monthIdx]} ${cp.year}`;
    case "mdy_long":
      return `${MONTH_NAMES_LONG[cp.monthIdx]} ${Number.parseInt(cp.day, 10)}, ${cp.year}`;
    case "dmy_short":
      return `${cp.day}/${cp.monthNum}/${cp.year}`;
    case "mdy_short":
      return `${cp.monthNum}/${cp.day}/${cp.year}`;
  }
}

export function formatDateTime(d: Date | string, profile: ProfileForFormat): string {
  return `${formatDate(d, profile, "date")} ${formatTime(d, profile)}`;
}

/**
 * Eyebrow-style upper-case date label, e.g. "SUN 24 MAY" (DMY) /
 * "SUN MAY 24" (MDY) / "SUN 2026-05-24" (ISO). Returns the
 * weekday_short flavour upper-cased for the Today page header.
 */
export function formatEyebrowDate(d: Date | string, profile: ProfileForFormat): string {
  return formatDate(d, profile, "weekday_short").toUpperCase();
}
