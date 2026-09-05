/**
 * Shared region-freshness derivation used by:
 *
 *   1. `/api/cron/region-state-snapshot` — writes today's snapshot
 *      into `region_state_history` for every user.
 *   2. `getRegionFreshnessDetail` live fallback — when the engine
 *      page is rendered before today's cron has fired, this computes
 *      today's value on the fly and the read path prepends it onto
 *      the cached 14-day strip.
 *
 * One function so the cache value and the live-fallback value always
 * match (single home for derived state — plan §6.9 / DC-K3).
 *
 * The math mirrors `apps/web/src/lib/engine/region-ledger.ts`: per-day
 * per-region load is reps × weight × clamp(rpe/10, 0.3..1.0); primary
 * region gets full load, secondary regions get 0.5×. We walk a 35-day
 * lookback applying `ewmaStep` (window=7) day-by-day and read off the
 * final ATL.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { ALL_REGIONS, type Region } from "@hta/domain";
import { computeRegionFreshness, ewmaStep } from "@hta/domain";
import { todayYmd as todayYmdFn, addDaysToYmd } from "@/lib/dates";
import { deriveDailyRegionLoad } from "@/lib/engine/region-daily-load";
import { cardioLoadQuery } from "@/lib/engine/cardio-load-projection";
import { swimSchemaAvailable } from "@/lib/swim/capability";

const LOOKBACK_DAYS = 35;

export type RegionFreshnessLive = {
  /** Freshness in [0, 1] — DC-C14. */
  freshness: number;
  /** Final ATL after walking the lookback window. */
  atl: number;
  /** Baseline tolerance (CTL × tolerance constant) — see migration 0005. */
  baseline: number;
  /** Most-recent date the region took any load. */
  lastLoadDate: string | null;
  /** Number of days inside each window that took any region load. */
  setCounts: { d7: number; d14: number; d28: number };
};

/**
 * Compute today's per-region freshness from raw `set_logs` + the
 * persisted baseline in `region_state`.
 *
 * Returned map only contains regions where there's any signal
 * (baseline > 0 OR set_logs activity in the lookback window). Regions
 * the user has never trained are omitted — the UI shows an "untouched"
 * empty state.
 */
export async function deriveRegionFreshnessLive(
  supabase: SupabaseClient,
  userId: string,
  tz: string,
): Promise<Map<Region, RegionFreshnessLive>> {
  const sinceIso = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();

  const [regionStateRes, sessionsRes] = await Promise.all([
    supabase
      .from("region_state")
      .select("region, atl, ctl, baseline_tolerance, last_load_date")
      .eq("user_id", userId),
    supabase
      .from("sessions")
      .select("id, performed_at")
      .eq("user_id", userId)
      .not("completed_at", "is", null)
      .is("deleted_at", null)
      .gte("performed_at", sinceIso)
      .order("performed_at", { ascending: true }),
  ]);
  if (regionStateRes.error) throw new Error(regionStateRes.error.message);
  if (sessionsRes.error) throw new Error(sessionsRes.error.message);
  const regionStateRows = regionStateRes.data;
  const sessions = sessionsRes.data;

  const baselineByRegion = new Map<Region, number>();
  const lastLoadByRegion = new Map<Region, string | null>();
  for (const r of regionStateRows ?? []) {
    baselineByRegion.set(r.region as Region, Number(r.baseline_tolerance ?? 0));
    lastLoadByRegion.set(r.region as Region, (r.last_load_date as string | null) ?? null);
  }

  const dailyByRegion = deriveDailyRegionLoad({
    userTz: tz,
    sets: [],
    cardio: [],
  });

  if (sessions && sessions.length > 0) {
    const sessionIds = sessions.map((s) => s.id);
    const performedAtById = new Map(sessions.map((s) => [s.id, s.performed_at as string]));
    const hasSwimming = await swimSchemaAvailable(supabase);
    const [setsRes, cardioRes] = await Promise.all([
      supabase
        .from("set_logs")
        .select(
          "session_id, weight_kg, reps, rpe, set_kind, skipped, movement:movements(primary_region, secondary_regions)",
        )
        .in("session_id", sessionIds)
        .eq("skipped", false)
        .not("reps", "is", null)
        .gt("reps", 0),
      cardioLoadQuery(supabase, hasSwimming)
        .in("session_id", sessionIds),
    ]);
    if (setsRes.error) throw new Error(setsRes.error.message);
    if (cardioRes.error) throw new Error(cardioRes.error.message);

    const daily = deriveDailyRegionLoad({
      userTz: tz,
      sets: (setsRes.data ?? []).flatMap((row) => {
        const performedAt = performedAtById.get(row.session_id);
        return performedAt
          ? [{
              performedAt,
              weightKg: row.weight_kg,
              reps: row.reps,
              rpe: row.rpe,
              setKind: row.set_kind,
              skipped: row.skipped,
              movement: row.movement,
            }]
          : [];
      }),
      cardio: (cardioRes.data ?? []).flatMap((row) => {
        const performedAt = performedAtById.get(row.session_id);
        return performedAt
          ? [{
              performedAt,
              durationSec: row.duration_sec,
              rpe: row.rpe,
              modality: row.modality,
              hrZones: row.hr_zones,
              swimResult: "swim_result" in row ? row.swim_result : undefined,
              movement: row.movement,
            }]
          : [];
      }),
    });
    for (const region of ALL_REGIONS) {
      dailyByRegion.set(region, daily.get(region)!);
    }
  }

  const today = todayYmdFn(tz);
  const start = addDaysToYmd(today, -(LOOKBACK_DAYS - 1));

  const out = new Map<Region, RegionFreshnessLive>();
  for (const region of ALL_REGIONS) {
    const series = dailyByRegion.get(region)!;
    const baseline = baselineByRegion.get(region) ?? 0;
    if (baseline <= 0 && series.size === 0) continue;

    let atl = 0;
    for (let cursor = start; cursor <= today; cursor = addDaysToYmd(cursor, 1)) {
      const load = series.get(cursor) ?? 0;
      atl = ewmaStep(atl, load, 7);
    }
    const freshness = computeRegionFreshness(atl, baseline > 0 ? baseline : Math.max(atl, 1));
    out.set(region, {
      freshness,
      atl,
      baseline,
      lastLoadDate: lastLoadByRegion.get(region) ?? null,
      setCounts: countSetsInWindows(series, today),
    });
  }
  return out;
}

function countSetsInWindows(
  series: Map<string, number>,
  today: string,
): { d7: number; d14: number; d28: number } {
  let d7 = 0;
  let d14 = 0;
  let d28 = 0;
  for (const [date, load] of series) {
    if (load <= 0) continue;
    const diff = daysSinceYmd(date, today);
    if (diff < 0) continue;
    if (diff < 7) d7++;
    if (diff < 14) d14++;
    if (diff < 28) d28++;
  }
  return { d7, d14, d28 };
}

function daysSinceYmd(start: string, end: string): number {
  const a = Date.UTC(
    Number(start.slice(0, 4)),
    Number(start.slice(5, 7)) - 1,
    Number(start.slice(8, 10)),
  );
  const b = Date.UTC(
    Number(end.slice(0, 4)),
    Number(end.slice(5, 7)) - 1,
    Number(end.slice(8, 10)),
  );
  return Math.round((b - a) / 86_400_000);
}
