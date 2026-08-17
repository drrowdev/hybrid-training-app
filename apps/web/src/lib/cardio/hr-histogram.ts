/**
 * Re-bucket a stored per-activity HR histogram into time-in-zone.
 *
 * `cardio_logs.hr_histogram` is a compact `bpm → seconds` map captured
 * alongside `hr_zones` (migration 0109). `hr_zones` is time-in-zone
 * bucketed against the user's zone bands *at the time the row was
 * written*; when the user later edits their HR zones, every past
 * activity's `hr_zones` goes stale. The histogram is the
 * band-independent raw distribution, so `zonesFromHistogram` can
 * re-bucket any stored activity instantly and locally on a zone-config
 * change (`lib/settings/hr-zones-actions.ts` → `recomputeStoredHrZones`).
 *
 * Shape: `Record<string, number>` keyed by integer bpm (as a string,
 * since JSON object keys are strings) → whole seconds spent at that bpm.
 */
import { zoneForBpm, type Zone, type ZoneBands } from "@/lib/stats/hr-zones";

export type HrHistogram = Record<string, number>;

/** Per-zone seconds, as persisted on `cardio_logs.hr_zones`. */
export type HrZonesSeconds = {
  z1: number;
  z2: number;
  z3: number;
  z4: number;
  z5: number;
};

const ZONE_KEY: Record<Zone, keyof HrZonesSeconds> = {
  Z1: "z1",
  Z2: "z2",
  Z3: "z3",
  Z4: "z4",
  Z5: "z5",
};

/**
 * Re-bucket a stored bpm→seconds histogram into time-in-zone using the
 * supplied bands. Returns null when bands are missing or the histogram is
 * empty/invalid.
 */
export function zonesFromHistogram(
  histogram: HrHistogram | null | undefined,
  bands: ZoneBands | null,
): HrZonesSeconds | null {
  if (!bands || !histogram) return null;
  const acc: HrZonesSeconds = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 };
  let total = 0;
  for (const [bpmKey, secRaw] of Object.entries(histogram)) {
    const bpm = Number(bpmKey);
    const sec = Number(secRaw);
    if (!Number.isFinite(bpm) || bpm <= 0) continue;
    if (!Number.isFinite(sec) || sec <= 0) continue;
    acc[ZONE_KEY[zoneForBpm(bpm, bands)]] += sec;
    total += sec;
  }
  if (total <= 0) return null;
  return {
    z1: Math.round(acc.z1),
    z2: Math.round(acc.z2),
    z3: Math.round(acc.z3),
    z4: Math.round(acc.z4),
    z5: Math.round(acc.z5),
  };
}
