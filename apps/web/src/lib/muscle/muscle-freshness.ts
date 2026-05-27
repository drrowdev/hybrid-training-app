/**
 * Muscle freshness — the 16-muscle additive layer on top of the
 * 7-region engine model (DC-A6 / DC-C14).
 *
 * Math mirrors `apps/web/src/lib/stats/region-state-snapshot.ts`:
 *   - 35-day lookback walking `set_logs` per day.
 *   - Per-set load = reps × weight × clamp(rpe/10, 0.3..1.0).
 *   - Fan that load out to muscles using the static slug map first,
 *     falling back to `movements.primary_muscles / secondary_muscles`.
 *   - Cardio fans out the same way via `cardio_logs.modality` →
 *     CARDIO_MODALITY_MAP. Cardio "load" is duration_sec × intensity
 *     (clamp(rpe/10) or HR-derived if available); duration is divided
 *     by 60 to keep units comparable with reps × weight.
 *   - Walk EWMA(window=7) day-by-day across the lookback to produce
 *     today's ATL per muscle.
 *   - Freshness = 1 − ATL / baseline, where baseline = max(ATL ever
 *     observed in the window, 1) so a never-loaded muscle reads 1.0.
 *   - Bands: green ≥ 4 days since last loaded; yellow 2-3 days; red
 *     < 2 days; grey never loaded.
 *
 * Cache-then-live read pattern matches `getRegionFreshness`: if a
 * cached `muscle_state_history` row exists for today, use it;
 * otherwise compute live from raw logs.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeRegionFreshness, ewmaStep } from "@hta/domain";
import { todayYmd as todayYmdFn, addDaysToYmd } from "@/lib/dates";
import {
  ALL_MUSCLE_GROUPS,
  MUSCLE_LABELS,
  type MuscleGroup,
} from "./muscle-groups";
import {
  cardioFanout,
  muscleFanoutFromMovementRow,
  type MuscleWeight,
} from "./movement-muscle-map";
import {
  cardioIntensityScalar,
  normaliseHrZones,
} from "@/lib/engine/cardio-intensity";

const LOOKBACK_DAYS = 35;
const RECENCY_GREEN = 4;
const RECENCY_YELLOW = 2;

export type MuscleFreshnessBand = "fresh" | "ready" | "loaded" | "untouched";
export type MuscleFreshnessTone = "ok" | "caution" | "warn" | "neutral";

export type MuscleFreshnessRow = {
  muscle: MuscleGroup;
  muscleLabel: string;
  /** Freshness in [0,1]. 1 = fully recovered. */
  freshness: number;
  /** Days since the muscle was last loaded; null if never. */
  daysSinceLoaded: number | null;
  /** YYYY-MM-DD of the most-recent load day; null if never. */
  lastLoadDate: string | null;
  band: MuscleFreshnessBand;
  tone: MuscleFreshnessTone;
  bandLabel: string;
  /** Most-impactful recent movements/modalities — for tooltip. */
  topContributors: Array<{ name: string; date: string }>;
  atl: number;
};

/**
 * Bucket a freshness row by days-since-loaded (primary signal) with
 * the freshness score as a tiebreaker — matches the spec's colour
 * thresholds.
 */
export function classifyMuscleFreshness(args: {
  daysSinceLoaded: number | null;
  freshness: number;
}): { band: MuscleFreshnessBand; tone: MuscleFreshnessTone; bandLabel: string } {
  if (args.daysSinceLoaded == null) {
    return { band: "untouched", tone: "neutral", bandLabel: "Not yet trained" };
  }
  if (args.daysSinceLoaded >= RECENCY_GREEN) {
    return { band: "fresh", tone: "ok", bandLabel: "Fresh" };
  }
  if (args.daysSinceLoaded >= RECENCY_YELLOW) {
    return { band: "ready", tone: "caution", bandLabel: "Recovering" };
  }
  return { band: "loaded", tone: "warn", bandLabel: "Recently loaded" };
}

// ──────────────────────────────────────────────────────────────────
// Pure freshness math (testable without a DB)
// ──────────────────────────────────────────────────────────────────

export type MuscleLoadEvent = {
  /** YYYY-MM-DD. */
  date: string;
  /** Raw set/modality load before muscle weighting. */
  load: number;
  /** Per-muscle weights (primary 1.0, secondary 0.5, tertiary 0.25). */
  fanout: MuscleWeight[];
  /** Display name for tooltip ("Back squat", "Interval run", ...). */
  sourceName: string;
};

export type MuscleFreshnessComputeResult = Map<MuscleGroup, MuscleFreshnessRow>;

/**
 * Pure: walk the per-muscle daily series with EWMA and produce one
 * row per muscle. Exposed for unit tests.
 */
