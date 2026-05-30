/**
 * Server-side fetch for the Today-page region-spike warning banner.
 *
 * Reads the live `region_state` row per region (current ATL) plus the
 * prior 28 days of `region_state_history` snapshots (4-week trailing
 * average ATL, sourced from each snapshot's `context.atl` payload —
 * see `apps/web/src/lib/stats/region-state-snapshot.ts` for the writer
 * shape), then hands both to `detectRegionSpikes`.
 *
 * Graceful degradation:
 *  - If `region_state_history` doesn't exist yet (no migration in this
 *    PR), the Supabase query errors and we return `[]`.
 *  - If a region has fewer than `MIN_HISTORY_DAYS` (28) snapshots in
 *    the window, it's skipped — the trailing average wouldn't
 *    represent a stable 4-week baseline.
 *  - If no current `region_state` exists at all (new user), `[]`.
 *
 * This is a read-only display query. It never writes and never feeds
 * planner / prescription code.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { detectRegionSpikes, type RegionSpike } from "@/lib/engine/region-spike-detector";
import { addDaysToYmd, todayYmd } from "@/lib/dates";

/**
 * Minimum snapshot days a region needs in the trailing window before
 * we treat its mean ATL as a valid baseline. 4 weeks = 28 days matches
 * the docstring guarantee on the detector.
 */
const MIN_HISTORY_DAYS = 28;

/** Window length read from `region_state_history` (the "prior 28 days"). */
const HISTORY_WINDOW_DAYS = 28;

type RegionStateRow = {
  region: string | null;
  atl: number | string | null;
};

type RegionHistoryRow = {
  region: string | null;
  snapshot_date: string | null;
  context: unknown;
};

/**
 * Fetch current region ATL + 28-day trailing-average ATL, then run the
 * spike detector. Returns `[]` whenever data is missing or insufficient.
 */
export async function getRegionSpikes(
  supabase: SupabaseClient,
  userId: string,
  tz: string,
): Promise<RegionSpike[]> {
  const today = todayYmd(tz);
  // Prior 28 days = yesterday-back-28-days through yesterday.
  // We deliberately exclude today so "current ATL" (live region_state)
  // isn't double-counted inside the trailing baseline.
  const windowEnd = addDaysToYmd(today, -1);
  const windowStart = addDaysToYmd(windowEnd, -(HISTORY_WINDOW_DAYS - 1));

  const currentResult = await supabase
    .from("region_state")
    .select("region, atl")
    .eq("user_id", userId);
  if (currentResult.error) return [];
  const currentRows = (currentResult.data ?? []) as RegionStateRow[];
  if (currentRows.length === 0) return [];

  const currentByRegion: Record<string, number> = {};
  for (const r of currentRows) {
    if (!r.region) continue;
    const atl = Number(r.atl ?? 0);
    if (!Number.isFinite(atl)) continue;
    currentByRegion[r.region] = atl;
  }

  const historyResult = await supabase
    .from("region_state_history")
    .select("region, snapshot_date, context")
    .eq("user_id", userId)
    .gte("snapshot_date", windowStart)
    .lte("snapshot_date", windowEnd);
  // Missing table or any other read error → silent "no data".
  if (historyResult.error) return [];
  const historyRows = (historyResult.data ?? []) as RegionHistoryRow[];
  if (historyRows.length === 0) return [];

  const sumByRegion = new Map<string, number>();
  const countByRegion = new Map<string, number>();
  for (const row of historyRows) {
    if (!row.region) continue;
    const atl = readContextAtl(row.context);
    if (atl == null) continue;
    sumByRegion.set(row.region, (sumByRegion.get(row.region) ?? 0) + atl);
    countByRegion.set(row.region, (countByRegion.get(row.region) ?? 0) + 1);
  }

  const trailingAvgByRegion: Record<string, number> = {};
  for (const [region, sum] of sumByRegion) {
    const count = countByRegion.get(region) ?? 0;
    if (count < MIN_HISTORY_DAYS) continue;
    trailingAvgByRegion[region] = sum / count;
  }

  return detectRegionSpikes(currentByRegion, trailingAvgByRegion);
}

function readContextAtl(context: unknown): number | null {
  if (!context || typeof context !== "object") return null;
  const atl = (context as { atl?: unknown }).atl;
  if (atl == null) return null;
  const n = Number(atl);
  if (!Number.isFinite(n)) return null;
  return n;
}

/**
 * Fetch the elbow/forearm ATL ratio (current / 4-week trailing avg)
 * used by the focus-muscle forearm tendon-gate.
 *
 * Returns `1.0` ("baseline, no spike") when:
 *  - no current `region_state` row exists for elbow_forearm
 *  - fewer than `MIN_HISTORY_DAYS` snapshots in the trailing window
 *    (insufficient baseline — fail open rather than gate noisily)
 *  - trailing avg is ≤ 0 (divide-by-zero guard)
 *
 * The gate in `defaultMuscleTargets` triggers when this value exceeds
 * `1 + REGION_SPIKE_THRESHOLD` (= 1.25). 1.0 short-circuits the gate
 * cleanly without leaking nullable plumbing into the engine.
 *
 * Pure read; never writes. Always safe to call at prescription time —
 * if the table is missing or the user has no history, the engine still
 * produces a baseline focus prescription.
 */
export async function getElbowForearmAtlRatio(
  supabase: SupabaseClient,
  userId: string,
  tz: string,
): Promise<number> {
  const today = todayYmd(tz);
  const windowEnd = addDaysToYmd(today, -1);
  const windowStart = addDaysToYmd(windowEnd, -(HISTORY_WINDOW_DAYS - 1));

  const currentResult = await supabase
    .from("region_state")
    .select("region, atl")
    .eq("user_id", userId)
    .eq("region", "elbow_forearm")
    .maybeSingle();
  if (currentResult.error || !currentResult.data) return 1.0;
  const currentAtl = Number((currentResult.data as RegionStateRow).atl ?? 0);
  if (!Number.isFinite(currentAtl) || currentAtl <= 0) return 1.0;

  const historyResult = await supabase
    .from("region_state_history")
    .select("region, snapshot_date, context")
    .eq("user_id", userId)
    .eq("region", "elbow_forearm")
    .gte("snapshot_date", windowStart)
    .lte("snapshot_date", windowEnd);
  if (historyResult.error) return 1.0;
  const rows = (historyResult.data ?? []) as RegionHistoryRow[];

  let sum = 0;
  let count = 0;
  for (const r of rows) {
    const atl = readContextAtl(r.context);
    if (atl == null) continue;
    sum += atl;
    count += 1;
  }
  if (count < MIN_HISTORY_DAYS) return 1.0;
  const trailingAvg = sum / count;
  if (!Number.isFinite(trailingAvg) || trailingAvg <= 0) return 1.0;
  return currentAtl / trailingAvg;
}
