/**
 * Adherence range — pure tokens + parser, no server-only dependencies.
 *
 * Kept separate from `adherence-detail.ts` so client components (the
 * range-toggle view added in the PR #134 follow-up) can import the
 * constants without pulling in `lib/planner/queries`'s server-only
 * `next/headers` chain.
 *
 * The week-units (`12w / 26w / all`) are deliberately different from
 * the overview / wellness / movement pages' `30d / 90d / all` — weeks
 * are the natural bucket for adherence trends. See
 * `adherence-detail.ts` for the methodology pin.
 */
export type AdherenceRange = "12w" | "26w" | "all";

export const DEFAULT_ADHERENCE_RANGE: AdherenceRange = "12w";

export const ADHERENCE_RANGE_LABEL: Record<AdherenceRange, string> = {
  "12w": "12 weeks",
  "26w": "26 weeks",
  all: "All-time",
};

/** Convert an adherence range to a window in days. `null` = all-time. */
export function adherenceRangeWindowDays(range: AdherenceRange): number | null {
  switch (range) {
    case "12w":
      return 12 * 7;
    case "26w":
      return 26 * 7;
    case "all":
      return null;
  }
}

/** Parse the raw `?range=` value into a canonical AdherenceRange. */
export function parseAdherenceRange(
  raw: string | string[] | undefined,
): AdherenceRange {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === "12w" || value === "26w" || value === "all") return value;
  return DEFAULT_ADHERENCE_RANGE;
}
