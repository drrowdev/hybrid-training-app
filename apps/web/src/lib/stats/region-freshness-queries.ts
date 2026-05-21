/**
 * Region freshness band classification + read query.
 *
 * Bands are plain-language summaries of `freshness = 1 - ATL_r/CTL_r`
 * (clamped to [0,1] — see packages/domain/src/region-freshness.ts).
 *
 * Thresholds chosen so:
 *  - "Fresh" covers ACWR ≤ ~0.15 → effectively rested / above baseline.
 *  - "Recovering" / "Heavily loaded" cover ACWR ≥ 0.7 / 0.9 — these are the
 *    bands where the soft warning (DC-V2) fires before scheduling heavy
 *    work, drawing on the Gabbett 2016 acute-to-chronic injury-risk curve.
 */
import { computeRegionFreshness } from "@hta/domain";
import type { SupabaseClient } from "@supabase/supabase-js";

export type FreshnessBand = "fresh" | "ready" | "lingering" | "recovering" | "heavily-loaded";

export type RegionFreshnessRow = {
  region: string;
  regionLabel: string;
  freshness: number;
  band: FreshnessBand;
  label: string;
  tone: "ok" | "caution" | "warn";
  atl: number;
  ctl: number;
  lastLoadDate: string | null;
};

const REGION_LABELS: Record<string, string> = {
  foot_ankle_calf: "Calves & feet",
  knee: "Knees & quads",
  hamstring_posterior: "Hamstrings & glutes",
  adductor_groin: "Hips & groin",
  lumbar_trunk: "Lower back & core",
  shoulder_scapular: "Shoulders & upper back",
  elbow_forearm: "Arms & elbows",
};

/** Map a freshness score (0..1) to a 5-band label with tone. */
export function classifyFreshness(freshness: number): {
  band: FreshnessBand;
  label: string;
  tone: "ok" | "caution" | "warn";
} {
  if (freshness >= 0.85) return { band: "fresh", label: "Fresh", tone: "ok" };
  if (freshness >= 0.55) return { band: "ready", label: "Ready", tone: "ok" };
  if (freshness >= 0.3)
    return { band: "lingering", label: "Light load lingering", tone: "caution" };
  if (freshness >= 0.1)
    return { band: "recovering", label: "Recovering", tone: "warn" };
  return { band: "heavily-loaded", label: "Heavily loaded", tone: "warn" };
}

/**
 * Returns the per-region freshness for the signed-in user, sorted
 * most-loaded-first (lowest freshness first) so the Today card surfaces
 * what to watch.
 *
 * When the user has no logged sessions yet, returns an empty array — the
 * UI shows an empty state.
 */
export async function getRegionFreshness(
  supabase: SupabaseClient,
  userId: string,
): Promise<RegionFreshnessRow[]> {
  const { data, error } = await supabase
    .from("region_state")
    .select("region, atl, ctl, baseline_tolerance, last_load_date")
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) return [];

  const rows: RegionFreshnessRow[] = [];
  for (const r of data) {
    const atl = Number(r.atl ?? 0);
    const ctl = Number(r.ctl ?? 0);
    const baselineTolerance = Number(r.baseline_tolerance ?? 0);
    // Skip regions the user has never trained — no signal to show.
    if (ctl <= 0 && atl <= 0) continue;
    const freshness = computeRegionFreshness(atl, baselineTolerance);
    const { band, label, tone } = classifyFreshness(freshness);
    rows.push({
      region: r.region,
      regionLabel: REGION_LABELS[r.region] ?? r.region,
      freshness,
      band,
      label,
      tone,
      atl,
      ctl,
      lastLoadDate: (r.last_load_date as string | null) ?? null,
    });
  }

  rows.sort((a, b) => a.freshness - b.freshness);
  return rows;
}
