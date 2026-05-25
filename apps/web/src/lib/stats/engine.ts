/**
 * Engine-page read helpers (Phase 6).
 *
 * Powers `/app/stats/engine` — the "show me how the planner thinks"
 * surface. This file is the single home for the engine-page derived
 * shape (DC-K3 single home for derived state): the page imports these
 * accessors and never re-derives.
 *
 * Cited design constraints:
 *  - DC-C11 final ceiling equation: ceiling_q = base_ceiling_q × GRM ×
 *    quality_modifier_q × interference_modifier_q × region_cap_factor_q
 *    × confidence_bias
 *  - DC-C13 confidence bias bands (data completeness → confidence_bias)
 *  - DC-C14 region freshness (per-region 0..1 reading)
 *  - DC-G1..G6 user tier inference (cold-start = intermediate per DC-G5)
 *  - DC-K4 override-and-warn — surface a chronological record of times
 *    the user overrode an engine recommendation (skips and swaps).
 *  - DC-M1 MV/MEV/MAV/MRV per-muscle volume landmarks (rendered as
 *    threshold lines on the region freshness card).
 *
 * Everything in here is a *read* helper. No writes, no engine logic —
 * engine logic lives in `packages/engine` and `apps/web/src/lib/engine`.
 * Where the underlying engine doesn't yet persist what we want
 * (override audit log, computed GRM, behavioural BTS), we degrade
 * gracefully with `notTracked = true` flags instead of inventing data.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { ENGINE_VERSION } from "@hta/engine";
import {
  pickCeilingBase,
  isRecoveredWeek,
  type CeilingBaseFormula,
  type CeilingBasisWeek,
} from "@hta/engine";
import { ALL_REGIONS, type Region } from "@hta/domain";
import { computeRegionFreshness, ewmaStep } from "@hta/domain";
import { ARCHETYPES, type ArchetypeId } from "@/lib/planner/archetypes";
import { archetypeDisplayName } from "@/lib/planner/queries";
import {
  ALL_BUCKETS,
  setBucketLoad,
  cardioBucketLoad,
  type BucketLoad,
} from "@/lib/engine/bucket-load";
import type { Bucket } from "@hta/domain";
import { todayYmd as todayYmdFn, addDaysToYmd, isoWeekdayYmd } from "@/lib/dates";
import { getWeeklyRecoveryRollup } from "@/lib/engine/recovered-weeks";
import { deriveRegionFreshnessLive } from "@/lib/stats/region-state-snapshot";

const REGION_LABELS: Record<Region, string> = {
  foot_ankle_calf: "Calves & feet",
  knee: "Knees & quads",
  hamstring_posterior: "Hamstrings & glutes",
  adductor_groin: "Hips & groin",
  lumbar_trunk: "Lower back & core",
  shoulder_scapular: "Shoulders & upper back",
  elbow_forearm: "Arms & elbows",
};

// ───────────────────────────────────────────────────────────────────
// A · Decision trace (DC-K4 transparency)
// ───────────────────────────────────────────────────────────────────

export type DecisionTraceReason = {
  /** Short one-line bullet shown under "Chosen because". */
  text: string;
  /** Optional DC-* identifier the bullet cites. */
  cite?: string;
};

export type DecisionTrace = {
  /** Plain-language "Today's session: X" headline. */
  headline: string;
  /** Reason bullets, ordered most-determinative first. */
  reasons: DecisionTraceReason[];
  /** True when no active block exists — UI surfaces a different message. */
  noBlock: boolean;
  /** True when today is a rest day inside an active block. */
  restDay: boolean;
};

type RegionFreshnessTuple = {
  region: Region;
  label: string;
  freshness: number;
};

/**
 * Build today's decision-trace bullets from live engine inputs.
 *
 * Inputs:
 *  - active training block (archetype + week index)
 *  - today's planned session (title + role)
 *  - region freshness snapshot
 *
 * The returned `reasons` are *derived* — not a static template — so the
 * UI accurately reflects engine state. Empty array means "no signal to
 * narrate" (e.g. brand-new user with no block).
 */
