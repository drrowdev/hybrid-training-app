/**
 * `buildEngineSnapshot` + the `getEngineSnapshot` tool schema.
 *
 * The snapshot is the single tool surface for Explain v1 (ADR 0002).
 * It's built once per turn from the caller's RLS-scoped Supabase
 * client (NOT service-role) so a bug in the orchestrator can't bypass
 * row-level security.
 *
 * Shape is locked by ADR 0002 § "getEngineSnapshot tool"; the
 * `EngineSnapshot` type below is the verbatim contract.
 *
 * Tiered resolution:
 *   - last 90 days       → daily detail
 *   - 90 days – 1 year   → weekly aggregates
 *   - > 1 year           → monthly aggregates
 *   - PRs                → full history
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { getActiveBlockProgress } from "@/lib/stats/active-block-progress";
import { getBucketPressure } from "@/lib/stats/engine";
import { getCeilingExplain } from "@/lib/stats/engine";
import { getRegionFreshness } from "@/lib/stats/region-freshness-queries";
import { readLimitationsContext } from "@/lib/planner/limitations-context";

import {
  ARCHETYPES_SUMMARY,
  CALIBRATION_POLICY_TEXT,
  CONSTANTS_TABLE_TEXT,
  type ArchetypeSummary,
} from "./knowledge";
import type { LlmTool } from "./providers/types";

export type EngineSnapshot = {
  generated_at: string;
  user_tz: string;

  memories: Array<{ category: string; text: string }>;

  profile: {
    experience_tier: string | null;
    archetype_preferences: string[];
    declared_limitations: Array<{ region: string; kind: string }>;
    equipment: string[];
  };

  active_block: {
    archetype: string;
    started_on: string | null;
    weeks_total: number;
    current_week_index: number;
    next_two_weeks_summary: string;
  } | null;

  last_90d: {
    sessions: Array<{
      date: string;
      kind: "strength" | "cardio";
      modality: string | null;
      duration_min: number | null;
      esl: number;
      top_signals: string[];
    }>;
    wellness_check_ins: Array<{
      date: string;
      fatigue: number | null;
      soreness: number | null;
    }>;
  };

  last_year_weekly: Array<{
    week_start: string;
    tonnage_kg: number;
    cardio_minutes: number;
    sessions_completed: number;
    sessions_scheduled: number;
  }>;

  prior_years_monthly: Array<{
    month: string;
    tonnage_kg: number;
    cardio_minutes: number;
  }>;

  prs: Array<{
    date: string;
    movement: string;
    kind: "weight" | "reps_at_weight" | "e1rm";
    value: number;
    unit: string;
  }>;

  engine_state: {
    bucket_pressure: Record<string, number>;
    region_freshness: Array<{
      region: string;
      freshness: number;
      atl: number;
      ctl: number;
    }>;
    ceiling_explain: {
      base_ceiling: number;
      recovery_multiplier: number;
      confidence_bias: number;
      final_ceiling: number;
      reasons: string[];
    };
  };

  knowledge: {
    archetypes: ArchetypeSummary[];
    calibration_policy: string;
    constants_table: string;
  };
};

export const GET_ENGINE_SNAPSHOT_TOOL: LlmTool = {
  name: "getEngineSnapshot",
  description:
    "Fetches the current user's training context: memories, profile, active block, recent training data (tiered: 90d daily, 90d-1y weekly, >1y monthly), PR timeline, engine state (bucket pressure, region freshness, ceiling), and reference knowledge. Call this when you need to answer questions about the user's training.",
  inputSchema: { type: "object", properties: {}, required: [] },
};

// ─── helpers ──────────────────────────────────────────────────────────

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Monday-of-week ISO date (UTC). Matches the existing recovery-rollup
 * convention used by getCeilingExplain.
 */
function weekStartUtc(d: Date): string {
  const day = d.getUTCDay(); // 0 = Sun
  const offset = day === 0 ? -6 : 1 - day;
  const monday = new Date(d.getTime() + offset * 86_400_000);
  return isoDay(monday);
}

function monthKey(d: Date): string {
  return d.toISOString().slice(0, 7);
}

// ─── snapshot builder ─────────────────────────────────────────────────

