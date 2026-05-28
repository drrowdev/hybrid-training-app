/**
 * Per-region weekly load-spike detector.
 *
 * Pure helper that flags regions whose current ATL exceeds the 4-week
 * trailing average by more than `threshold`. Read-only — fed into the
 * Today-page warning banner; never feeds prescription, planning, or
 * volume caps. See `apps/web/src/components/today/RegionSpikeBanner.tsx`
 * for the consumer.
 *
 * The data side (4-week trailing average) is computed by
 * `apps/web/src/lib/stats/region-spike-queries.ts` from the
 * `region_state_history` daily snapshots written by the
 * `/api/cron/region-state-snapshot` cron.
 *
 * ## Calibration status (CP-3)
 *
 * `REGION_SPIKE_THRESHOLD = 0.25` is a heuristic. The IOC consensus on
 * load and injury risk (Soligard 2016) notes athletes respond "better
 * to relatively small increases" without pinning a universal %. The
 * 2025 Garmin–RUNSAFE study found single-session spikes >10% of the
 * trailing-30-day-max were significantly associated with running
 * injury, but that's a per-session metric on a different denominator
 * — not directly portable to weekly ATL. 25% is chosen as a
 * conservative weekly soft trigger pending in-app validation.
 */

/** One row per region currently in spike state. */
export type RegionSpike = {
  region: string;
  currentAtl: number;
  trailingAvg: number;
  /** `(currentAtl - trailingAvg) / trailingAvg`. 0.32 = 32% over. */
  spikePct: number;
};

/**
 * Soft weekly spike threshold.
 *
 * heuristic, no calibration data — see CP-3 note above and constant
 * row #30 in `hybrid-training-design-constraints.md`.
 */
export const REGION_SPIKE_THRESHOLD = 0.25;

/**
 * Detect regions whose current ATL exceeds the 4-week trailing average
 * by more than `threshold` (default `REGION_SPIKE_THRESHOLD`).
 *
 * Skipped silently:
 *  - regions absent from `currentByRegion`
 *  - regions where current ATL is non-finite or ≤ 0
 *  - regions where the trailing average is non-finite or ≤ 0
 *    (avoids divide-by-zero when the user has no history yet)
 *
 * The caller is responsible for the "< 4 weeks of data" guard — if the
 * trailing window has insufficient snapshots, pass an empty
 * `trailingAvgByRegion` map and every region will be skipped.
 *
 * Returns spikes sorted by `spikePct` descending so the worst region
 * surfaces first in the UI.
 */
export function detectRegionSpikes(
  currentByRegion: Record<string, number>,
  trailingAvgByRegion: Record<string, number>,
  threshold: number = REGION_SPIKE_THRESHOLD,
): RegionSpike[] {
  const out: RegionSpike[] = [];
  for (const region of Object.keys(currentByRegion)) {
    const currentAtl = currentByRegion[region];
    const trailingAvg = trailingAvgByRegion[region];
    if (!Number.isFinite(currentAtl) || currentAtl === undefined || currentAtl <= 0) continue;
    if (!Number.isFinite(trailingAvg) || trailingAvg === undefined || trailingAvg <= 0) continue;
    const spikePct = (currentAtl - trailingAvg) / trailingAvg;
    if (spikePct > threshold) {
      out.push({ region, currentAtl, trailingAvg, spikePct });
    }
  }
  out.sort((a, b) => b.spikePct - a.spikePct);
  return out;
}