export async function getDecisionTrace(
  supabase: SupabaseClient,
  userId: string,
  tz: string,
): Promise<DecisionTrace> {
  // Active block + today's planned sessions.
  const { data: block } = await supabase
    .from("training_blocks")
    .select("id, archetype, started_on, weeks, notes")
    .eq("user_id", userId)
    .eq("status", "active")
    .is("deleted_at", null)
    .order("started_on", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!block) {
    return {
      headline: "No active block",
      reasons: [
        {
          text: "Start or resume a block on the Plan page and the engine will explain its picks here.",
        },
      ],
      noBlock: true,
      restDay: false,
    };
  }

  const today = todayYmdFn(tz);
  const startWeekday = isoWeekdayYmd(block.started_on);
  const blockMonday = addDaysToYmd(block.started_on, -startWeekday);
  const daysSinceMonday = daysSinceYmd(blockMonday, today);
  const weekIndex = Math.max(0, Math.min(block.weeks - 1, Math.floor(daysSinceMonday / 7)));
  const archetypeName = archetypeDisplayName(block.archetype, block.notes ?? null);
  const archetype = ARCHETYPES[block.archetype as Exclude<ArchetypeId, "custom">];
  const weekProfile = archetype?.weekProfiles[weekIndex];

  const { data: todayPlanned } = await supabase
    .from("planned_sessions")
    .select("title, role, prescription, week_index, day_index, slot")
    .eq("block_id", block.id)
    .eq("week_index", weekIndex)
    .eq("day_index", daysSinceMonday - weekIndex * 7);

  const reasons: DecisionTraceReason[] = [];
  reasons.push({
    text: `You're in week ${weekIndex + 1} of ${archetypeName}${weekProfile?.intensityLabel ? ` (${weekProfile.intensityLabel})` : ""}.`,
    cite: "DC-F1",
  });

  // Region freshness summary.
  const freshnessRows = await getRegionFreshnessSnapshot(supabase, userId);
  if (freshnessRows.length > 0) {
    const freshNames = freshnessRows.filter((r) => r.freshness >= 0.7).map((r) => r.label);
    const primedNames = freshnessRows.filter((r) => r.freshness >= 0.4 && r.freshness < 0.7).map((r) => r.label);
    const heavyNames = freshnessRows.filter((r) => r.freshness < 0.4).map((r) => r.label);
    const parts: string[] = [];
    if (freshNames.length > 0) parts.push(`${joinList(freshNames)} fresh`);
    if (primedNames.length > 0) parts.push(`${joinList(primedNames)} primed`);
    if (heavyNames.length > 0) parts.push(`${joinList(heavyNames)} loaded`);
    if (parts.length > 0) {
      reasons.push({
        text: `Region freshness — ${parts.join("; ")}.`,
        cite: "DC-C14",
      });
    }
  }

  // Rest-day case: no planned session for today.
  if (!todayPlanned || todayPlanned.length === 0) {
    reasons.push({
      text: "No anchor session scheduled for today — the engine treats it as a recovery day.",
      cite: "DC-E1",
    });
    return {
      headline: "Today: rest day",
      reasons,
      noBlock: false,
      restDay: true,
    };
  }

  const planned = todayPlanned[0]!;
  const sessionTitle = planned.title ?? "Today's session";
  const role = (planned.role as string | null) ?? "primary";
  const mainItem = pickMainItem(planned.prescription);
  const headlineMovement = mainItem?.movementName
    ? ` — ${mainItem.movementName}`
    : "";

  reasons.push({
    text: `${capitalise(role.replaceAll("_", " "))} role due today, per the ${archetypeName} weekly plan.`,
    cite: "DC-F1",
  });

  if (weekProfile) {
    const topIntensity = weekProfile.setIntensities.length > 0
      ? Math.max(...weekProfile.setIntensities)
      : null;
    if (topIntensity != null) {
      reasons.push({
        text: `Top set capped at ${Math.round(topIntensity * 100)}% TM for this week's intensity wave.`,
        cite: "DC-C11",
      });
    }
  }

  return {
    headline: `Today: ${sessionTitle}${headlineMovement}`,
    reasons,
    noBlock: false,
    restDay: false,
  };
}

function pickMainItem(prescription: unknown): { movementName?: string } | null {
  if (!prescription || typeof prescription !== "object") return null;
  const items = (prescription as { items?: Array<{ kind?: string; movementName?: string }> }).items;
  if (!Array.isArray(items)) return null;
  return items.find((it) => it.kind === "main") ?? items[0] ?? null;
}

