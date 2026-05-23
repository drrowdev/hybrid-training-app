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
 * Per-region 14-day freshness history derived from set_logs.
 *
 * The engine persists only the *current* ATL/CTL per region in
 * `region_state` (DC-C14). To draw a 14-day timeline we re-walk the
 * last 35 days of completed-session set data and apply the EWMA
 * recurrence day-by-day, then slice the last 14 entries. Cost is the
 * same order as `region-ledger.recomputeRegionState`, bounded by the
 * lookback window.
 */
export async function getRegionFreshnessDetail(
  supabase: SupabaseClient,
  userId: string,
  tz: string,
): Promise<RegionFreshnessDetail[]> {
  const sinceIso = new Date(Date.now() - HISTORY_LOOKBACK_DAYS * 86_400_000).toISOString();

  const [{ data: regionStateRows }, { data: sessions }] = await Promise.all([
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

  const baselineByRegion = new Map<Region, number>();
  const lastLoadByRegion = new Map<Region, string | null>();
  for (const r of regionStateRows ?? []) {
    baselineByRegion.set(r.region as Region, Number(r.baseline_tolerance ?? 0));
    lastLoadByRegion.set(r.region as Region, (r.last_load_date as string | null) ?? null);
  }

  // Per-day per-region load series.
  const dailyByRegion: Record<Region, Map<string, number>> = Object.fromEntries(
    ALL_REGIONS.map((r) => [r, new Map<string, number>()]),
  ) as Record<Region, Map<string, number>>;

  if (sessions && sessions.length > 0) {
    const sessionIds = sessions.map((s) => s.id);
    const performedAtById = new Map(sessions.map((s) => [s.id, s.performed_at as string]));
    const { data: sets } = await supabase
      .from("set_logs")
      .select(
        "session_id, weight_kg, reps, rpe, set_kind, movement:movements(primary_region, secondary_regions)",
      )
      .in("session_id", sessionIds)
      .not("reps", "is", null)
      .gt("reps", 0);

    for (const row of sets ?? []) {
      if (row.set_kind === "warmup") continue;
      const performedAt = performedAtById.get(row.session_id);
      if (!performedAt) continue;
      const date = performedAt.slice(0, 10);
      const movement = normaliseMovement(row.movement);
      if (!movement) continue;
      const reps = Number(row.reps);
      const weight = Number(row.weight_kg ?? 0);
      const rpe = row.rpe == null ? 7 : Number(row.rpe);
      if (reps <= 0 || weight <= 0) continue;
      // Approximate per-set kg-load = reps × weight × rpe-factor; same
      // shape as region-ledger so the EWMA scale lines up.
      const setLoad = reps * weight * Math.max(0.3, Math.min(1.0, rpe / 10));
      const primary = movement.primary_region as Region;
      if (ALL_REGIONS.includes(primary)) {
        const prev = dailyByRegion[primary].get(date) ?? 0;
        dailyByRegion[primary].set(date, prev + setLoad);
      }
      if (Array.isArray(movement.secondary_regions)) {
        for (const r of movement.secondary_regions as string[]) {
          const region = r as Region;
          if (ALL_REGIONS.includes(region)) {
            const prev = dailyByRegion[region].get(date) ?? 0;
            dailyByRegion[region].set(date, prev + setLoad * 0.5);
          }
        }
      }
    }
  }

  // Walk the calendar and emit a 14-day freshness history per region.
  const today = todayYmdFn(tz);
  const windowStart = addDaysToYmd(today, -(HISTORY_WINDOW_DAYS - 1));

  const out: RegionFreshnessDetail[] = [];
  for (const region of ALL_REGIONS) {
    const series = dailyByRegion[region];
    const baseline = baselineByRegion.get(region) ?? 0;
    if (baseline <= 0 && series.size === 0) {
      // Empty — skip the region from output. The page renders an
      // "untouched" badge in this case.
      continue;
    }
    // Apply EWMA across the full lookback window so the windowStart
    // value isn't biased by missing earlier history.
    let atl = 0;
    const history: number[] = [];
    const start = new Date(Date.now() - HISTORY_LOOKBACK_DAYS * 86_400_000)
      .toISOString()
      .slice(0, 10);
    for (let cursor = start; cursor <= today; cursor = addDaysToYmd(cursor, 1)) {
      const load = series.get(cursor) ?? 0;
      atl = ewmaStep(atl, load, 7);
      if (cursor >= windowStart) {
        history.push(computeRegionFreshness(atl, baseline > 0 ? baseline : Math.max(atl, 1)));
      }
    }
    const currentFreshness = history.length > 0 ? history[history.length - 1]! : 1;

    // Hard-set counts for the 7d / 14d / 28d windows.
    const setCounts = countSetsInWindows(series, today);
    out.push({
      region,
      label: REGION_LABELS[region] ?? region,
      currentFreshness,
      lastLoadDate: lastLoadByRegion.get(region) ?? null,
      history,
      setCounts,
    });
  }

  out.sort((a, b) => a.currentFreshness - b.currentFreshness);
  return out;
}

function countSetsInWindows(
  series: Map<string, number>,
  today: string,
): { d7: number; d14: number; d28: number } {
  // The series stores load magnitude per day, not set count. We
  // approximate "sets accumulated" via the *number of days with any
  // load* (proxy useful for the user-facing 7d/14d/28d label).
  // Cheaper than re-querying set_logs.
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

type MovementRefs = {
  primary_region: string;
  secondary_regions: unknown;
};

function normaliseMovement(m: unknown): MovementRefs | null {
  if (!m) return null;
  if (Array.isArray(m)) {
    const first = m[0];
    return (first as MovementRefs) ?? null;
  }
  return m as MovementRefs;
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
    why: "Neural pressure = 7-day EWMA of heavy-load contributions / 28-day chronic norm. Drives the GRM via DC-C5.",
  },
  mechanical: {
    label: "Muscle work",
    description: "Total tonnage — how much pure volume you've moved.",
    why: "Mechanical pressure = sets × reps × weight × RPE summed daily, EWMA'd. Anchors the DC-M1 MEV/MAV landmarks.",
  },
  metabolic: {
    label: "Conditioning",
    description: "Lactate / breathing — hard cardio and high-rep work.",
    why: "Metabolic pressure rises with high-rep sets and hard cardio. Pushes interference modifier per DC-C7.",
  },
  impact: {
    label: "Pounding",
    description: "Running, plyo, heavy eccentrics — joints and connective tissue.",
    why: "Impact pressure tracks running + high-strain-tendon work. Caps explosive doses per DC-C8 / DC-D5.",
  },
  axial: {
    label: "Spinal load",
    description: "Squats, deadlifts, OHP, loaded carries — back can only take so much.",
    why: "Axial pressure is the lumbar/trunk compression accumulator. Pinned at moderate weight in DC-A3.",
  },
  tissue: {
    label: "Tendons",
    description: "Tendons remodel slowly — very-heavy lifts and running add up.",
    why: "Tendon pressure tracks high-strain-tendon exposures. Used for DC-D5 plyo gating + DC-V2 soft block.",
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
// D · Ceiling explainer (DC-C11 + DC-C13)
// ───────────────────────────────────────────────────────────────────

export type CeilingExplain = {
  /** Median dose of the last 3 recovered weeks (DC-C9). MVP proxy: hard sessions/week. */
  baseCeiling: number;
  /** Global recovery multiplier — DC-C5. MVP proxy: 1.0 (no daily wellness inputs). */
  recoveryMultiplier: number;
  /** Confidence bias — DC-C13. */
  confidenceBias: number;
  /** Final ceiling for the week, in "hard sessions worth of stress". */
  finalCeiling: number;
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
  const since28d = new Date(Date.now() - 28 * 86_400_000).toISOString();
  const { count: completed28d } = await supabase
    .from("sessions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .not("completed_at", "is", null)
    .is("deleted_at", null)
    .gte("performed_at", since28d);

  const completed = completed28d ?? 0;
  const weeklyAverage = completed / 4;
  // Base ceiling = median(last-3-recovered-weeks-dose) per DC-C9. Until
  // recovered-week tagging lands (DC-K1) we use the 28d average × 1.05
  // headroom as a conservative proxy and surface that in `notes`.
  const baseCeiling = Math.max(1, Math.round(weeklyAverage * 1.05));

  // Confidence bias — DC-C13. Data completeness = fraction of last 28
  // days with at least one completed session OR wellness entry.
  const dataCompleteness = await computeDataCompleteness(supabase, userId);
  const confidenceBias =
    dataCompleteness >= 0.8 ? 1.0 : dataCompleteness >= 0.6 ? 0.95 : 0.9;

  // GRM proxy — defaults to 1.0 until DC-C4/DC-C5 wellness inputs land.
  const recoveryMultiplier = 1.0;

  const finalCeiling = baseCeiling * recoveryMultiplier * confidenceBias;

  const notes: string[] = [];
  if (completed === 0) {
    notes.push(
      "Cold start — no completed sessions in the last 28 days. Ceiling defaults to a conservative floor (DC-C9 cold-start).",
    );
  }
  notes.push(
    "Recovery multiplier = 1.0 — daily wellness inputs (DC-P2/DC-P3) are deferred to a later phase.",
  );
  notes.push(
    `Confidence bias = ${confidenceBias.toFixed(2)} (data completeness ${(dataCompleteness * 100).toFixed(0)}%, DC-C13).`,
  );

  return {
    baseCeiling,
    recoveryMultiplier,
    confidenceBias,
    finalCeiling,
    inputs: {
      completedSessions28d: completed,
      recoveredWeeksCount: 0,
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

export type UserTier = "consumer" | "intermediate" | "high_performance";

export type UserTierState = {
  tier: UserTier;
  tierLabel: string;
  /** Behavioural-training-score (DC-G2). 0..100. Cold-start defaults to 50. */
  bts: number;
  /** True when the tier is the DC-G5 cold-start default (no behavioural signal). */
  isColdStart: boolean;
  /** Approximate number of additional completed sessions before next-tier threshold (DC-G3). */
  sessionsUntilNextTier: number | null;
  /** Plain-language description for the UI. */
  description: string;
  /** "How is this computed?" inline-doc paragraph (DC-G1/G2 narration). */
  explanation: string;
};

const TIER_LABELS: Record<UserTier, string> = {
  consumer: "Consumer",
  intermediate: "Intermediate",
  high_performance: "High-performance",
};

const TIER_THRESHOLDS = { intermediate: 50, high_performance: 75 } as const;

/**
 * MVP tier inference — pinned to the DC-G5 cold-start default until the
 * behavioural-training-score (DC-G2) lands. The behavioural signals are:
 *  - anchor compliance (weight 0.25)
 *  - session completion (weight 0.15)
 *  - completion quality, schedule regularity, recovery inputs, ...
 *
 * For Phase 6 we *do* compute a simplified BTS = session-completion-
 * fraction over the last 56 days, mapped to a 0..100 scale. This gives
 * the tier a non-trivial movement story until the full DC-G2 formula
 * is implemented.
 */
export async function getUserTier(
  supabase: SupabaseClient,
  userId: string,
): Promise<UserTierState> {
  const since = new Date(Date.now() - 56 * 86_400_000).toISOString();
  const [completedRes, plannedRes] = await Promise.all([
    supabase
      .from("sessions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .not("completed_at", "is", null)
      .is("deleted_at", null)
      .gte("performed_at", since),
    supabase
      .from("planned_sessions")
      .select("id, completed_session_id, skipped_at", { count: "exact" })
      .eq("user_id", userId)
      .gte("created_at", since),
  ]);

  const completed = completedRes.count ?? 0;
  const planned = plannedRes.data ?? [];
  const totalPlanned = planned.length;
  const loggedPlanned = planned.filter((p) => p.completed_session_id != null).length;

  // No planned sessions yet → cold-start default per DC-G5.
  const isColdStart = totalPlanned === 0;
  const completionFrac = totalPlanned > 0 ? loggedPlanned / totalPlanned : 0;
  // Engineering MVP BTS: 60 + 40 × completion. Yields:
  //   100% completion → BTS 100 (high_performance)
  //   75% completion  → BTS 90 (high_performance)
  //   50% completion  → BTS 80 (high_performance)
  //   25% completion  → BTS 70 (intermediate)
  //   0% completion   → BTS 60 (intermediate)
  // Compounded with the absolute volume floor: < 8 completed sessions in
  // 56 days → max intermediate (high-perf requires 16+ sessions = ≥2/wk).
  let bts: number;
  if (isColdStart) {
    bts = 50; // DC-G5 cold-start
  } else {
    bts = Math.round(60 + 40 * completionFrac);
    if (completed < 8) bts = Math.min(bts, TIER_THRESHOLDS.high_performance - 1);
  }

  const tier = btsToTier(bts);
  const sessionsUntilNextTier = sessionsToNextTier(tier, completed, completionFrac);

  return {
    tier,
    tierLabel: TIER_LABELS[tier],
    bts,
    isColdStart,
    sessionsUntilNextTier,
    description: describeTier(tier, completed),
    explanation:
      "Tier is inferred from behavioural signals — completion rate of planned sessions, " +
      "absolute session volume, and (when wellness logging is enabled) recovery-input " +
      "consistency. DC-G1/G2 in the design constraints. Self-report can downgrade your tier " +
      "but cannot upgrade beyond what your behaviour supports.",
  };
}

export function btsToTier(bts: number): UserTier {
  if (bts >= TIER_THRESHOLDS.high_performance) return "high_performance";
  if (bts >= TIER_THRESHOLDS.intermediate) return "intermediate";
  return "consumer";
}

function describeTier(tier: UserTier, completed: number): string {
  if (tier === "consumer") {
    return `Less than 8 completed sessions in 56 days — habits still forming.`;
  }
  if (tier === "intermediate") {
    return `${completed} completed sessions in the last 56 days. Solid baseline; engine uses moderate headroom.`;
  }
  return `${completed} completed sessions in the last 56 days. Engine permits the highest dose headroom + 2 hard cardios/week.`;
}

function sessionsToNextTier(tier: UserTier, completed: number, completionFrac: number): number | null {
  if (tier === "high_performance") return null;
  if (tier === "consumer") {
    // Target: 8 completed sessions to leave consumer.
    return Math.max(1, 8 - completed);
  }
  // Intermediate → high_performance requires BTS ≥ 75, which under our MVP
  // formula needs completionFrac ≥ 0.375 AND ≥ 16 completed sessions in 56d.
  const sessionsForVolume = Math.max(0, 16 - completed);
  const sessionsForCompletion = completionFrac >= 0.375 ? 0 : Math.max(1, Math.round((0.375 - completionFrac) * 20));
  return Math.max(sessionsForVolume, sessionsForCompletion, 1);
}

// ───────────────────────────────────────────────────────────────────
// F · Recent overrides (DC-K4 surfaces)
// ───────────────────────────────────────────────────────────────────

export type OverrideEvent = {
  kind: "skip" | "movement_swap";
  occurredAt: string; // ISO timestamp
  /** Short headline describing what was overridden. */
  what: string;
  /** What the user actually did, if different from the recommendation. */
  did: string;
  /** Optional free-form note (currently always null — schema gap). */
  note: string | null;
};

/**
 * Last 10 user overrides of engine recommendations, chronological newest-first.
 *
 * Sources we have today:
 *  - `planned_sessions.skipped_at` — DC-K4 records the skip; no separate
 *    audit log yet so we read the column directly.
 *  - `planned_sessions.prescription.items[].meta.swappedFrom` — movement
 *    swaps live in the prescription JSONB. Same source the Phase 5
 *    movement page reads from for swap history.
 *
 * Returns `{ notTracked: true, events: [] }` when the user has no
 * planned-session history (cold start).
 */
export async function getRecentOverrides(
  supabase: SupabaseClient,
  userId: string,
  limit = 10,
): Promise<{ events: OverrideEvent[]; notTracked: boolean }> {
  // Skips
  const { data: skipped } = await supabase
    .from("planned_sessions")
    .select("title, skipped_at, week_index, day_index")
    .eq("user_id", userId)
    .not("skipped_at", "is", null)
    .order("skipped_at", { ascending: false })
    .limit(limit);
  // Swaps
  const { data: swapped } = await supabase
    .from("planned_sessions")
    .select("title, prescription, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(40);

  const events: OverrideEvent[] = [];
  for (const r of skipped ?? []) {
    events.push({
      kind: "skip",
      occurredAt: r.skipped_at as string,
      what: r.title ?? "Planned session",
      did: "Skipped this session despite the engine scheduling it.",
      note: null,
    });
  }
  for (const r of swapped ?? []) {
    const items = (r.prescription as { items?: Array<{ movementName?: string; meta?: { swappedFrom?: { movementName?: string }; swappedAt?: string } }> })?.items;
    if (!Array.isArray(items)) continue;
    for (const it of items) {
      const swap = it.meta?.swappedFrom;
      const at = it.meta?.swappedAt;
      if (!swap || !at) continue;
      events.push({
        kind: "movement_swap",
        occurredAt: at,
        what: `${swap.movementName ?? "Recommended movement"} (${r.title ?? "session"})`,
        did: `Swapped to ${it.movementName ?? "another movement"}.`,
        note: null,
      });
    }
  }

  events.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));
  const trimmed = events.slice(0, limit);
  const notTracked = trimmed.length === 0;
  return { events: trimmed, notTracked };
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
