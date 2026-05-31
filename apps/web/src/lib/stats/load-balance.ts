/**
 * Load balance — body-wide acute:chronic workload ratio (EWMA-ACWR).
 *
 * The seven per-region `region_state` rows already carry an exponentially-
 * weighted moving average of training load:
 *   - `atl` — 7-day EWMA  ("acute"  / fatigue)
 *   - `ctl` — 28-day EWMA ("chronic" / fitness)
 *
 * Per-region magnitudes come from `lib/engine/region-ledger.ts` (strength
 * sets via `computeSetLoad` with the same RPE multiplier ladder, plus
 * cardio via `cardioIntensityScalar × CARDIO_LOAD_SCALAR`). Summing
 * across regions gives a body-wide load signal that this module reads
 * (no writes — strictly a stats surface).
 *
 * Why EWMA, not a flat rolling sum
 * ────────────────────────────────
 * The original "acute:chronic workload ratio" literature (Hulin 2014–16,
 * Gabbett 2016) used a rolling 7-day / 28-day mean. Lolli 2019 critiqued
 * that approach because the 7-day window is mathematically nested inside
 * the 28-day window (the same days appear in both terms), producing
 * spurious correlations with injury. Williams 2017 showed the recommended
 * fix is an *uncoupled* exponentially-weighted moving average — exactly
 * what the region ledger persists. That makes this module the honest
 * body-wide expression of the same ACWR the field has converged on.
 *
 * Honest limits (Impellizzeri 2020)
 * ─────────────────────────────────
 * ACWR alone is not a calibrated injury-prediction tool — it's a
 * load-absorption signal. We pair it with sRPE drift + objective output
 * in `readiness.ts` so the verdict is corroborated rather than asserted.
 * Bands here are *display thresholds* for that composite (see CP-1 / no
 * new CP-2 constant added; see ADR 0019).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { mondayOfYmd, todayYmd } from "@/lib/dates";

/** Display band derived from the body-wide acute:chronic ratio. */
export type LoadBand = "unknown" | "detraining" | "productive" | "pushing" | "spiking";

export type LoadBalance = {
  /** Body-wide acute load — Σ ATL across regions. */
  bodyAcute: number;
  /** Body-wide chronic load — Σ CTL across regions. */
  bodyChronic: number;
  /**
   * acute / chronic. null when chronic is zero (no real baseline yet —
   * dividing into it would produce garbage, so the caller must gate).
   */
  ratio: number | null;
  band: LoadBand;
  /**
   * Distinct ISO-weeks (Mon-anchored) with at least one completed,
   * non-deleted session in the last ~12 weeks. Used by `readiness.ts`
   * to gate cold-start verdicts (bands personalize as data grows).
   */
  weeksOfData: number;
};

/**
 * Band thresholds for the body-wide acute:chronic ratio.
 *
 * HEURISTIC / CP-1 (no new CP-2 calibration constant — see ADR 0019).
 * Magnitudes match the Gabbett 2016 "sweet spot" widely cited as
 * 0.8–1.3 with the >1.5 zone associated with elevated injury risk in
 * team-sport observational work. These are *display* thresholds for
 * the readiness card; they do not feed `buildPrescription`.
 */
export const LOAD_BAND_THRESHOLDS = {
  detrainingMax: 0.8,
  productiveMax: 1.3,
  pushingMax: 1.5,
} as const;

/** Pure helper: classify a body-wide acute:chronic ratio into a display band. */
export function loadBand(ratio: number | null): LoadBand {
  if (ratio == null || !Number.isFinite(ratio)) return "unknown";
  if (ratio < LOAD_BAND_THRESHOLDS.detrainingMax) return "detraining";
  if (ratio < LOAD_BAND_THRESHOLDS.productiveMax) return "productive";
  if (ratio < LOAD_BAND_THRESHOLDS.pushingMax) return "pushing";
  return "spiking";
}

const WEEKS_OF_DATA_LOOKBACK_DAYS = 12 * 7;

type RegionStateRow = { atl: number | string | null; ctl: number | string | null };
type SessionRow = { performed_at: string };

/**
 * Pure aggregator — sum per-region ATL/CTL into body-wide acute/chronic
 * and count distinct ISO weeks with a completed session. Exposed so the
 * decision logic stays testable without a Supabase round-trip (mirrors
 * the `aggregateWeeklyRecovery` split in `engine/recovered-weeks.ts`).
 */
export function aggregateLoadBalance(
  regionRows: readonly RegionStateRow[],
  recentSessions: readonly SessionRow[],
  tz: string,
  now: Date = new Date(),
): LoadBalance {
  let bodyAcute = 0;
  let bodyChronic = 0;
  for (const r of regionRows) {
    bodyAcute += Number(r.atl ?? 0);
    bodyChronic += Number(r.ctl ?? 0);
  }
  const ratio = bodyChronic > 0 ? bodyAcute / bodyChronic : null;

  const today = todayYmd(tz);
  const earliestMonday = mondayOfYmd(today);
  const earliestTs = now.getTime() - WEEKS_OF_DATA_LOOKBACK_DAYS * 86_400_000;
  const seenWeeks = new Set<string>();
  for (const s of recentSessions) {
    if (!s.performed_at) continue;
    const ts = Date.parse(s.performed_at);
    if (Number.isNaN(ts)) continue;
    if (ts < earliestTs) continue;
    seenWeeks.add(mondayOfYmd(s.performed_at.slice(0, 10)));
  }
  // earliestMonday is unused for the count itself; the lookback boundary
  // is enforced by `earliestTs`. We retain `today` resolution so the
  // helper stays tz-aware for any future band that wants "current ISO
  // week" demarcation.
  void earliestMonday;

  return {
    bodyAcute,
    bodyChronic,
    ratio,
    band: loadBand(ratio),
    weeksOfData: seenWeeks.size,
  };
}

/**
 * Read body-wide load balance for the user. Read path only — user-scoped
 * Supabase client, no service-role, no writes (mirrors
 * `getRegionFreshness` in `region-freshness-queries.ts`).
 */
export async function getLoadBalance(
  supabase: SupabaseClient,
  userId: string,
  tz: string,
): Promise<LoadBalance> {
  const sinceIso = new Date(
    Date.now() - WEEKS_OF_DATA_LOOKBACK_DAYS * 86_400_000,
  ).toISOString();

  const [{ data: regionRows }, { data: sessions }] = await Promise.all([
    supabase
      .from("region_state")
      .select("region, atl, ctl")
      .eq("user_id", userId),
    supabase
      .from("sessions")
      .select("performed_at")
      .eq("user_id", userId)
      .not("completed_at", "is", null)
      .is("deleted_at", null)
      .gte("performed_at", sinceIso),
  ]);

  return aggregateLoadBalance(
    (regionRows ?? []) as RegionStateRow[],
    (sessions ?? []) as SessionRow[],
    tz,
  );
}