function joinList(parts: string[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0]!;
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function capitalise(s: string): string {
  if (!s) return s;
  return s[0]!.toUpperCase() + s.slice(1);
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

// ───────────────────────────────────────────────────────────────────
// B · Region freshness — current + 14-day history with MV/MEV/MAV/MRV
// ───────────────────────────────────────────────────────────────────

export type RegionFreshnessDetail = {
  region: Region;
  label: string;
  currentFreshness: number;
  lastLoadDate: string | null;
  /** Per-day 14-day freshness history (oldest first). */
  history: number[];
  /** Total hard-set count over the last 7d / 14d / 28d windows. */
  setCounts: { d7: number; d14: number; d28: number };
};

const FRESHNESS_THRESHOLDS = {
  // Render order = MRV (lowest freshness, most loaded) → MV (highest freshness, least loaded).
  // MV/MEV/MAV/MRV on a freshness axis (1 = fresh, 0 = hammered):
  //   MV  ~ 0.85 (maintenance — barely-touched region)
  //   MEV ~ 0.60 (minimum effective — productive zone begins)
  //   MAV ~ 0.30 (max adaptive — strongly loaded but still recoverable)
  //   MRV ~ 0.10 (max recoverable — past here is overstrain)
  // The bands are render-only; the engine math (DC-C14) is the raw
  // freshness ratio.
  mv: 0.85,
  mev: 0.6,
  mav: 0.3,
  mrv: 0.1,
} as const;

export const FRESHNESS_THRESHOLD_LABELS: Array<{
  key: keyof typeof FRESHNESS_THRESHOLDS;
  value: number;
  label: string;
}> = [
  { key: "mv", value: FRESHNESS_THRESHOLDS.mv, label: "MV · maintenance" },
  { key: "mev", value: FRESHNESS_THRESHOLDS.mev, label: "MEV · minimum effective" },
  { key: "mav", value: FRESHNESS_THRESHOLDS.mav, label: "MAV · maximum adaptive" },
  { key: "mrv", value: FRESHNESS_THRESHOLDS.mrv, label: "MRV · maximum recoverable" },
];

async function getRegionFreshnessSnapshot(
  supabase: SupabaseClient,
  userId: string,
): Promise<RegionFreshnessTuple[]> {
  const { data } = await supabase
    .from("region_state")
    .select("region, atl, baseline_tolerance")
    .eq("user_id", userId);
  if (!data) return [];
  const rows: RegionFreshnessTuple[] = [];
  for (const r of data) {
    const atl = Number(r.atl ?? 0);
    const baseline = Number(r.baseline_tolerance ?? 0);
    if (atl <= 0 && baseline <= 0) continue;
    const region = r.region as Region;
    rows.push({
      region,
      label: REGION_LABELS[region] ?? region,
      freshness: computeRegionFreshness(atl, baseline),
    });
  }
  rows.sort((a, b) => a.freshness - b.freshness);
  return rows;
}

const HISTORY_LOOKBACK_DAYS = 35;
const HISTORY_WINDOW_DAYS = 14;

/**
 * Per-region 14-day freshness history — cache-backed.
 *
 * Reads the last 14 rows per region from `region_state_history`, the
 * daily snapshot table written by the 03:00 UTC cron at
 * `/api/cron/region-state-snapshot`.
 *
 * ## Today fallback
 *
 * The cron runs once a day, so for any visit between 00:00 UTC and the
 * 03:00 UTC cron the row for "today" hasn't been written yet. We don't
 * want to show stale data ("freshness as of midnight") to the user —
 * so the read path falls back to computing today's value live via
 * `deriveRegionFreshnessLive` (the same derivation the cron uses) and
 * either appends it as a 15th point or replaces today's already-
 * snapshotted point. The user always sees up-to-the-minute current
 * freshness; the strip background remains the cached series.
 *
 * The live derivation also supplies the `setCounts` / `lastLoadDate`
 * because those are "current" by definition — we don't render a
 * historical version of them.
 *
 * If no cached rows exist for a region (cron never ran, or backfill
 * hasn't been done) AND no live data exists, the region is omitted —
 * matching the previous behaviour.
 */
export async function getRegionFreshnessDetail(
  supabase: SupabaseClient,
  userId: string,
  tz: string,
): Promise<RegionFreshnessDetail[]> {
  const today = todayYmdFn(tz);
  const windowStart = addDaysToYmd(today, -(HISTORY_WINDOW_DAYS - 1));

  const { data: historyRows } = await supabase
    .from("region_state_history")
    .select("region, snapshot_date, freshness_score, context")
    .eq("user_id", userId)
    .gte("snapshot_date", windowStart)
    .lte("snapshot_date", today)
    .order("snapshot_date", { ascending: true });

  const cachedByRegion = new Map<Region, Array<{ date: string; freshness: number; context: unknown }>>();
  for (const r of historyRows ?? []) {
    const region = r.region as Region;
    if (!ALL_REGIONS.includes(region)) continue;
    const arr = cachedByRegion.get(region) ?? [];
    arr.push({
      date: r.snapshot_date as string,
      freshness: Number(r.freshness_score),
      context: r.context,
    });
    cachedByRegion.set(region, arr);
  }

  // Always pull live for today — cheap (already bounded by 35-day
  // lookback) and guarantees the "today" column reflects the user's
  // most-recent log without waiting for the cron. Also used as the
  // source of truth for setCounts / lastLoadDate.
  const live = await deriveRegionFreshnessLive(supabase, userId, tz);

  const out: RegionFreshnessDetail[] = [];
  for (const region of ALL_REGIONS) {
    const cached = cachedByRegion.get(region) ?? [];
    const liveRow = live.get(region) ?? null;
    if (cached.length === 0 && !liveRow) continue;

    const history: number[] = cached.map((c) => c.freshness);
    let currentFreshness: number;
    let lastLoadDate: string | null = null;
    let setCounts = { d7: 0, d14: 0, d28: 0 };

    if (liveRow) {
      const last = cached[cached.length - 1];
      if (!last || last.date !== today) {
        // Cron hasn't snapshotted today yet — append the live value.
        history.push(liveRow.freshness);
      } else {
        // Today is already snapshotted; the live value is fresher
        // (the user may have logged a set since 03:00 UTC).
        history[history.length - 1] = liveRow.freshness;
      }
      currentFreshness = liveRow.freshness;
      lastLoadDate = liveRow.lastLoadDate;
      setCounts = liveRow.setCounts;
    } else {
      // No live data for this region — fall back entirely to cache.
      const last = cached[cached.length - 1]!;
      currentFreshness = last.freshness;
      const ctx = (last.context as Record<string, unknown> | null) ?? null;
      lastLoadDate = (ctx?.last_hit_date as string | null) ?? null;
      setCounts = {
        d7: Number(ctx?.sets_7d ?? 0),
        d14: Number(ctx?.sets_14d ?? 0),
        d28: Number(ctx?.sets_28d ?? 0),
      };
    }

    if (history.length === 0) continue;

    out.push({
      region,
      label: REGION_LABELS[region] ?? region,
      currentFreshness,
      lastLoadDate,
      history,
      setCounts,
    });
  }

  out.sort((a, b) => a.currentFreshness - b.currentFreshness);
  return out;
}

// ───────────────────────────────────────────────────────────────────
// C · Bucket pressure — current pressure vs ceiling per bucket
// ───────────────────────────────────────────────────────────────────

export type BucketPressureRow = {
  bucket: Bucket;
  label: string;
  description: string;
  /** ATL / baseline-tolerance ratio (DC-C2 acute-pct term). */
  currentPressure: number;
  /** Bucket ceiling — currently the 28d CTL (chronic norm). */
  ceiling: number;
  /** currentPressure / ceiling, clamped to ≥ 0. */
  percentOfCeiling: number;
  atl: number;
  ctl: number;
  why: string;
};

const BUCKET_DISPLAY: Record<Bucket, { label: string; description: string; why: string }> = {
  neural: {
    label: "Nervous system",
    description: "Heavy lifts and max efforts — recovery is slow but adaptation is big.",
    why: "Neural pressure = 7-day EWMA of heavy-load contributions / 28-day chronic norm. Drives the recovery multiplier.",
  },
  mechanical: {
    label: "Muscle work",
    description: "Total tonnage — how much pure volume you've moved.",
    why: "Mechanical pressure = sets × reps × weight × RPE summed daily, EWMA'd. Anchors the MEV/MAV landmarks.",
  },
  metabolic: {
    label: "Conditioning",
    description: "Lactate / breathing — hard cardio and high-rep work.",
    why: "Metabolic pressure rises with high-rep sets and hard cardio. Pushes the interference modifier.",
  },
  impact: {
    label: "Pounding",
    description: "Running, plyo, heavy eccentrics — joints and connective tissue.",
    why: "Impact pressure tracks running + high-strain-tendon work. Caps explosive doses.",
  },
  axial: {
    label: "Spinal load",
    description: "Squats, deadlifts, OHP, loaded carries — back can only take so much.",
    why: "Axial pressure is the lumbar/trunk compression accumulator. Pinned at moderate weight.",
  },
  tissue: {
    label: "Tendons",
    description: "Tendons remodel slowly — very-heavy lifts and running add up.",
    why: "Tendon pressure tracks high-strain-tendon exposures. Used for plyo gating + soft block.",
  },
};

export async function getBucketPressure(
  supabase: SupabaseClient,
  userId: string,
  tz: string,
): Promise<BucketPressureRow[]> {
  const sinceIso = new Date(Date.now() - HISTORY_LOOKBACK_DAYS * 86_400_000).toISOString();
  const { data: sessions } = await supabase
    .from("sessions")
    .select("id, performed_at")
    .eq("user_id", userId)
    .not("completed_at", "is", null)
    .is("deleted_at", null)
    .gte("performed_at", sinceIso)
    .order("performed_at", { ascending: true });

  // Cold start — return zeros so the page can render the "no signal"
  // copy instead of throwing.
  if (!sessions || sessions.length === 0) {
    return ALL_BUCKETS.map((bucket) => ({
      bucket,
      label: BUCKET_DISPLAY[bucket].label,
      description: BUCKET_DISPLAY[bucket].description,
      currentPressure: 0,
      ceiling: 0,
      percentOfCeiling: 0,
      atl: 0,
      ctl: 0,
      why: BUCKET_DISPLAY[bucket].why,
    }));
  }

  const sessionIds = sessions.map((s) => s.id);
  const performedAtById = new Map(sessions.map((s) => [s.id, s.performed_at as string]));

  const [setsRes, cardioRes] = await Promise.all([
    supabase
      .from("set_logs")
      .select("session_id, reps, weight_kg, rpe, set_kind, movement:movements(axial_load, high_strain_tendon)")
      .in("session_id", sessionIds)
      .eq("skipped", false)
      .not("reps", "is", null)
      .gt("reps", 0),
    supabase
      .from("cardio_logs")
      .select("session_id, duration_sec, rpe, modality")
      .in("session_id", sessionIds),
  ]);

  const series: Record<Bucket, Map<string, number>> = Object.fromEntries(
    ALL_BUCKETS.map((b) => [b, new Map<string, number>()]),
  ) as Record<Bucket, Map<string, number>>;

  for (const row of setsRes.data ?? []) {
    if (row.set_kind === "warmup") continue;
    const performedAt = performedAtById.get(row.session_id);
    if (!performedAt) continue;
    const date = performedAt.slice(0, 10);
    const movement = normaliseBucketMovement(row.movement) ?? { axial_load: "low", high_strain_tendon: false };
    const load = setBucketLoad(
      {
        reps: Number(row.reps),
        weightKg: Number(row.weight_kg ?? 0),
        rpe: row.rpe == null ? null : Number(row.rpe),
      },
      { axialLoad: movement.axial_load, highStrainTendon: movement.high_strain_tendon },
    );
    accumulateBuckets(series, date, load);
  }
  for (const row of cardioRes.data ?? []) {
    const performedAt = performedAtById.get(row.session_id);
    if (!performedAt) continue;
    const date = performedAt.slice(0, 10);
    const load = cardioBucketLoad({
      durationSec: row.duration_sec,
      rpe: row.rpe == null ? null : Number(row.rpe),
      modality: row.modality,
    });
    accumulateBuckets(series, date, load);
  }

  const today = todayYmdFn(tz);
  const start = sessions[0]!.performed_at.slice(0, 10);

  return ALL_BUCKETS.map((bucket) => {
    let atl = 0;
    let ctl = 0;
    for (let cursor = start; cursor <= today; cursor = addDaysToYmd(cursor, 1)) {
      const load = series[bucket].get(cursor) ?? 0;
      atl = ewmaStep(atl, load, 7);
      ctl = ewmaStep(ctl, load, 28);
    }
    const ceiling = Math.max(ctl, 1);
    const pct = ceiling > 0 ? atl / ceiling : 0;
    return {
      bucket,
      label: BUCKET_DISPLAY[bucket].label,
      description: BUCKET_DISPLAY[bucket].description,
      currentPressure: atl,
      ceiling,
      percentOfCeiling: pct,
      atl,
      ctl,
      why: BUCKET_DISPLAY[bucket].why,
    };
  });
}

type BucketMovementRefs = { axial_load: string | null; high_strain_tendon: boolean };

function normaliseBucketMovement(m: unknown): BucketMovementRefs | null {
  if (!m) return null;
  if (Array.isArray(m)) return (m[0] as BucketMovementRefs) ?? null;
  return m as BucketMovementRefs;
}

function accumulateBuckets(
  series: Record<Bucket, Map<string, number>>,
  date: string,
  load: BucketLoad,
): void {
  for (const bucket of ALL_BUCKETS) {
    const prev = series[bucket].get(date) ?? 0;
    series[bucket].set(date, prev + load[bucket]);
  }
}

// ───────────────────────────────────────────────────────────────────
// D · Ceiling explainer (DC-C9 · DC-C11 · DC-C13 · DC-K1)
// ───────────────────────────────────────────────────────────────────

export type CeilingExplain = {
  /** Median weekly tonnage (kg) across the last 3 recovered weeks per DC-C9 / DC-K1. */
  baseCeiling: number;
  /** Global recovery multiplier — DC-C5. MVP proxy: 1.0 (no daily wellness inputs). */
  recoveryMultiplier: number;
  /** Confidence bias — DC-C13. */
  confidenceBias: number;
  /** Final ceiling for the week (baseCeiling × GRM × confidenceBias). */
  finalCeiling: number;
  /** Which weeks (and their volumes) feed the base — for the UI table. */
  basisWeeks: CeilingBasisWeek[];
  /** Which DC-K1 / DC-C13 branch produced the base. */
  formula: CeilingBaseFormula;
  /** Inputs feeding the equation, for the UI explainer panel. */
  inputs: {
    completedSessions28d: number;
    recoveredWeeksCount: number;
    dataCompleteness: number;
    notes: string[];
  };
};

export async function getCeilingExplain(
  supabase: SupabaseClient,
  userId: string,
): Promise<CeilingExplain> {
  // DC-K1: 12-week lookback rolls up to per-week recovery rows.
  const rollup = await getWeeklyRecoveryRollup(supabase, userId, { weeks: 12 });
  const recoveredCount = rollup.filter((w) => isRecoveredWeek(w).isRecovered).length;

  // Wire the volume metric (re-used: Σ weight × reps per non-warmup
  // set, same definition as lib/stats/volume.ts) through to the pure
  // ceiling-base picker.
  const volumeByWeek = new Map(rollup.map((w) => [w.weekStart, w.weeklyTonnageKg]));
  const base = pickCeilingBase(rollup, (ws) => volumeByWeek.get(ws) ?? 0);

  // GRM placeholder — DC-C5 wellness inputs deferred (out of scope
  // for this PR; tied to sleep which is in walkback).
  const recoveryMultiplier = 1.0;
  const finalCeiling = base.baseCeiling * recoveryMultiplier * base.confidenceBias;

  // Headcount of completed sessions in the last 28 days — kept for
  // backwards-compat with surfaces that still display it.
  const since28d = new Date(Date.now() - 28 * 86_400_000).toISOString();
  const { count: completed28d } = await supabase
    .from("sessions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .not("completed_at", "is", null)
    .is("deleted_at", null)
    .gte("performed_at", since28d);
  const completed = completed28d ?? 0;
  const dataCompleteness = await computeDataCompleteness(supabase, userId);

  const notes: string[] = [];
  if (base.formula === "median_of_recovered") {
    notes.push(
      `Base = median weekly tonnage across your last 3 recovered weeks. ${recoveredCount} of last 12 weeks qualified.`,
    );
  } else if (base.formula === "cold_start_partial") {
    notes.push(
      `Cold start — only ${recoveredCount} recovered week${recoveredCount === 1 ? "" : "s"} in the last 12. Base = median of those, with a 0.80× confidence collapse.`,
    );
  } else {
    notes.push(
      "Cold start — no fully recovered weeks in the last 12. Base = lowest of the last 4 weeks × 0.9, with a 0.80× confidence collapse.",
    );
  }
  notes.push(
    "Recovery multiplier = 1.0 — daily wellness inputs are deferred to a later phase.",
  );

  return {
    baseCeiling: base.baseCeiling,
    recoveryMultiplier,
    confidenceBias: base.confidenceBias,
    finalCeiling,
    basisWeeks: base.basisWeeks,
    formula: base.formula,
    inputs: {
      completedSessions28d: completed,
      recoveredWeeksCount: recoveredCount,
      dataCompleteness,
      notes,
    },
  };
}

async function computeDataCompleteness(
  supabase: SupabaseClient,
  userId: string,
): Promise<number> {
  const since28d = new Date(Date.now() - 28 * 86_400_000).toISOString();
  const [sessions, wellness] = await Promise.all([
    supabase
      .from("sessions")
      .select("performed_at")
      .eq("user_id", userId)
      .not("completed_at", "is", null)
      .is("deleted_at", null)
      .gte("performed_at", since28d),
    supabase
      .from("wellness")
      .select("date")
      .eq("user_id", userId)
      .gte("date", since28d.slice(0, 10)),
  ]);
  const days = new Set<string>();
  for (const s of sessions.data ?? []) {
    days.add(String(s.performed_at).slice(0, 10));
  }
  for (const w of wellness.data ?? []) {
    days.add(String(w.date).slice(0, 10));
  }
  return Math.min(1, days.size / 28);
}

// ───────────────────────────────────────────────────────────────────
// E · User tier (DC-G1..G6)
// ───────────────────────────────────────────────────────────────────

import {
  computeTier,
  DECLARED_TO_TIER,
  type DeclaredExperience,
  type TierLevel,
  type TierResult,
  type Contributor,
} from "@hta/engine";
import { gatherTierInputs } from "@/lib/engine/tier-detection";

export type UserTier = TierLevel;

export type UserTierContributor = Contributor;

export type UserTierState = {
  /** Final tier used by the UI (declared wins when set — DC-K4 soft-warn
   *  semantics surface mismatch separately). */
  tier: UserTier;
  tierLabel: string;
  /** The tier the user declared during onboarding, if any. */
  declared: UserTier | null;
  declaredLabel: string | null;
  /** Raw declared training-experience enum (5-tier scale). */
  declaredExperience: DeclaredExperience | null;
  /** Human-friendly years description, e.g. "1–3 years of consistent training". */
  declaredYearsLabel: string | null;
  /** Tier the observed signals lean toward, before respecting the declaration. */
  inferred: UserTier;
  inferredLabel: string;
  /** True when declared and inferred disagree (DC-K4 soft warn). */
  mismatch: boolean;
  /** "low" | "moderate" | "high" — drives the confidence badge. */
  confidence: TierResult["confidence"];
  /** Number of contributors with data — surfaces alongside confidence. */
  contributorCount: number;
  /** Per-contributor breakdown for the "How is this computed?" panel. */
  contributors: UserTierContributor[];
  scoresByTier: Record<UserTier, number>;
  /** Cold-start when no observed signal AND nothing declared (DC-G5). */
  isColdStart: boolean;
  /** Approximate number of sessions until the next-tier gate (DC-G3). */
  sessionsUntilNextTier: number | null;
  /** Plain-language description of what gates the next tier. */
  nextTierGateNote: string | null;
  /** Plain-language description for the UI ("You're at X · Y years of training"). */
  description: string;
  /** "How is this computed?" inline-doc paragraph (DC-G1/G2 narration). */
  explanation: string;
};

const TIER_LABELS: Record<UserTier, string> = {
  consumer: "Consumer",
  intermediate: "Intermediate",
  high_performance: "High-performance",
};

/**
 * Years-bucket → human description (DC-G5 cold-start anchor). Kept in
 * sync with the onboarding wizard copy and the settings page.
 */
const DECLARED_YEARS_LABEL: Record<DeclaredExperience, string> = {
  beginner_lt_6m: "Less than 6 months of consistent training",
  novice_6m_2y: "6 months – 2 years of consistent training",
  intermediate_2y_5y: "2 – 5 years of consistent training",
  advanced_5y_10y: "5 – 10 years of consistent training",
  highly_advanced_10y_plus: "10+ years of consistent training",
};

/**
 * User tier — declared + 4-input weighted formula (DC-G1..G6).
 *
 * Pure derivation lives in `@hta/engine::computeTier`. This function
 * fetches the live signals via `gatherTierInputs` and packages the
 * result for the engine-page UI.
 *
 * DC-K4 soft-warn: when declared and inferred disagree, declared wins
 * (the user owns that declaration) and the mismatch is surfaced as a
 * note — never silently overruled.
 */
export async function getUserTier(
  supabase: SupabaseClient,
  userId: string,
): Promise<UserTierState> {
  const inputs = await gatherTierInputs(supabase, userId);
  const result = computeTier(inputs);

  const declared = inputs.declaredExperience
    ? DECLARED_TO_TIER[inputs.declaredExperience]
    : null;
  const declaredYearsLabel = inputs.declaredExperience
    ? DECLARED_YEARS_LABEL[inputs.declaredExperience]
    : null;
  const declaredLabel = declared ? TIER_LABELS[declared] : null;

  const isColdStart =
    inputs.declaredExperience == null &&
    Object.keys(inputs.e1rmKgByRole).length === 0 &&
    inputs.anchorAdherenceLast12w == null &&
    inputs.scheduleRegularity == null &&
    inputs.recoveryInputConsistency == null;

  const description = buildDescription(result, declaredYearsLabel, isColdStart);

  const explanation =
    "Your tier is computed from declared experience plus four observed signals: " +
    "per-lift e1RM relative to bodyweight (or absolute kg as a fallback), 12-week " +
    "anchor adherence, schedule regularity, and recovery check-in fill rate. Each " +
    "input contributes weighted evidence toward one of three tiers; the highest " +
    "weighted sum wins. Declared experience anchors the verdict — tier stays " +
    "behavioural, but any declared-vs-observed mismatch surfaces as a soft note " +
    "rather than silently overruling.";

  return {
    tier: result.tier,
    tierLabel: TIER_LABELS[result.tier],
    declared,
    declaredLabel,
    declaredExperience: inputs.declaredExperience,
    declaredYearsLabel,
    inferred: result.inferred,
    inferredLabel: TIER_LABELS[result.inferred],
    mismatch: result.mismatch,
    confidence: result.confidence,
    contributorCount: result.contributors.length,
    contributors: result.contributors,
    scoresByTier: result.scoresByTier,
    isColdStart,
    sessionsUntilNextTier: result.sessionsUntilNextTier,
    nextTierGateNote: result.nextTierGateNote,
    description,
    explanation,
  };
}

function buildDescription(
  result: TierResult,
  declaredYearsLabel: string | null,
  isColdStart: boolean,
): string {
  if (isColdStart) {
    return "Cold start — log a few sessions so the engine can read your training signals.";
  }
  if (declaredYearsLabel) return declaredYearsLabel;
  const cContrib = result.contributors.length;
  return `${cContrib} observed signal${cContrib === 1 ? "" : "s"} — declared experience not set.`;
}

/**
 * Legacy BTS-style tier-from-score helper. Retained for back-compat
 * with callers that map a 0..100 score to the DC-G3 thresholds; new
 * code should use `computeTier` from `@hta/engine` directly.
 */
export function btsToTier(bts: number): UserTier {
  if (bts >= 75) return "high_performance";
  if (bts >= 50) return "intermediate";
  return "consumer";
}

// ───────────────────────────────────────────────────────────────────
// F · Recent overrides (DC-K4 surfaces)
// ───────────────────────────────────────────────────────────────────

export type OverrideEvent = {
  kind: "skip" | "movement_swap" | "manual_end" | "custom";
  occurredAt: string; // ISO timestamp
  /** Short headline describing what was overridden. */
  what: string;
  /** What the user actually did, if different from the recommendation. */
  did: string;
  /** Optional user-entered reason (free-form note). */
  note: string | null;
};

const WEEKDAY_LONG: Record<number, string> = {
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
  7: "Sunday",
};

const ARCHETYPE_DISPLAY: Record<string, string> = {
  hypertrophy_focus: "Hypertrophy Focus",
  strength_anchor: "Strength Focus",
  hybrid_focus: "Hybrid Focus",
  resilience_focus: "Resilience Focus",
  maintenance: "Maintenance",
};

function describeArchetype(slug: string | undefined): string {
  if (!slug) return "block";
  return ARCHETYPE_DISPLAY[slug] ?? slug;
}

function describeWeekday(weekday: number | undefined): string {
  if (!weekday) return "";
  return WEEKDAY_LONG[weekday] ?? "";
}

/**
 * Last N override events from `engine_override_events` (DC-K4 audit
 * log), newest-first. Reads the dedicated audit table introduced in
 * migration 0028 — the prior implementation joined live data from
 * `planned_sessions.skipped_at` + `prescription.items[].meta.swappedFrom`
 * and had no place for the user's free-form reason. The legacy data
 * paths still write their own fields; this table is the analytics
 * surface.
 *
 * Returns `{ notTracked: true, events: [] }` when the user has no
 * recorded overrides yet (cold start).
 */
export async function getRecentOverrides(
  supabase: SupabaseClient,
  userId: string,
  limit = 10,
): Promise<{ events: OverrideEvent[]; notTracked: boolean }> {
  const { data } = await supabase
    .from("engine_override_events")
    .select(
      "occurred_at, event_type, original_movement_slug, new_movement_slug, reason, context",
    )
    .eq("user_id", userId)
    .order("occurred_at", { ascending: false })
    .limit(limit);

  const events: OverrideEvent[] = (data ?? []).map((r) => {
    const ctx = (r.context as
      | {
          archetype?: string;
          weekday?: number;
          weeksCompleted?: number;
          weeks?: number;
          percentThrough?: number;
        }
      | null) ?? null;
    const weekday = describeWeekday(ctx?.weekday);
    const archetypeLabel = describeArchetype(ctx?.archetype);
    const reason = (r.reason as string | null) ?? null;
    switch (r.event_type as string) {
      case "skip": {
        const where = weekday ? ` (${weekday})` : "";
        return {
          kind: "skip" as const,
          occurredAt: r.occurred_at as string,
          what: `Skipped ${archetypeLabel} day${where}`,
          did: "Marked the planned session as skipped.",
          note: reason,
        };
      }
      case "swap": {
        const orig = (r.original_movement_slug as string | null) ?? "previous movement";
        const next = (r.new_movement_slug as string | null) ?? "another movement";
        const where = weekday ? ` on ${weekday}` : "";
        return {
          kind: "movement_swap" as const,
          occurredAt: r.occurred_at as string,
          what: `Swapped ${prettySlug(orig)} → ${prettySlug(next)}${where}`,
          did: `Replaced the prescribed movement mid-session.`,
          note: reason,
        };
      }
      case "manual_end": {
        const wc = ctx?.weeksCompleted;
        const wk = ctx?.weeks;
        const progress =
          typeof wc === "number" && typeof wk === "number"
            ? ` (week ${wc} of ${wk})`
            : "";
        return {
          kind: "manual_end" as const,
          occurredAt: r.occurred_at as string,
          what: `Ended ${archetypeLabel} early${progress}`,
          did: "Pressed End block before the planner auto-completed it.",
          note: reason,
        };
      }
      default:
        return {
          kind: "custom" as const,
          occurredAt: r.occurred_at as string,
          what: "Custom override",
          did: "Recorded a manual override.",
          note: reason,
        };
    }
  });

  return { events, notTracked: events.length === 0 };
}

function prettySlug(slug: string): string {
  return slug
    .split("-")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

// ───────────────────────────────────────────────────────────────────
// G · Engine internals
// ───────────────────────────────────────────────────────────────────

export type EngineInternals = {
  engineVersion: string;
  lastRegionStateAt: string | null;
  regionsTracked: number;
};

export async function getEngineInternals(
  supabase: SupabaseClient,
  userId: string,
): Promise<EngineInternals> {
  const { data } = await supabase
    .from("region_state")
    .select("region, updated_at")
    .eq("user_id", userId);
  let latest: string | null = null;
  for (const r of data ?? []) {
    const at = r.updated_at as string | null;
    if (at && (!latest || at > latest)) latest = at;
  }
  return {
    engineVersion: ENGINE_VERSION,
    lastRegionStateAt: latest,
    regionsTracked: (data ?? []).length,
  };
}