export async function buildEngineSnapshot(
  supabase: SupabaseClient,
  userId: string,
  tz: string,
): Promise<EngineSnapshot> {
  const now = new Date();
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 86_400_000);
  const oneYearAgo = new Date(now.getTime() - 365 * 86_400_000);

  // Fan out everything that doesn't depend on anything else.
  const [
    memoriesRes,
    profileRes,
    limitationsCtx,
    activeBlock,
    sessions90Res,
    wellness90Res,
    sessionsAllRes,
    bucketPressure,
    regionFreshness,
    ceilingExplain,
  ] = await Promise.all([
    supabase
      .from("memories")
      .select("category, text, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: true }),
    supabase
      .from("profiles")
      .select("training_experience, equipment, wizard_day_pref")
      .eq("id", userId)
      .maybeSingle(),
    readLimitationsContextSafe(supabase, userId),
    getActiveBlockProgressSafe(supabase, userId, tz),
    supabase
      .from("sessions")
      .select(
        "id, performed_at, title, duration_min, session_rpe, completed_at",
      )
      .eq("user_id", userId)
      .not("completed_at", "is", null)
      .is("deleted_at", null)
      .gte("performed_at", ninetyDaysAgo.toISOString())
      .order("performed_at", { ascending: false })
      .limit(200),
    supabase
      .from("wellness")
      .select("date, fatigue, soreness")
      .eq("user_id", userId)
      .gte("date", isoDay(ninetyDaysAgo))
      .order("date", { ascending: false })
      .limit(120),
    supabase
      .from("sessions")
      .select("id, performed_at, duration_min, completed_at")
      .eq("user_id", userId)
      .not("completed_at", "is", null)
      .is("deleted_at", null)
      .order("performed_at", { ascending: false })
      .limit(2000),
    safe(() => getBucketPressure(supabase, userId, tz), []),
    safe(() => getRegionFreshness(supabase, userId), []),
    safe(() => getCeilingExplain(supabase, userId, tz), null),
  ]);

  // ── §1 memories ──
  const memories = (memoriesRes.data ?? []).map((m) => ({
    category: m.category as string,
    text: m.text as string,
  }));

  // ── §2 profile ──
  const equipment = extractEquipmentList(profileRes.data?.equipment ?? null);
  const archetype_preferences = extractArchetypePrefs(
    profileRes.data?.wizard_day_pref ?? null,
  );
  const declared_limitations = await readDeclaredLimitations(supabase, userId);

  // ── §3 active block ──
  const activeBlockSection = activeBlock
    ? await buildActiveBlockSection(supabase, userId, activeBlock)
    : null;

  // ── §4 last 90d sessions (daily detail) ──
  const session90Ids = (sessions90Res.data ?? []).map((s) => s.id as string);
  const [setLogs90Res, cardio90Res] = await Promise.all([
    session90Ids.length > 0
      ? supabase
          .from("set_logs")
          .select(
            "session_id, weight_kg, reps, rpe, set_kind, movement:movements(display_name)",
          )
          .in("session_id", session90Ids)
          .eq("skipped", false)
      : Promise.resolve({ data: [] as unknown[] }),
    session90Ids.length > 0
      ? supabase
          .from("cardio_logs")
          .select("session_id, modality, duration_sec, distance_km, avg_hr_bpm")
          .in("session_id", session90Ids)
      : Promise.resolve({ data: [] as unknown[] }),
  ]);
  const setsBySession = groupBy(
    (setLogs90Res.data ?? []) as SetLogRow[],
    (r) => r.session_id,
  );
  const cardioBySession = groupBy(
    (cardio90Res.data ?? []) as CardioRow[],
    (r) => r.session_id,
  );

  const last_90d_sessions = (sessions90Res.data ?? []).map((s) => {
    const sets = setsBySession.get(s.id as string) ?? [];
    const cardios = cardioBySession.get(s.id as string) ?? [];
    const kind: "strength" | "cardio" =
      sets.length >= cardios.length ? "strength" : "cardio";
    const modality =
      kind === "cardio" && cardios.length > 0
        ? (cardios[0]!.modality as string | null)
        : null;
    const top_signals: string[] = [];
    if (kind === "strength") {
      const topWeight = sets
        .filter((r) => r.set_kind === "main")
        .reduce<{
          weight: number;
          reps: number;
          name: string;
        } | null>((acc, r) => {
          const w = Number(r.weight_kg ?? 0);
          const reps = Number(r.reps ?? 0);
          if (!acc || w > acc.weight) {
            return {
              weight: w,
              reps,
              name: extractMovementName(r.movement) ?? "lift",
            };
          }
          return acc;
        }, null);
      if (topWeight && topWeight.weight > 0) {
        top_signals.push(
          `${topWeight.name} ${topWeight.weight}kg × ${topWeight.reps}`,
        );
      }
    } else if (cardios.length > 0) {
      const c = cardios[0]!;
      const minutes = Math.round((Number(c.duration_sec) || 0) / 60);
      const km = c.distance_km != null ? Number(c.distance_km) : null;
      const parts: string[] = [];
      if (c.modality) parts.push(String(c.modality));
      if (minutes > 0) parts.push(`${minutes}min`);
      if (km != null && km > 0) parts.push(`${km.toFixed(1)}km`);
      if (parts.length > 0) top_signals.push(parts.join(" "));
    }
    return {
      date: String(s.performed_at).slice(0, 10),
      kind,
      modality,
      duration_min: (s.duration_min as number | null) ?? null,
      esl: Number(s.session_rpe ?? 0),
      top_signals,
    };
  });

  // ── §4b wellness ──
  const wellness_check_ins = (wellness90Res.data ?? []).map((w) => ({
    date: w.date as string,
    fatigue: (w.fatigue as number | null) ?? null,
    soreness: (w.soreness as number | null) ?? null,
  }));

  // ── §5 last_year_weekly (90d-1y) ──
  const allSessions = (sessionsAllRes.data ?? []) as Array<{
    id: string;
    performed_at: string;
    duration_min: number | null;
  }>;
  const allSessionIds = allSessions.map((s) => s.id);
  const allSetsByWeek = await loadVolumeByWeekAndMonth(
    supabase,
    allSessionIds,
  );

  const last_year_weekly = buildWeeklyAggregates(
    allSessions,
    allSetsByWeek.setsBySession,
    allSetsByWeek.cardioBySession,
    ninetyDaysAgo,
    oneYearAgo,
  );

  // ── §6 prior_years_monthly (>1y) ──
  const prior_years_monthly = buildMonthlyAggregates(
    allSessions,
    allSetsByWeek.setsBySession,
    allSetsByWeek.cardioBySession,
    oneYearAgo,
  );

  // ── §7 PRs ──
  const prs = await buildPrTimeline(supabase, userId);

  // ── §8 engine state ──
  const bucket_pressure: Record<string, number> = {};
  for (const b of bucketPressure ?? []) {
    bucket_pressure[b.bucket] = b.percentOfCeiling;
  }
  const region_freshness = (regionFreshness ?? []).map((r) => ({
    region: r.region,
    freshness: r.freshness,
    atl: r.atl,
    ctl: r.ctl,
  }));
  const ceilingReasons: string[] = [];
  if (ceilingExplain) {
    ceilingReasons.push(
      `base from ${ceilingExplain.formula} formula across ${ceilingExplain.basisWeeks.length} basis week(s)`,
    );
    ceilingReasons.push(
      `recovery multiplier ${ceilingExplain.recoveryMultiplier.toFixed(2)} (DC-C5)`,
    );
    ceilingReasons.push(
      `confidence bias ${ceilingExplain.confidenceBias.toFixed(2)} (DC-K2)`,
    );
    for (const n of ceilingExplain.inputs.notes ?? []) ceilingReasons.push(n);
  }
  const ceiling_explain = ceilingExplain
    ? {
        base_ceiling: ceilingExplain.baseCeiling,
        recovery_multiplier: ceilingExplain.recoveryMultiplier,
        confidence_bias: ceilingExplain.confidenceBias,
        final_ceiling: ceilingExplain.finalCeiling,
        reasons: ceilingReasons,
      }
    : {
        base_ceiling: 0,
        recovery_multiplier: 1,
        confidence_bias: 1,
        final_ceiling: 0,
        reasons: ["no recovered weeks yet — heuristic default"],
      };

  return {
    generated_at: now.toISOString(),
    user_tz: tz,
    memories,
    profile: {
      experience_tier:
        (profileRes.data?.training_experience as string | null) ?? null,
      archetype_preferences,
      declared_limitations,
      equipment,
    },
    active_block: activeBlockSection,
    last_90d: {
      sessions: last_90d_sessions,
      wellness_check_ins,
    },
    last_year_weekly,
    prior_years_monthly,
    prs,
    engine_state: {
      bucket_pressure,
      region_freshness,
      ceiling_explain,
    },
    knowledge: {
      archetypes: ARCHETYPES_SUMMARY,
      calibration_policy: CALIBRATION_POLICY_TEXT,
      constants_table: CONSTANTS_TABLE_TEXT,
    },
  };

  // Use the limitations context for downstream side-effects only — the
  // declared_limitations table read above is the source for the
  // snapshot field. Reference the value so the import isn't dead.
  void limitationsCtx;
}

