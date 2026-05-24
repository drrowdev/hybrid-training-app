/**
 * Zone-based RPE model.
 *
 * The session-logging picker exposes 4 zones (Easy / Moderate / Hard /
 * Max effort) instead of a 9-stop numeric slider — research and
 * practitioner consensus around RPE self-reporting consistently show
 * coarse-grained categories produce more honest and more stable
 * self-rated efforts than a free-numeric stop.
 *
 * The DB column stays numeric (existing `set_logs.rpe` numeric(3,1) is
 * unchanged) so e1RM helpers, drift queries, analytics, and PR
 * detection keep working untouched. The picker persists the MIDPOINT
 * of the chosen zone, and we map back from a stored numeric to a zone
 * on re-open via `zoneForRpe`.
 */

export const RPE_ZONES = ["easy", "moderate", "hard", "max"] as const;
export type RpeZone = (typeof RPE_ZONES)[number];

export const ZONE_MIDPOINTS: Readonly<Record<RpeZone, number>> = {
  easy: 6.25,
  moderate: 7.5,
  hard: 8.75,
  max: 9.75,
};

export const ZONE_LABELS: Readonly<Record<RpeZone, string>> = {
  easy: "Easy",
  moderate: "Moderate",
  hard: "Hard",
  max: "Max effort",
};

export const ZONE_RANGES: Readonly<Record<RpeZone, string>> = {
  easy: "6 – 6.5",
  moderate: "7 – 8",
  hard: "8.5 – 9",
  max: "9.5 – 10",
};

/**
 * Token used for the outline tint + selected-state ring. Stays on the
 * existing `--cp-*` design tokens — no new variables introduced.
 */
export const ZONE_TOKEN: Readonly<Record<RpeZone, string>> = {
  easy: "var(--cp-success)",
  moderate: "var(--cp-accent)",
  hard: "var(--cp-warning)",
  max: "var(--cp-danger)",
};

/**
 * Inverse mapping: round a stored numeric RPE back to the nearest
 * zone so re-editing a logged set pre-selects the right card.
 *
 *   6   – 6.75 → easy
 *   6.76 – 8.25 → moderate
 *   8.26 – 9.25 → hard
 *   9.26 – 10   → max
 *
 * Returns null for null/undefined/out-of-range inputs (the picker
 * renders nothing selected in that case).
 */
export function zoneForRpe(rpe: number | null | undefined): RpeZone | null {
  if (rpe == null || !Number.isFinite(rpe)) return null;
  if (rpe < 6 || rpe > 10) return null;
  if (rpe <= 6.75) return "easy";
  if (rpe <= 8.25) return "moderate";
  if (rpe <= 9.25) return "hard";
  return "max";
}
