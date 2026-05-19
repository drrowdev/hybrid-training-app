/**
 * Region freshness — read side of the engine ledger (DC-C14).
 */
import { computeRegionFreshness } from "@hta/domain";
import { createClient } from "@/lib/supabase/server";

export type FreshnessRow = {
  region: string;
  label: string;
  freshness: number;
  atl: number;
  ctl: number;
  baseline: number;
  lastLoadDate: string | null;
};

const REGION_LABELS: Record<string, string> = {
  foot_ankle_calf: "Foot / ankle / calf",
  knee: "Knee",
  hamstring_posterior: "Hamstring / posterior chain",
  adductor_groin: "Adductor / groin",
  lumbar_trunk: "Lumbar / trunk",
  shoulder_scapular: "Shoulder / scapular",
  elbow_forearm: "Elbow / forearm",
};

export async function getRegionFreshness(): Promise<FreshnessRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("region_state")
    .select("region, atl, ctl, baseline_tolerance, last_load_date");

  const rows: FreshnessRow[] = (data ?? []).map((r) => {
    const atl = Number(r.atl);
    const ctl = Number(r.ctl);
    const baseline = Number(r.baseline_tolerance);
    return {
      region: r.region,
      label: REGION_LABELS[r.region] ?? r.region,
      atl,
      ctl,
      baseline,
      lastLoadDate: r.last_load_date,
      freshness: computeRegionFreshness(atl, baseline),
    };
  });

  rows.sort((a, b) => a.freshness - b.freshness);
  return rows;
}

export function freshnessPct(f: number): string {
  return `${Math.round(f * 100)}%`;
}

export function freshnessColor(f: number): string {
  if (f >= 0.7) return "bg-emerald-500";
  if (f >= 0.4) return "bg-amber-500";
  return "bg-red-500";
}