export function computeMuscleFreshness(
  events: MuscleLoadEvent[],
  today: string,
): MuscleFreshnessComputeResult {
  // Per-muscle daily load.
  const dailyByMuscle = new Map<MuscleGroup, Map<string, number>>();
  // Most-recent named contributors per muscle (top 3).
  const contribsByMuscle = new Map<
    MuscleGroup,
    Array<{ name: string; date: string; load: number }>
  >();
  for (const m of ALL_MUSCLE_GROUPS) {
    dailyByMuscle.set(m, new Map());
    contribsByMuscle.set(m, []);
  }

  for (const ev of events) {
    if (!ev.fanout.length || ev.load <= 0) continue;
    for (const fw of ev.fanout) {
      const series = dailyByMuscle.get(fw.muscle);
      if (!series) continue;
      const prev = series.get(ev.date) ?? 0;
      const weighted = ev.load * fw.weight;
      series.set(ev.date, prev + weighted);
      const list = contribsByMuscle.get(fw.muscle)!;
      list.push({ name: ev.sourceName, date: ev.date, load: weighted });
    }
  }

  const start = addDaysToYmd(today, -(LOOKBACK_DAYS - 1));
  const out: MuscleFreshnessComputeResult = new Map();

  for (const muscle of ALL_MUSCLE_GROUPS) {
    const series = dailyByMuscle.get(muscle)!;
    let atl = 0;
    let maxObserved = 0;
    let lastLoadDate: string | null = null;
    for (let cursor = start; cursor <= today; cursor = addDaysToYmd(cursor, 1)) {
      const load = series.get(cursor) ?? 0;
      atl = ewmaStep(atl, load, 7);
      if (load > 0) {
        lastLoadDate = cursor;
        if (atl > maxObserved) maxObserved = atl;
      }
    }
    const baseline = maxObserved > 0 ? maxObserved : Math.max(atl, 1);
    const freshness = computeRegionFreshness(atl, baseline);
    const daysSinceLoaded =
      lastLoadDate == null ? null : daysSinceYmd(lastLoadDate, today);
    const { band, tone, bandLabel } = classifyMuscleFreshness({
      daysSinceLoaded,
      freshness,
    });
    const top = (contribsByMuscle.get(muscle) ?? [])
      .sort((a, b) => (b.date.localeCompare(a.date) || b.load - a.load))
      .slice(0, 3)
      .map((c) => ({ name: c.name, date: c.date }));
    out.set(muscle, {
      muscle,
      muscleLabel: MUSCLE_LABELS[muscle],
      freshness,
      daysSinceLoaded,
      lastLoadDate,
      band,
      tone,
      bandLabel,
      topContributors: top,
      atl,
    });
  }
  return out;
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

// ──────────────────────────────────────────────────────────────────
// DB-driven derivation — mirrors deriveRegionFreshnessLive
// ──────────────────────────────────────────────────────────────────

type MovementRefs = {
  slug: string | null;
  display_name: string | null;
  primary_muscles: unknown;
  secondary_muscles: unknown;
};

function normaliseMovement(m: unknown): MovementRefs | null {
  if (!m) return null;
  if (Array.isArray(m)) return (m[0] as MovementRefs) ?? null;
  return m as MovementRefs;
}

function toStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  return [];
}

/**
 * Derive today's muscle load events live from set_logs + cardio_logs.
 *
 * Exposed for the cron and for the read path's today-fallback.
 */