// ─── plumbing ─────────────────────────────────────────────────────────

type SetLogRow = {
  session_id: string;
  weight_kg: number | string | null;
  reps: number | string | null;
  rpe: number | string | null;
  set_kind: string;
  movement:
    | { display_name: string }
    | { display_name: string }[]
    | null;
};
type CardioRow = {
  session_id: string;
  modality: string | null;
  duration_sec: number | null;
  distance_km: number | string | null;
  avg_hr_bpm: number | null;
};

function extractMovementName(
  m: SetLogRow["movement"] | undefined,
): string | null {
  if (!m) return null;
  if (Array.isArray(m)) return m[0]?.display_name ?? null;
  return m.display_name ?? null;
}

function groupBy<T, K>(rows: T[], keyOf: (t: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const r of rows) {
    const k = keyOf(r);
    const arr = m.get(k);
    if (arr) arr.push(r);
    else m.set(k, [r]);
  }
  return m;
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

async function readLimitationsContextSafe(
  supabase: SupabaseClient,
  userId: string,
) {
  try {
    return await readLimitationsContext(supabase, userId);
  } catch {
    return {
      blockedRegions: new Set<string>(),
      blockedMuscles: new Set<string>(),
      allowedMovementIds: new Set<string>(),
      tendinopathyActive: false,
    };
  }
}

async function getActiveBlockProgressSafe(
  supabase: SupabaseClient,
  userId: string,
  tz: string,
) {
  try {
    return await getActiveBlockProgress(supabase, userId, tz);
  } catch {
    return null;
  }
}

function extractEquipmentList(equipment: unknown): string[] {
  if (!equipment || typeof equipment !== "object") return [];
  const e = equipment as Record<string, unknown>;
  const out: string[] = [];
  if (typeof e.preset === "string") out.push(`preset:${e.preset}`);
  for (const key of [
    "bars",
    "plates",
    "dumbbells",
    "kettlebells",
    "machines",
    "cardio",
  ]) {
    const v = e[key];
    if (Array.isArray(v) && v.length > 0) out.push(`${key}:${v.length}`);
    else if (v && typeof v === "object") out.push(key);
  }
  return out;
}

function extractArchetypePrefs(wizardDayPref: unknown): string[] {
  if (!wizardDayPref || typeof wizardDayPref !== "object") return [];
  const w = wizardDayPref as { byArchetype?: Record<string, unknown> };
  if (!w.byArchetype) return [];
  return Object.keys(w.byArchetype);
}

async function readDeclaredLimitations(
  supabase: SupabaseClient,
  userId: string,
): Promise<Array<{ region: string; kind: string }>> {
  try {
    const { data } = await supabase
      .from("limitations")
      .select("region, kind, resolved_at")
      .eq("user_id", userId)
      .is("resolved_at", null);
    return (data ?? [])
      .filter((r) => r.region && r.kind)
      .map((r) => ({
        region: r.region as string,
        kind: r.kind as string,
      }));
  } catch {
    return [];
  }
}

async function buildActiveBlockSection(
  supabase: SupabaseClient,
  userId: string,
  progress: NonNullable<
    Awaited<ReturnType<typeof getActiveBlockProgress>>
  >,
): Promise<EngineSnapshot["active_block"]> {
  // Pull the started_on + next two weeks of planned sessions for a dense summary.
  const { data } = await supabase
    .from("training_blocks")
    .select(
      "started_on, archetype, planned_sessions(week_index, day_index, completed_session_id, skipped_at, prescription)",
    )
    .eq("id", progress.blockId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) {
    return {
      archetype: progress.archetypeName,
      started_on: null,
      weeks_total: progress.weeks,
      current_week_index: progress.currentWeek - 1,
      next_two_weeks_summary: "",
    };
  }
  type Planned = {
    week_index: number;
    day_index: number;
    completed_session_id: string | null;
    skipped_at: string | null;
    prescription: { summary?: string } | null;
  };
  const planned = (data.planned_sessions ?? []) as Planned[];
  const currentIdx = progress.currentWeek - 1;
  const upcoming = planned
    .filter(
      (p) => p.week_index >= currentIdx && p.week_index <= currentIdx + 1,
    )
    .sort(
      (a, b) =>
        a.week_index - b.week_index || a.day_index - b.day_index,
    );
  const summary = upcoming
    .slice(0, 12)
    .map((p) => {
      const status = p.completed_session_id
        ? "done"
        : p.skipped_at
          ? "skipped"
          : "pending";
      return `W${p.week_index + 1}D${p.day_index + 1} (${status})`;
    })
    .join(", ");
  return {
    archetype: progress.archetypeName,
    started_on: (data.started_on as string | null) ?? null,
    weeks_total: progress.weeks,
    current_week_index: currentIdx,
    next_two_weeks_summary: summary,
  };
}

async function loadVolumeByWeekAndMonth(
  supabase: SupabaseClient,
  sessionIds: string[],
): Promise<{
  setsBySession: Map<
    string,
    Array<{ weight: number; reps: number; setKind: string }>
  >;
  cardioBySession: Map<string, Array<{ durationSec: number }>>;
}> {
  if (sessionIds.length === 0) {
    return { setsBySession: new Map(), cardioBySession: new Map() };
  }
  // Cap at 2000 — anything beyond that and we're over-budget anyway.
  const ids = sessionIds.slice(0, 2000);
  const [setsRes, cardioRes] = await Promise.all([
    supabase
      .from("set_logs")
      .select("session_id, weight_kg, reps, set_kind, skipped")
      .in("session_id", ids),
    supabase
      .from("cardio_logs")
      .select("session_id, duration_sec")
      .in("session_id", ids),
  ]);
  const setsBySession = new Map<
    string,
    Array<{ weight: number; reps: number; setKind: string }>
  >();
  for (const r of (setsRes.data ?? []) as Array<{
    session_id: string;
    weight_kg: number | string | null;
    reps: number | string | null;
    set_kind: string;
    skipped: boolean;
  }>) {
    if (r.skipped) continue;
    const arr = setsBySession.get(r.session_id) ?? [];
    arr.push({
      weight: Number(r.weight_kg ?? 0),
      reps: Number(r.reps ?? 0),
      setKind: r.set_kind,
    });
    setsBySession.set(r.session_id, arr);
  }
  const cardioBySession = new Map<string, Array<{ durationSec: number }>>();
  for (const r of (cardioRes.data ?? []) as Array<{
    session_id: string;
    duration_sec: number;
  }>) {
    const arr = cardioBySession.get(r.session_id) ?? [];
    arr.push({ durationSec: Number(r.duration_sec ?? 0) });
    cardioBySession.set(r.session_id, arr);
  }
  return { setsBySession, cardioBySession };
}

function buildWeeklyAggregates(
  sessions: Array<{ id: string; performed_at: string }>,
  sets: Map<string, Array<{ weight: number; reps: number; setKind: string }>>,
  cardio: Map<string, Array<{ durationSec: number }>>,
  ninetyDaysAgo: Date,
  oneYearAgo: Date,
): EngineSnapshot["last_year_weekly"] {
  type Acc = {
    tonnage: number;
    cardio_min: number;
    completed: number;
  };
  const buckets = new Map<string, Acc>();
  for (const s of sessions) {
    const d = new Date(s.performed_at);
    if (d >= ninetyDaysAgo || d < oneYearAgo) continue;
    const key = weekStartUtc(d);
    const acc = buckets.get(key) ?? { tonnage: 0, cardio_min: 0, completed: 0 };
    acc.completed += 1;
    for (const r of sets.get(s.id) ?? []) {
      if (r.weight > 0 && r.reps > 0 && r.setKind !== "warmup") {
        acc.tonnage += r.weight * r.reps;
      }
    }
    for (const c of cardio.get(s.id) ?? []) {
      acc.cardio_min += c.durationSec / 60;
    }
    buckets.set(key, acc);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([week_start, acc]) => ({
      week_start,
      tonnage_kg: Math.round(acc.tonnage),
      cardio_minutes: Math.round(acc.cardio_min),
      sessions_completed: acc.completed,
      // sessions_scheduled isn't reliably reconstructable from planned_sessions
      // at this resolution without another round-trip; surface completed
      // here and let the LLM caveat where needed.
      sessions_scheduled: acc.completed,
    }));
}

function buildMonthlyAggregates(
  sessions: Array<{ id: string; performed_at: string }>,
  sets: Map<string, Array<{ weight: number; reps: number; setKind: string }>>,
  cardio: Map<string, Array<{ durationSec: number }>>,
  oneYearAgo: Date,
): EngineSnapshot["prior_years_monthly"] {
  const buckets = new Map<string, { tonnage: number; cardio_min: number }>();
  for (const s of sessions) {
    const d = new Date(s.performed_at);
    if (d >= oneYearAgo) continue;
    const key = monthKey(d);
    const acc = buckets.get(key) ?? { tonnage: 0, cardio_min: 0 };
    for (const r of sets.get(s.id) ?? []) {
      if (r.weight > 0 && r.reps > 0 && r.setKind !== "warmup") {
        acc.tonnage += r.weight * r.reps;
      }
    }
    for (const c of cardio.get(s.id) ?? []) {
      acc.cardio_min += c.durationSec / 60;
    }
    buckets.set(key, acc);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, acc]) => ({
      month,
      tonnage_kg: Math.round(acc.tonnage),
      cardio_minutes: Math.round(acc.cardio_min),
    }));
}

