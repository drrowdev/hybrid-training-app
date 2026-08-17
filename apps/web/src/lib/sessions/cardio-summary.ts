/**
 * Pure aggregation of a session's `cardio_logs` rows into the shape the
 * post-session summary card renders. A session usually holds a single
 * cardio block (one logged run), but planned cardio days can carry a
 * warm-up + intervals, so the helper aggregates across blocks:
 *
 *   - durationSec / distanceKm : summed
 *   - maxHrBpm                 : max across blocks
 *   - avgHrBpm                 : duration-weighted mean (HR blocks only)
 *   - paceSecPerKm             : distance-weighted mean of stored paces
 *                                when they cover the full distance,
 *                                else derived from total time / distance
 *   - zones                    : summed seconds per Z1..Z5, null when no
 *                                block carries hr_zones data
 *   - modality / inferredKind  : the shared value, or "mixed" / null
 *
 * Pure: no DB or React imports, so it's unit-tested directly.
 */
import type { Zone } from "@/lib/stats/hr-zones";

export type CardioLogRow = {
  duration_sec: number | string | null;
  distance_km: number | string | null;
  avg_hr_bpm: number | null;
  max_hr_bpm: number | null;
  avg_pace_sec_per_km: number | null;
  hr_zones: Record<string, number> | null;
  modality: string | null;
  inferred_kind: string | null;
};

export type CardioSessionSummary = {
  durationSec: number;
  distanceKm: number | null;
  avgHrBpm: number | null;
  maxHrBpm: number | null;
  paceSecPerKm: number | null;
  modality: string;
  inferredKind: string | null;
  /** Seconds per zone (Z1..Z5). Null when no block carried HR-zone data. */
  zones: Record<Zone, number> | null;
};

const ZONE_KEYS: { lower: string; zone: Zone }[] = [
  { lower: "z1", zone: "Z1" },
  { lower: "z2", zone: "Z2" },
  { lower: "z3", zone: "Z3" },
  { lower: "z4", zone: "Z4" },
  { lower: "z5", zone: "Z5" },
];

function num(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function summariseCardioLogs(
  rows: CardioLogRow[] | null | undefined,
): CardioSessionSummary | null {
  if (!rows || rows.length === 0) return null;

  let durationSec = 0;
  let distanceKm = 0;
  let anyDistance = false;
  let maxHrBpm: number | null = null;
  let hrWeightedSum = 0;
  let hrWeight = 0;
  let pacedWeightedSum = 0;
  let pacedDistance = 0;
  const zoneTotals: Record<Zone, number> = { Z1: 0, Z2: 0, Z3: 0, Z4: 0, Z5: 0 };
  let anyZones = false;
  const modalities = new Set<string>();
  const kinds = new Set<string>();

  for (const r of rows) {
    const dur = num(r.duration_sec) ?? 0;
    durationSec += dur;

    const dist = num(r.distance_km);
    if (dist != null && dist > 0) {
      distanceKm += dist;
      anyDistance = true;
    }

    const max = num(r.max_hr_bpm);
    if (max != null) maxHrBpm = maxHrBpm == null ? max : Math.max(maxHrBpm, max);

    const avg = num(r.avg_hr_bpm);
    if (avg != null && dur > 0) {
      hrWeightedSum += avg * dur;
      hrWeight += dur;
    }

    const pace = num(r.avg_pace_sec_per_km);
    if (pace != null && pace > 0 && dist != null && dist > 0) {
      pacedWeightedSum += pace * dist;
      pacedDistance += dist;
    }

    if (r.hr_zones) {
      for (const { lower, zone } of ZONE_KEYS) {
        const sec = num(r.hr_zones[lower]);
        if (sec != null && sec > 0) {
          zoneTotals[zone] += sec;
          anyZones = true;
        }
      }
    }

    if (r.modality) modalities.add(r.modality);
    if (r.inferred_kind) kinds.add(r.inferred_kind);
  }

  let paceSecPerKm: number | null = null;
  if (anyDistance && distanceKm > 0) {
    if (pacedDistance > 0 && Math.abs(pacedDistance - distanceKm) < 0.01) {
      paceSecPerKm = Math.round(pacedWeightedSum / pacedDistance);
    } else {
      paceSecPerKm = Math.round(durationSec / distanceKm);
    }
  }

  return {
    durationSec,
    distanceKm: anyDistance ? Math.round(distanceKm * 1000) / 1000 : null,
    avgHrBpm: hrWeight > 0 ? Math.round(hrWeightedSum / hrWeight) : null,
    maxHrBpm,
    paceSecPerKm,
    modality: modalities.size === 1 ? [...modalities][0]! : "mixed",
    inferredKind: kinds.size === 1 ? [...kinds][0]! : null,
    zones: anyZones ? zoneTotals : null,
  };
}

/** Modalities for which a per-km pace read-out is meaningful. */
const PACE_MODALITIES = new Set(["run", "walk"]);

export function modalitySupportsPace(modality: string): boolean {
  return PACE_MODALITIES.has(modality);
}

const KIND_LABELS: Record<string, string> = {
  cardio_z2: "Easy Z2",
  cardio_threshold: "Threshold",
  cardio_vo2: "VO2 intervals",
  cardio_alactic: "Sprint / alactic",
  cardio_mixed: "Mixed intensity",
};

export function cardioKindLabel(kind: string | null): string | null {
  if (!kind) return null;
  return KIND_LABELS[kind] ?? null;
}
