/**
 * Reusable converters between display units and the canonical
 * storage units used by `cardio_logs` (seconds + s/km).
 *
 * Extracted as a standalone module so the edit-cardio page,
 * cardio log forms, and other surfaces that touch the
 * same fields can all share one parser.
 *
 * Conventions:
 *   - Duration: stored as seconds (integer). Display in whole minutes.
 *   - Pace:     stored as seconds-per-kilometre. Display in "M:SS" /
 *               "M:SS.s" (mile vs km label switched per user units —
 *               the underlying storage stays s/km, conversion to s/mi
 *               happens at the formatter / parser boundary).
 *
 * Pace parser intentionally rejects ambiguous input (e.g. "6.00",
 * "6,00", "6") so the user sees an error instead of a silent
 * 6 s/km mis-save. Only `MM:SS` or `MM:SS.s` is accepted.
 */

const PACE_RE = /^(\d{1,3}):([0-5]\d)(?:\.(\d))?$/;

const KM_PER_MILE = 1.609344;

export type PaceUnits = "metric" | "imperial";

/**
 * Parse a "M:SS" / "M:SS.s" string into seconds per kilometre.
 *
 * For imperial units the input is interpreted as "M:SS / mile" and
 * converted to s/km before return (storage is canonical s/km).
 *
 * Returns `null` if the input is empty, falsy, or doesn't match the
 * required format. Callers should surface a "Use M:SS format" error
 * when a non-empty input parses to null.
 */
export function parsePaceToSecPerKm(
  raw: string | null | undefined,
  units: PaceUnits = "metric",
): number | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (s === "") return null;
  const m = PACE_RE.exec(s);
  if (!m) return null;
  const minutes = Number(m[1]);
  const seconds = Number(m[2]);
  const tenths = m[3] ? Number(m[3]) / 10 : 0;
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
  const totalDisplayUnit = minutes * 60 + seconds + tenths;
  const secPerKm = units === "imperial" ? totalDisplayUnit / KM_PER_MILE : totalDisplayUnit;
  // Snap to the nearest integer second so storage stays a whole
  // number — the schema is `int4` and the display precision is
  // already only tenths anyway.
  return Math.round(secPerKm);
}

/**
 * Format a seconds-per-kilometre value back into a "M:SS" string
 * suitable for an `<input type="text">` defaultValue.
 *
 * Returns "" for null/undefined/non-finite input so the field stays
 * empty rather than rendering "0:00".
 */
export function formatSecPerKmToPace(
  secPerKm: number | null | undefined,
  units: PaceUnits = "metric",
): string {
  if (secPerKm == null) return "";
  const n = Number(secPerKm);
  if (!Number.isFinite(n) || n <= 0) return "";
  const perDisplayUnit = units === "imperial" ? n * KM_PER_MILE : n;
  const total = Math.round(perDisplayUnit);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Convert seconds → whole minutes (rounded), null-safe. */
export function secondsToMinutes(sec: number | null | undefined): number | null {
  if (sec == null) return null;
  const n = Number(sec);
  if (!Number.isFinite(n)) return null;
  return Math.round(n / 60);
}

/** Convert whole minutes → seconds, null-safe. */
export function minutesToSeconds(min: number | null | undefined): number | null {
  if (min == null) return null;
  const n = Number(min);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 60);
}

/** Pace-axis label for the user's distance units. */
export function paceUnitLabel(units: PaceUnits): "min:sec/km" | "min:sec/mi" {
  return units === "imperial" ? "min:sec/mi" : "min:sec/km";
}

/** Distance-axis label for the user's units (km vs mi). */
export function distanceUnitLabel(units: PaceUnits): "km" | "mi" {
  return units === "imperial" ? "mi" : "km";
}

/** Convert a canonical kilometre value into the user's display units. */
export function kmToDisplayDistance(km: number, units: PaceUnits): number {
  return units === "imperial" ? km / KM_PER_MILE : km;
}

/**
 * Format a kilometre distance as a "5.30 km" / "3.29 mi" string. Returns
 * "" for null/undefined/non-finite input.
 */
export function formatDistance(
  km: number | string | null | undefined,
  units: PaceUnits = "metric",
): string {
  if (km == null) return "";
  const n = Number(km);
  if (!Number.isFinite(n) || n < 0) return "";
  return `${kmToDisplayDistance(n, units).toFixed(2)} ${distanceUnitLabel(units)}`;
}