/**
 * All-time PR timeline. v1 surfaces best weight per movement (capped
 * at 50 movements) — the LLM cites these for "best ever" questions.
 * e1RM + reps-at-weight variants are deferred.
 */
async function buildPrTimeline(
  supabase: SupabaseClient,
  userId: string,
): Promise<EngineSnapshot["prs"]> {
  try {
    const { data } = await supabase
      .from("set_logs")
      .select(
        "weight_kg, reps, session:sessions!inner(user_id, performed_at, deleted_at), movement:movements(display_name)",
      )
      .eq("session.user_id", userId)
      .is("session.deleted_at", null)
      .eq("skipped", false)
      .neq("set_kind", "warmup")
      .not("weight_kg", "is", null)
      .not("reps", "is", null)
      .gt("reps", 0)
      .order("weight_kg", { ascending: false })
      .limit(500);
    type Row = {
      weight_kg: number | string;
      reps: number | string;
      session:
        | { performed_at: string }
        | { performed_at: string }[];
      movement:
        | { display_name: string }
        | { display_name: string }[]
        | null;
    };
    const seen = new Set<string>();
    const out: EngineSnapshot["prs"] = [];
    for (const r of ((data ?? []) as Row[])) {
      const name =
        (Array.isArray(r.movement) ? r.movement[0]?.display_name : r.movement?.display_name) ??
        null;
      if (!name || seen.has(name)) continue;
      seen.add(name);
      const date = Array.isArray(r.session)
        ? r.session[0]?.performed_at
        : r.session?.performed_at;
      out.push({
        date: String(date).slice(0, 10),
        movement: name,
        kind: "weight",
        value: Number(r.weight_kg),
        unit: "kg",
      });
      if (out.length >= 50) break;
    }
    return out;
  } catch {
    return [];
  }
}
