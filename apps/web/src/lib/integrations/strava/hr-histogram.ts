/**
 * Per-activity HR histogram — a compact bpm→seconds map derived from a
 * Strava per-second HR stream, persisted to `cardio_logs.hr_histogram`.
 *
 * Why store this in addition to `hr_zones`? `hr_zones` is the time-in-zone
 * bucketed against the user's CURRENT zone bands at import time. When the
 * user later edits their HR zones (e.g. to match their watch), every past
 * activity's `hr_zones` becomes stale — and recomputing it would otherwise
 * require re-fetching the per-second stream from Strava (API budget + rate
 * limits). The histogram is the band-independent raw distribution, so
 * `zonesFromHistogram` can re-bucket any past activity instantly and
 * locally on a zone-config change, with no network call.
 *
 * Shape: `Record<string, number>` keyed by integer bpm (as a string, since
 * JSON object keys are strings) → whole seconds spent at that bpm. Typical
 * run spans ~40-90 distinct bpm values, so the object is a few hundred
 * bytes. Mirrors the dt-weighting + gap-capping of `zonesFromStream` so the
 * two stay numerically consistent.
 */
import { zoneForBpm, type Zone, type ZoneBands } from "@/lib/stats/hr-zones";
import type { HrZonesSeconds } from "./zones-from-summary";

export type HrHistogram = Record<string, number>;

/** Cap on a single inter-sample gap (seconds) — mirrors zonesFromStream. */
const MAX_GAP_SEC = 60;

/**
 * Build a bpm→seconds histogram from a per-second HR stream. Returns null
 * when there's nothing trustworthy to bucket (empty/mismatched streams or
 * no valid HR samples), matching `zonesFromStream`'s contract.
 */
export function histogramFromStream(input: {
  hrStream: number[] | null | undefined;
  timeStream: number[] | null | undefined;
}): HrHistogram | null {
  const { hrStream, timeStream } = input;
  if (!Array.isArray(hrStream) || !Array.isArray(timeStream)) return null;

  const n = Math.min(hrStream.length, timeStream.length);
  if (n === 0) return null;

  const acc: Record<number, number> = {};
  let sawHr = false;

  for (let i = 0; i < n; i++) {
    const hr = hrStream[i];
    const t = timeStream[i];
    if (typeof hr !== "number" || !Number.isFinite(hr) || hr <= 0) continue;
    if (typeof t !== "number" || !Number.isFinite(t)) continue;
    sawHr = true;

    let delta: number;
    if (i === 0) {
      delta = 1;
    } else {
      const prev = timeStream[i - 1];
      delta = typeof prev === "number" && Number.isFinite(prev) ? t - prev : 1;
    }
    if (!Number.isFinite(delta) || delta <= 0) continue;
    if (delta > MAX_GAP_SEC) delta = MAX_GAP_SEC;

    const bpm = Math.round(hr);
    acc[bpm] = (acc[bpm] ?? 0) + delta;
  }

  if (!sawHr) return null;

  const out: HrHistogram = {};
  let total = 0;
  for (const [bpm, sec] of Object.entries(acc)) {
    const rounded = Math.round(sec);
    if (rounded > 0) {
      out[bpm] = rounded;
      total += rounded;
    }
  }
  if (total <= 0) return null;
  return out;
}

const ZONE_KEY: Record<Zone, keyof HrZonesSeconds> = {
  Z1: "z1",
  Z2: "z2",
  Z3: "z3",
  Z4: "z4",
  Z5: "z5",
};

/**
 * Re-bucket a stored bpm→seconds histogram into time-in-zone using the
 * supplied bands. The band-independent counterpart to `zonesFromStream` —
 * lets a zone-config change re-derive `hr_zones` for past activities with
 * no Strava round-trip. Returns null when bands are missing or the
 * histogram is empty/invalid.
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
