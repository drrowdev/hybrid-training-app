/**
 * Pure helper — true per-zone seconds from a Strava per-second HR STREAM.
 *
 * This is the high-fidelity counterpart to `zones-from-summary.ts`. Where
 * the summary helper *approximates* the zone distribution from a session's
 * average + max HR (a leak model), this one computes the *measured* time
 * in each zone from the actual heart-rate stream:
 *
 *   - `timeStream[i]` is the elapsed-seconds offset of sample i.
 *   - `hrStream[i]`   is the heart rate (bpm) at that sample.
 *   - The interval between consecutive samples (`time[i] - time[i-1]`) is
 *     attributed to the zone the HR at sample `i` falls in.
 *
 * Negative or non-finite deltas (clock glitches) contribute 0. A single
 * pathological gap (auto-pause, GPS dropout) is capped at `MAX_GAP_SEC` so
 * one bad interval can't dump an hour into a zone.
 *
 * Output: integer seconds-per-zone with keys z1..z5 (lowercase, matching
 * the shape persisted to `cardio_logs.hr_zones` and consumed by
 * `engine/cardio-intensity.ts`). Returns null when there is nothing
 * trustworthy to bucket (no bands, empty/mismatched streams, or no HR
 * samples), so callers fall back to the summary approximation.
 *
 * MEASURED FROM STREAM. This is the physiologically correct input; the
 * summary leak model is the fallback for stream-less / manual activities.
 */
import { zoneForBpm, type Zone, type ZoneBands } from "@/lib/stats/hr-zones";

export type HrZonesSeconds = {
  z1: number;
  z2: number;
  z3: number;
  z4: number;
  z5: number;
};

/**
 * Cap on a single inter-sample gap (seconds). Beyond this we treat the
 * interval as a pause/dropout and attribute only this much to the zone,
 * rather than the full (possibly hours-long) gap.
 */
const MAX_GAP_SEC = 60;

const ZONE_KEY: Record<Zone, keyof HrZonesSeconds> = {
  Z1: "z1",
  Z2: "z2",
  Z3: "z3",
  Z4: "z4",
  Z5: "z5",
};

export function zonesFromStream(input: {
  hrStream: number[] | null | undefined;
  timeStream: number[] | null | undefined;
  bands: ZoneBands | null;
}): HrZonesSeconds | null {
  const { hrStream, timeStream, bands } = input;
  if (!bands) return null;
  if (!Array.isArray(hrStream) || !Array.isArray(timeStream)) return null;

  const n = Math.min(hrStream.length, timeStream.length);
  if (n === 0) return null;

  const acc: HrZonesSeconds = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 };
  let sawHr = false;

  for (let i = 0; i < n; i++) {
    const hr = hrStream[i];
    const t = timeStream[i];
    if (typeof hr !== "number" || !Number.isFinite(hr) || hr <= 0) continue;
    if (typeof t !== "number" || !Number.isFinite(t)) continue;
    sawHr = true;

    // Interval ending at this sample. For the first sample we have no
    // prior offset; assume a 1s tick rather than crediting the full
    // (possibly large) absolute offset.
    let delta: number;
    if (i === 0) {
      delta = 1;
    } else {
      const prev = timeStream[i - 1];
      delta = typeof prev === "number" && Number.isFinite(prev) ? t - prev : 1;
    }
    if (!Number.isFinite(delta) || delta <= 0) continue;
    if (delta > MAX_GAP_SEC) delta = MAX_GAP_SEC;

    acc[ZONE_KEY[zoneForBpm(hr, bands)]] += delta;
  }

  if (!sawHr) return null;
  const total = acc.z1 + acc.z2 + acc.z3 + acc.z4 + acc.z5;
  if (total <= 0) return null;

  return {
    z1: Math.round(acc.z1),
    z2: Math.round(acc.z2),
    z3: Math.round(acc.z3),
    z4: Math.round(acc.z4),
    z5: Math.round(acc.z5),
  };
}
