/**
 * Pure helper — approximate per-zone seconds from a Strava activity
 * SUMMARY (no streams).
 *
 * Strava's per-activity endpoint gives us `average_heartrate`,
 * `max_heartrate`, and `moving_time` / `elapsed_time`. The proper way
 * to compute time-in-zones is the per-second HR streams endpoint, but
 * that is rate-limited and a future-work item (see audit I3). For now
 * we APPROXIMATE the distribution from the session average + max:
 *
 *   1. Place avgHrBpm in its dominant zone D using the user's bands.
 *   2. Use the avg's position within band [lo, hi] to "leak" some
 *      duration into the adjacent zone above (if avg sits in the
 *      upper third) or below (lower third). Up to 25% leaks.
 *   3. If maxHrBpm lands in a higher zone than D, attribute 15% (one
 *      step up) or 20% (two+ steps up) of total duration to that max
 *      zone, reducing the dominant share accordingly.
 *
 * Output: seconds-per-zone with keys z1..z5 (lowercase to match the
 * shape `Record<string, number>` consumed via `cardio_logs.hr_zones`).
 * The five values sum to `durationSec` (modulo rounding into ints —
 * any rounding remainder lands on the dominant zone so the total is
 * exact).
 *
 * Returns null when we genuinely have nothing to bucket — i.e. no
 * `avgHrBpm` or no `bands`. Callers should then leave `hr_zones` as
 * NULL on the row rather than writing an empty object.
 *
 * APPROXIMATED FROM SUMMARY. For finer accuracy, use Strava streams
 * (future work).
 */
import { zoneForBpm, type Zone, type ZoneBands } from "@/lib/stats/hr-zones";

export type HrZonesSeconds = {
  z1: number;
  z2: number;
  z3: number;
  z4: number;
  z5: number;
};

const ZONE_ORDER: Zone[] = ["Z1", "Z2", "Z3", "Z4", "Z5"];

function zoneIndex(z: Zone): number {
  return ZONE_ORDER.indexOf(z);
}

function indexToKey(i: number): keyof HrZonesSeconds {
  return (["z1", "z2", "z3", "z4", "z5"] as const)[i];
}

/** Lower/upper bpm bounds for the given zone, given the user's bands. */
function bandBounds(zone: Zone, bands: ZoneBands): { lo: number; hi: number } {
  // Treat Z1 as starting at 0 and Z5 as ending one full step above z4Max
  // (we don't know hrMax exactly; the upper bound only matters when
  // computing position within the band, and avg should never actually
  // sit in Z5 above hrMax).
  const step = bands.z4Max - bands.z3Max;
  switch (zone) {
    case "Z1":
      return { lo: 0, hi: bands.z1Max };
    case "Z2":
      return { lo: bands.z1Max, hi: bands.z2Max };
    case "Z3":
      return { lo: bands.z2Max, hi: bands.z3Max };
    case "Z4":
      return { lo: bands.z3Max, hi: bands.z4Max };
    case "Z5":
      return { lo: bands.z4Max, hi: bands.z4Max + Math.max(step, 1) };
  }
}

export function estimateZonesFromSummary(input: {
  avgHrBpm: number | null | undefined;
  maxHrBpm: number | null | undefined;
  durationSec: number;
  bands: ZoneBands | null;
}): HrZonesSeconds | null {
  const { avgHrBpm, maxHrBpm, durationSec, bands } = input;
  if (!bands) return null;
  if (
    avgHrBpm == null ||
    !Number.isFinite(avgHrBpm) ||
    avgHrBpm <= 0
  ) {
    return null;
  }
  if (!Number.isFinite(durationSec) || durationSec <= 0) return null;

  const shares = [0, 0, 0, 0, 0]; // fractional 0..1

  const dominantZone = zoneForBpm(avgHrBpm, bands);
  const d = zoneIndex(dominantZone);
  shares[d] = 1;

  // Step 2 — leak some share into the adjacent zone based on where
  // avgHr sits within its band.
  const { lo, hi } = bandBounds(dominantZone, bands);
  const span = hi - lo;
  const t = span > 0 ? Math.max(0, Math.min(1, (avgHrBpm - lo) / span)) : 0.5;
  if (t > 0.66 && d < 4) {
    const leak = ((t - 0.66) / 0.34) * 0.25; // up to 25%
    shares[d] -= leak;
    shares[d + 1] += leak;
  } else if (t < 0.33 && d > 0) {
    const leak = ((0.33 - t) / 0.33) * 0.25;
    shares[d] -= leak;
    shares[d - 1] += leak;
  }

  // Step 3 — if maxHr lands in a higher zone, attribute a chunk to it.
  if (maxHrBpm != null && Number.isFinite(maxHrBpm) && maxHrBpm > 0) {
    const maxZone = zoneForBpm(maxHrBpm, bands);
    const m = zoneIndex(maxZone);
    if (m > d) {
      const distance = m - d;
      const maxShare = distance === 1 ? 0.15 : 0.2;
      // Pull from the dominant share, never let it go negative.
      const pulled = Math.min(maxShare, Math.max(0, shares[d]));
      shares[d] -= pulled;
      shares[m] += pulled;
    }
  }

  // Convert to integer seconds and reconcile rounding onto the dominant.
  const raw = shares.map((s) => s * durationSec);
  const rounded = raw.map((v) => Math.round(v));
  const total = rounded.reduce((a, b) => a + b, 0);
  const diff = Math.round(durationSec) - total;
  rounded[d] += diff;
  // Defensive clamp: no negatives even in pathological rounding cases.
  for (let i = 0; i < rounded.length; i++) {
    if (rounded[i] < 0) rounded[i] = 0;
  }

  return {
    [indexToKey(0)]: rounded[0],
    [indexToKey(1)]: rounded[1],
    [indexToKey(2)]: rounded[2],
    [indexToKey(3)]: rounded[3],
    [indexToKey(4)]: rounded[4],
  } as HrZonesSeconds;
}
