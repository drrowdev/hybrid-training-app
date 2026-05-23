/**
 * Range toggle — `?range=30d|90d|all` (Phase 2).
 *
 * The Phase 1 overview hardcoded 30-day windows for adherence / PRs /
 * volume. Phase 2 adds a user-facing toggle above the cards
 * that consume time-bounded data; the toggle changes the query window
 * only, the cards re-render with the new bounds.
 *
 * `Range` is the canonical token:
 *   - "30d" → last 30 days
 *   - "90d" → last 90 days
 *   - "all" → all-time (no lower bound)
 *
 * Default + fallback is "30d" — invalid inputs (e.g. `?range=banana`,
 * arrays from duplicate keys, missing param) collapse to it so the
 * page always renders something safe.
 */

export type Range = "30d" | "90d" | "all";

export const DEFAULT_RANGE: Range = "30d";

export const RANGE_LABEL: Record<Range, string> = {
  "30d": "30 days",
  "90d": "90 days",
  all: "All-time",
};

/** Convert a Range token to a window in days. `null` = all-time / no lower bound. */
export function rangeWindowDays(range: Range): number | null {
  switch (range) {
    case "30d":
      return 30;
    case "90d":
      return 90;
    case "all":
      return null;
  }
}

/**
 * Parse a raw `?range=` value (typed as `string | string[] | undefined`,
 * matching Next.js's `searchParams` shape) into a canonical `Range`.
 * Anything that isn't one of the three accepted tokens falls back to
 * `DEFAULT_RANGE`.
 */
export function parseRange(raw: string | string[] | undefined): Range {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === "30d" || value === "90d" || value === "all") return value;
  return DEFAULT_RANGE;
}
