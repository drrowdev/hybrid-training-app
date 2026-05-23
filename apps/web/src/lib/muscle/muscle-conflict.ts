/**
 * Heavy-on-recovering conflict at muscle resolution.
 *
 * Extends DC-V2 (the soft warning that fires before a heavy lift on a
 * recovering region) so that when the planned movement has a known
 * muscle fanout we use the finer-grained muscle freshness signal
 * instead of the 7-region one. Falls back to the region-level
 * detector for movements without a muscle mapping.
 *
 * Keeps the same `FreshnessConflict` return shape used by the hero
 * card in /app — `regionLabel` is reused as the display label, set
 * to the muscle name when muscle-level fires.
 */
import type { FreshnessConflict } from "@/lib/stats/region-freshness-queries";
import { findHeavyOnRecoveringConflict } from "@/lib/stats/region-freshness-queries";
import { MOVEMENT_MUSCLE_MAP } from "./movement-muscle-map";
import { MUSCLE_LABELS } from "./muscle-groups";
import type { MuscleFreshnessRow } from "./muscle-freshness";

const HEAVY_PCT_TM_FLOOR = 80;
const HEAVY_REP_CEILING = 5;
const FRESHNESS_FLOOR = 0.15;

export type MuscleConflictItem = {
  kind: string;
  movementId: string;
  movementName?: string;
  movementSlug?: string | null;
  percentTm?: number | null;
  reps?: number | null;
};

/**
 * Return the first heavy-on-recovering conflict among `items`,
 * preferring muscle-level resolution when available.
 *
 *   - If the item maps to a known slug in MOVEMENT_MUSCLE_MAP, check
 *     each primary-weighted muscle (weight ≥ 1.0) against the muscle
 *     freshness rows.
 *   - Otherwise call through to findHeavyOnRecoveringConflict for the
 *     region-level signal.
 */
export function findHeavyOnRecoveringConflictWithMuscles(
  items: MuscleConflictItem[],
  movementRegionById: Map<string, { primaryRegion: string; name: string }>,
  freshnessByRegion: Map<string, { freshness: number; regionLabel: string }>,
  muscleRows: MuscleFreshnessRow[],
): FreshnessConflict | null {
  const muscleByKey = new Map(muscleRows.map((r) => [r.muscle, r]));

  for (const item of items) {
    if (item.kind !== "main" && item.kind !== "back_off") continue;
    const isHeavy =
      (item.percentTm != null && item.percentTm >= HEAVY_PCT_TM_FLOOR) ||
      (item.reps != null && item.reps > 0 && item.reps <= HEAVY_REP_CEILING);
    if (!isHeavy) continue;

    const slug = item.movementSlug ?? null;
    const fanout = slug ? MOVEMENT_MUSCLE_MAP[slug] : undefined;
    if (fanout && fanout.length > 0) {
      // Sort primaries first; we warn on the most-loaded primary.
      const primaries = fanout
        .filter((f) => f.weight >= 1.0)
        .map((f) => muscleByKey.get(f.muscle))
        .filter((r): r is MuscleFreshnessRow => Boolean(r))
        .sort((a, b) => a.freshness - b.freshness);
      const worst = primaries[0];
      if (worst && worst.freshness < FRESHNESS_FLOOR) {
        const moveName =
          item.movementName ??
          movementRegionById.get(item.movementId)?.name ??
          "Heavy lift";
        return {
          movementName: moveName,
          regionLabel: MUSCLE_LABELS[worst.muscle],
          freshness: worst.freshness,
        };
      }
      // Muscle mapping resolved → don't fall through to region.
      continue;
    }
  }
  // No muscle-level hit. Fall back to the region-level detector for
  // the whole batch (its own rules apply).
  return findHeavyOnRecoveringConflict(items, movementRegionById, freshnessByRegion);
}