export async function deriveMuscleLoadEvents(
  supabase: SupabaseClient,
  userId: string,
): Promise<MuscleLoadEvent[]> {
  const sinceIso = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();

  const { data: sessions } = await supabase
    .from("sessions")
    .select("id, performed_at")
    .eq("user_id", userId)
    .not("completed_at", "is", null)
    .is("deleted_at", null)
    .gte("performed_at", sinceIso)
    .order("performed_at", { ascending: true });

  if (!sessions || sessions.length === 0) return [];

  const sessionIds = sessions.map((s) => s.id);
  const performedAtById = new Map(
    sessions.map((s) => [s.id, s.performed_at as string]),
  );

  const [{ data: sets }, { data: cardios }] = await Promise.all([
    supabase
      .from("set_logs")
      .select(
        "session_id, weight_kg, reps, rpe, set_kind, movement:movements(slug, display_name, primary_muscles, secondary_muscles)",
      )
      .in("session_id", sessionIds)
      .not("reps", "is", null)
      .gt("reps", 0),
    supabase
      .from("cardio_logs")
      .select(
        "session_id, modality, duration_sec, rpe, hr_zones, movement:movements(slug, display_name, primary_muscles, secondary_muscles)",
      )
      .in("session_id", sessionIds),
  ]);

  const events: MuscleLoadEvent[] = [];

  for (const row of sets ?? []) {
    if (row.set_kind === "warmup") continue;
    const performedAt = performedAtById.get(row.session_id);
    if (!performedAt) continue;
    const date = performedAt.slice(0, 10);
    const movement = normaliseMovement(row.movement);
    if (!movement) continue;
    const reps = Number(row.reps);
    const weight = Number(row.weight_kg ?? 0);
    if (reps <= 0 || weight <= 0) continue;
    const rpe = row.rpe == null ? 7 : Number(row.rpe);
    const load = reps * weight * Math.max(0.3, Math.min(1.0, rpe / 10));
    const fanout = muscleFanoutFromMovementRow({
      slug: movement.slug,
      primaryMuscles: toStringArray(movement.primary_muscles),
      secondaryMuscles: toStringArray(movement.secondary_muscles),
    });
    if (fanout.length === 0) continue;
    events.push({
      date,
      load,
      fanout,
      sourceName: movement.display_name ?? movement.slug ?? "Set",
    });
  }

  for (const row of cardios ?? []) {
    const performedAt = performedAtById.get(row.session_id);
    if (!performedAt) continue;
    const date = performedAt.slice(0, 10);
    const movement = normaliseMovement(row.movement);
    const modality = (row.modality as string | null | undefined) ?? null;
    const fanout = cardioFanout(modality);
    if (fanout.length === 0) continue;
    const duration = Number(row.duration_sec ?? 0);
    if (duration <= 0) continue;
    // HR-zone weighted intensity when Strava sync populated `hr_zones`
    // (audit B2); legacy fall-back is clamp(rpe/10) so rows without HR
    // data keep their historical load values.
    const rpeRaw = row.rpe == null ? null : Number(row.rpe);
    const hrZones = normaliseHrZones((row as { hr_zones?: unknown }).hr_zones);
    const intensity = cardioIntensityScalar({
      hrZones,
      durationSec: duration,
      // Preserve the previous `rpe ?? 6` defaulting so the fall-back
      // path produces identical results to today's math for rows
      // without HR data.
      rpe: hrZones == null && rpeRaw == null ? 6 : rpeRaw,
    });
    // duration in minutes × intensity. Keeps units in the same ball
    // park as reps × weight (a 30-min Z2 ride at RPE6 ≈ 18 load
    // units, similar to one mid-weight set).
    const load = (duration / 60) * intensity;
    events.push({
      date,
      load,
      fanout,
      sourceName:
        movement?.display_name ?? humaniseModality(modality) ?? "Cardio",
    });
  }

  return events;
}

function humaniseModality(m: string | null): string | null {
  if (!m) return null;
  return m
    .split(/[_-]/g)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

// ──────────────────────────────────────────────────────────────────
// Public read path
// ──────────────────────────────────────────────────────────────────

/**
 * Read per-muscle freshness for a user.
 *
 * 1. If `muscle_state_history` has today's row for each muscle, use
 *    those cached scores (no live walk).
 * 2. Otherwise derive live from set_logs + cardio_logs.
 *
 * Always returns one row per muscle in MUSCLE_LABELS order so the
 * SVG grid can render unconditionally.
 */
export async function getMuscleFreshness(
  supabase: SupabaseClient,
  userId: string,
  opts: { tz?: string } = {},
): Promise<MuscleFreshnessRow[]> {
  const tz = opts.tz ?? "UTC";
  const today = todayYmdFn(tz);

  const { data: cached } = await supabase
    .from("muscle_state_history")
    .select("muscle, freshness_score, days_since_loaded, last_load_date, context")
    .eq("user_id", userId)
    .eq("snapshot_date", today);

  if (cached && cached.length >= ALL_MUSCLE_GROUPS.length) {
    return ALL_MUSCLE_GROUPS.map((muscle) => {
      const row = cached.find((c) => c.muscle === muscle);
      const freshness = row ? Number(row.freshness_score) : 1.0;
      const daysSinceLoaded =
        row?.days_since_loaded == null ? null : Number(row.days_since_loaded);
      const lastLoadDate = (row?.last_load_date as string | null) ?? null;
      const { band, tone, bandLabel } = classifyMuscleFreshness({
        daysSinceLoaded,
        freshness,
      });
      const ctx = (row?.context ?? {}) as { top_movements?: Array<{ name: string; date: string }> };
      return {
        muscle,
        muscleLabel: MUSCLE_LABELS[muscle],
        freshness,
        daysSinceLoaded,
        lastLoadDate,
        band,
        tone,
        bandLabel,
        topContributors: ctx.top_movements ?? [],
        atl: 0,
      };
    });
  }

  // Live fallback.
  const events = await deriveMuscleLoadEvents(supabase, userId);
  const computed = computeMuscleFreshness(events, today);
  return ALL_MUSCLE_GROUPS.map((m) => computed.get(m)!);
}
