/**
 * Region freshness mini summary — Stats overview card D.
 *
 * Thin façade over `getRegionFreshness` (already used on the Today
 * card and on `/app/stats/engine`). Returns one row per trained region,
 * with the freshness value, label, and a semantic `tone` string that
 * the card uses to pick a Clawpilot palette token.
 *
 * Mapping:
 *   - fresh / ready          → success (green)
 *   - lingering              → warning (yellow)
 *   - recovering             → warning (yellow) — keeps the card
 *                              visually calmer; the engine page is the
 *                              right place for the harsher color.
 *   - heavily-loaded         → danger (red)
 *
 * Empty array when the user has never trained — the card renders an
 * empty state and points to `/app/stats/engine` for context.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getRegionFreshness,
  type FreshnessBand,
  type RegionFreshnessRow,
} from "./region-freshness-queries";

export type FreshnessMiniRow = {
  region: string;
  regionLabel: string;
  freshness: number;
  band: FreshnessBand;
  /** Clawpilot palette token bucket. */
  accent: "success" | "warning" | "danger";
};

const ACCENT_BY_BAND: Record<FreshnessBand, "success" | "warning" | "danger"> = {
  fresh: "success",
  ready: "success",
  lingering: "warning",
  recovering: "warning",
  "heavily-loaded": "danger",
};

export async function getFreshnessMini(
  supabase: SupabaseClient,
  userId: string,
): Promise<FreshnessMiniRow[]> {
  const rows: RegionFreshnessRow[] = await getRegionFreshness(supabase, userId);
  return rows.map((r) => ({
    region: r.region,
    regionLabel: r.regionLabel,
    freshness: r.freshness,
    band: r.band,
    accent: ACCENT_BY_BAND[r.band],
  }));
}
