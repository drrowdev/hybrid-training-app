/**
 * Region freshness — DC-C14 (added 2026-05-19 in MVP scope).
 *
 *   region_freshness_r = clamp(1 − ATL_r / baseline_tolerance_r, 0, 1)
 *
 * 1.0 = fully fresh (no recent load on this region)
 * 0.5 = moderately loaded
 * 0.0 = heavily loaded recently (e.g., quads day after heavy squats)
 *
 * Replaces the deferred daily symptom self-report for "is this region beat
 * up right now" decisions. Derived purely from the per-region load ledger
 * (v2 §3.2) plus movement→region catalog metadata — no new self-report.
 *
 * Used by: DC-C8 region_risk (N_load_recency term), DC-P4 deload trigger
 * signal 6 (regional overload), DC-V2 load-recency soft block.
 */

import type { Region } from "./types";

/**
 * Clamp a number into [min, max]. Inline to keep domain pure-functional.
 */
export const clamp = (x: number, min: number, max: number): number =>
  Math.min(Math.max(x, min), max);

/**
 * Compute region freshness from acute regional load vs the region's
 * personalised baseline tolerance.
 *
 * @param atl                The 7-day EWMA load on the region (DC-C1).
 * @param baselineTolerance  The region's personalised tolerance baseline.
 *                           Conventionally the 28-day chronic load (CTL_r)
 *                           multiplied by a per-region tolerance constant
 *                           (default 1.0 — calibration target per DC-C9).
 * @returns Number in [0, 1] where 1 = fully fresh, 0 = heavily loaded.
 */
export function computeRegionFreshness(
  atl: number,
  baselineTolerance: number,
): number {
  if (baselineTolerance <= 0) {
    // Cold-start: no chronic load history → assume fresh.
    // Aligns with DC-C13 confidence_bias treatment of sparse data.
    return 1.0;
  }
  return clamp(1 - atl / baselineTolerance, 0, 1);
}

/**
 * Convenience: compute freshness for every tracked region at once.
 *
 * @param atlByRegion                Map of Region → 7-day EWMA load.
 * @param baselineToleranceByRegion  Map of Region → baseline tolerance.
 * @returns Map of Region → freshness in [0, 1].
 */
export function computeAllRegionFreshness(
  atlByRegion: Readonly<Partial<Record<Region, number>>>,
  baselineToleranceByRegion: Readonly<Partial<Record<Region, number>>>,
): Partial<Record<Region, number>> {
  const out: Partial<Record<Region, number>> = {};
  for (const region of Object.keys(atlByRegion) as Region[]) {
    const atl = atlByRegion[region] ?? 0;
    const baseline = baselineToleranceByRegion[region] ?? 0;
    out[region] = computeRegionFreshness(atl, baseline);
  }
  return out;
}

/**
 * EWMA helper (DC-C1) — alpha = 2 / (n + 1).
 * Pure function; no state.
 *
 * @param previous   Prior EWMA value.
 * @param current    Today's raw value.
 * @param windowDays Smoothing window (7 for ATL, 28 for CTL).
 */
export function ewmaStep(
  previous: number,
  current: number,
  windowDays: number,
): number {
  const alpha = 2 / (windowDays + 1);
  return alpha * current + (1 - alpha) * previous;
}
