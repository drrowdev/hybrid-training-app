/**
 * loadSessionDetail — assembles the full "why is this session programmed
 * the way it is" payload for one of the user's workout sessions.
 *
 * Read-only. Every query is pinned to `userId` (RLS defense-in-depth) and
 * never reaches for a service-role client. Backs the `getSessionDetail`
 * catalogue tool (ADR 0003) — the AI uses the compact `generationContext`
 * to SYNTHESISE an explanation rather than restate raw history.
 *
 * Resolution order:
 *   1. The session row (`sessions`), owned by the user, not soft-deleted.
 *   2. Its prescription + plan position — preferring the linked
 *      `planned_sessions` row (on-plan), falling back to the session's own
 *      `prescription` jsonb (off-plan / quick-generate).
 *   3. The parent `training_blocks` row for archetype / focus / goal.
 *   4. A compact generation-context snapshot (athlete, goal, plan phase,
 *      performance, readiness) — each sub-helper wrapped so a missing piece
 *      degrades to null instead of throwing.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Prescription,
  PrescriptionItem,
} from "@hta/db";

import { ARCHETYPES } from "@/lib/planner/archetypes";
import type { ArchetypeId } from "@/lib/planner/archetypes";
import { deloadWeekIndexFor } from "@/lib/planner/deload-skip";

export type SessionMovement = {
  kind: string;
  name: string | null;
  setsReps: string | null;
  intensity: string | null;
  why: string | null;
};

export type SessionSummary = {
  id: string;
  date: string | null;
  title: string | null;
  archetype: string | null;
  weekIndex: number | null;
  phase: string;
};

export type GenerationAthlete = {
  experience: string | null;
  equipment: string[];
  activeLimitations: string[];
  bodyweightKg: number | null;
};

export type GenerationGoal = {
  archetype: string | null;
  archetypeFocus: string | null;
  focusMuscles: string[];
  secondaryFocus: string | null;
  accessoryVolume: string | null;
  powerEmphasis: boolean | null;
};

export type GenerationPlanPosition = {
  startedOn: string | null;
  weeksTotal: number | null;
  currentWeekIndex: number | null;
  phase: string | null;
  deloadProximity: number | null;
  deloadSkipped: boolean | null;
  earlyDeload: boolean | null;
};

export type GenerationCeiling = {
  final: number;
  confidence: number;
  reasons: string[];
};

export type GenerationPerformance = {
  recoveredWeeks: number | null;
  ceiling: GenerationCeiling | null;
};

export type GenerationFreshness = {
  region: string;
  label: string;
  freshness: number;
};

export type GenerationReadiness = {
  bucketPressure: Array<{ bucket: string; percentOfCeiling: number }>;
  freshness: GenerationFreshness[];
};

export type GenerationContext = {
  athlete: GenerationAthlete | null;
  goal: GenerationGoal | null;
  planPosition: GenerationPlanPosition | null;
  performance: GenerationPerformance | null;
  readiness: GenerationReadiness | null;
};

export type PerformedSet = {
  weightKg: number | null;
  reps: number | null;
  rpe: number | null;
  skipped: boolean;
  setKind: string;
};

export type PerformedMovement = {
  movementId: string;
  name: string | null;
  loggedSets: PerformedSet[];
};

export type SessionPerformance = {
  /**
   * True when this id resolved to a real `sessions` row (started or
   * completed) — i.e. a workout that CAN have logged sets. False/absent
   * for a not-yet-started planned id, where there is nothing performed.
   */
  hasLog: boolean;
  /** Total logged set rows of any kind (incl. warm-ups + skipped). */
  totalLoggedSets: number;
  /** Logged working sets: non-warmup, non-skipped, with weight + reps. */
  loggedWorkingSets: number;
  /** Per-movement actuals for everything the user actually logged. */
  movements: PerformedMovement[];
  /**
   * Names of PRESCRIBED movements with zero logged sets — i.e. planned
   * but NOT performed. The single most important signal for an honest
   * post-workout recap: the AI must not narrate these as done.
   */
  notPerformed: string[];
};

export type SessionDetail = {
  onPlan: boolean;
  session: SessionSummary;
  movements: SessionMovement[];
  /**
   * What the user actually logged, vs the prescribed `movements` above.
   * Null only when the id is a not-yet-started planned session (no
   * session row exists yet, so nothing can have been performed).
   */
  performance: SessionPerformance | null;
  generationContext: GenerationContext;
};

const OFF_PLAN_PHASE = "off-plan / quick session";

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

function safeSync<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/**
 * Compute a human label for where this session sits in the block's wave
 * structure. Honors the ADR 0031/0032 skip + early-deload markers so a
 * converted week reads as what it actually became.
 */
function computePhase(
  archetype: string | null,
  weeksTotal: number | null,
  weekIndex: number | null,
  deloadSkipped: boolean,
  earlyDeload: boolean,
): string {
  if (weekIndex == null || archetype == null) return OFF_PLAN_PHASE;
  const deloadIdx = safeSync(
    () => deloadWeekIndexFor(archetype, weeksTotal ?? 0),
    null as number | null,
  );

  let isDeload = deloadIdx != null && weekIndex === deloadIdx;
  if (deloadSkipped) isDeload = false; // a deload week converted to loading
  if (earlyDeload) isDeload = true; // a loading week converted to deload

  if (isDeload) return "deload week";

  // Count loading weeks up to and including this one, skipping the deload.
  let wave = 0;
  for (let w = 0; w <= weekIndex; w += 1) {
    if (deloadIdx != null && w === deloadIdx && !earlyDeload) continue;
    wave += 1;
  }
  return `loading wave ${wave}`;
}

function summariseEquipment(equipment: unknown): string[] {
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

function formatRange(
  r: { min: number; max: number } | undefined,
  prefix: string,
): string | null {
  if (!r) return null;
  if (r.min === r.max) return `${prefix} ${r.min}`;
  return `${prefix} ${r.min}-${r.max}`;
}

function movementSetsReps(item: PrescriptionItem): string | null {
  // Cardio items are prescribed by duration.
  if (item.durationMin != null) return `${item.durationMin} min`;
  if (item.bw) {
    const { sets, reps, repRange, holdSeconds } = item.bw;
    if (holdSeconds != null) return `${sets}x${holdSeconds}s hold`;
    if (repRange) return `${sets}x${repRange.min}-${repRange.max}`;
    if (reps != null) return `${sets}x${reps}`;
    return `${sets} sets`;
  }
  if (item.holdSec) {
    const sets = item.sets ?? 1;
    return `${sets}x${formatRange(item.holdSec, "")?.trim()}s hold`;
  }
  if (item.distanceM) {
    const sets = item.sets ?? 1;
    return `${sets}x${formatRange(item.distanceM, "")?.trim()}m carry`;
  }
  if (item.sets != null && item.reps != null) return `${item.sets}x${item.reps}`;
  if (item.sets != null) return `${item.sets} sets`;
  return null;
}

function movementIntensity(item: PrescriptionItem): string | null {
  const parts: string[] = [];
  if (item.percentTm != null) parts.push(`${item.percentTm}% TM`);
  if (item.intensityLabel) parts.push(item.intensityLabel);
  const rir = formatRange(item.targetRir, "RIR");
  if (rir) parts.push(rir);
  const rpe = formatRange(item.targetRpe, "RPE");
  if (rpe) parts.push(rpe);
  if (item.hrCap) parts.push(item.hrCap);
  if (item.protocolNote) parts.push(item.protocolNote);
  return parts.length > 0 ? parts.join(", ") : null;
}

function mapMovements(items: PrescriptionItem[] | undefined): SessionMovement[] {
  if (!Array.isArray(items)) return [];
  return items.map((item) => ({
    kind: item.kind,
    name: item.movementName ?? item.movementSlug ?? null,
    setsReps: movementSetsReps(item),
    intensity: movementIntensity(item),
    why: item.notes ?? null,
  }));
}

type SessionRow = {
  id: string;
  performed_at: string | null;
  title: string | null;
  prescription: Prescription | null;
};

type PlannedRow = {
  id?: string | null;
  prescription: Prescription | null;
  week_index: number | null;
  day_index: number | null;
  block_id: string | null;
  role: string | null;
  title: string | null;
  session_modality: string | null;
};

type BlockRow = {
  id: string;
  archetype: string | null;
  started_on: string | null;
  weeks: number | null;
  focus_muscles: string[] | null;
  secondary_focus: string | null;
  accessory_volume: string | null;
  power_emphasis: boolean | null;
};

async function loadGenerationContext(
  userId: string,
  supabase: SupabaseClient,
  tz: string,
  block: BlockRow | null,
  weekIndex: number | null,
  phase: string,
  prescription: Prescription | null,
): Promise<GenerationContext> {
  const deloadSkipped = prescription?.deloadSkipped ?? null;
  const earlyDeload = prescription?.earlyDeload ?? null;

  const athlete = await safe<GenerationAthlete | null>(async () => {
    const [profileRes, limitationsRes] = await Promise.all([
      supabase
        .from("profiles")
        .select("training_experience, equipment, bodyweight_kg")
        .eq("id", userId)
        .maybeSingle(),
      supabase
        .from("limitations")
        .select("region, kind, resolved_at")
        .eq("user_id", userId)
        .is("resolved_at", null)
        .limit(50),
    ]);
    const profile = profileRes.data ?? null;
    const limitations = (limitationsRes.data ?? []) as Array<{
      region: string | null;
      kind: string | null;
    }>;
    const bw = profile?.bodyweight_kg;
    return {
      experience: (profile?.training_experience as string | null) ?? null,
      equipment: summariseEquipment(profile?.equipment ?? null),
      activeLimitations: limitations
        .filter((l) => l.region && l.kind)
        .map((l) => `${l.region} ${l.kind}`),
      bodyweightKg: bw != null ? Number(bw) : null,
    };
  }, null);

  const goal: GenerationGoal | null = block
    ? {
        archetype: block.archetype ?? null,
        archetypeFocus: safeSync(() => {
          const a = ARCHETYPES[block.archetype as Exclude<ArchetypeId, "custom">];
          return a?.oneLiner ?? block.archetype ?? null;
        }, block.archetype ?? null),
        focusMuscles: Array.isArray(block.focus_muscles)
          ? block.focus_muscles
          : [],
        secondaryFocus: block.secondary_focus ?? null,
        accessoryVolume: block.accessory_volume ?? null,
        powerEmphasis: block.power_emphasis ?? null,
      }
    : null;

  const deloadIdx = block
    ? safeSync(
        () => deloadWeekIndexFor(block.archetype ?? "", block.weeks ?? 0),
        null as number | null,
      )
    : null;
  const deloadProximity =
    deloadIdx != null && weekIndex != null && deloadIdx - weekIndex >= 0
      ? deloadIdx - weekIndex
      : null;

  const planPosition: GenerationPlanPosition | null = block
    ? {
        startedOn: block.started_on ?? null,
        weeksTotal: block.weeks ?? null,
        currentWeekIndex: weekIndex,
        phase,
        deloadProximity,
        deloadSkipped,
        earlyDeload,
      }
    : null;

  const performance = await safe<GenerationPerformance | null>(async () => {
    const { getCeilingExplain } = await import("@/lib/stats/engine");
    const ceiling = await getCeilingExplain(supabase, userId);
    if (!ceiling) return null;
    return {
      recoveredWeeks: ceiling.inputs?.recoveredWeeksCount ?? null,
      ceiling: {
        final: ceiling.finalCeiling,
        confidence: ceiling.confidenceBias,
        reasons: ceiling.inputs?.notes ?? [],
      },
    };
  }, null);

  const readiness = await safe<GenerationReadiness | null>(async () => {
    const [{ getBucketPressure }, { getRegionFreshness }] = await Promise.all([
      import("@/lib/stats/engine"),
      import("@/lib/stats/region-freshness-queries"),
    ]);
    const [buckets, regions] = await Promise.all([
      safe(() => getBucketPressure(supabase, userId, tz), []),
      safe(() => getRegionFreshness(supabase, userId), []),
    ]);
    return {
      bucketPressure: buckets.map((b) => ({
        bucket: b.bucket,
        percentOfCeiling: b.percentOfCeiling,
      })),
      freshness: regions.map((r) => ({
        region: r.region,
        label: r.label,
        freshness: r.freshness,
      })),
    };
  }, null);

  return { athlete, goal, planPosition, performance, readiness };
}

/**
 * Read what the user ACTUALLY logged for a real session row, grouped by
 * movement, plus the list of prescribed movements that were never
 * performed (zero logged sets). RLS: the caller has already confirmed
 * the `sessions` row is owned by the user, and set_logs.session_id pins
 * the read to that row.
 */
async function loadSessionPerformance(
  userId: string,
  sessionId: string,
  supabase: SupabaseClient,
  prescription: Prescription | null,
): Promise<SessionPerformance> {
  type LogRow = {
    movement_id: string;
    weight_kg: number | string | null;
    reps: number | null;
    rpe: number | string | null;
    set_kind: string | null;
    skipped: boolean | null;
  };

  const rows = await safe<LogRow[]>(async () => {
    const { data } = await supabase
      .from("set_logs")
      .select("movement_id, weight_kg, reps, rpe, set_kind, skipped, created_at")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });
    return (data ?? []) as LogRow[];
  }, []);

  // Resolve display names for every logged movement id (covers freestyle
  // movements that aren't in the prescription).
  const loggedIds = Array.from(
    new Set(rows.map((r) => r.movement_id).filter((id): id is string => !!id)),
  );
  const nameById = new Map<string, string>();
  if (loggedIds.length > 0) {
    const names = await safe<Array<{ id: string; display_name: string | null }>>(
      async () => {
        const { data } = await supabase
          .from("movements")
          .select("id, display_name")
          .in("id", loggedIds);
        return (data ?? []) as Array<{ id: string; display_name: string | null }>;
      },
      [],
    );
    for (const m of names) if (m.id) nameById.set(m.id, m.display_name ?? "");
  }
  // Prescription provides a name fallback + the prescribed-movement set.
  const prescribedNameById = new Map<string, string>();
  for (const it of prescription?.items ?? []) {
    if (it.movementId) {
      prescribedNameById.set(
        it.movementId,
        it.movementName ?? it.movementSlug ?? "",
      );
    }
  }

  const byMovement = new Map<string, PerformedMovement>();
  let totalLoggedSets = 0;
  let loggedWorkingSets = 0;
  for (const r of rows) {
    if (!r.movement_id) continue;
    totalLoggedSets += 1;
    const weight = r.weight_kg == null ? null : Number(r.weight_kg);
    const reps = r.reps == null ? null : Number(r.reps);
    const skipped = r.skipped ?? false;
    const kind = r.set_kind ?? "main";
    if (!skipped && kind !== "warmup" && weight != null && weight > 0 && reps != null && reps > 0) {
      loggedWorkingSets += 1;
    }
    const entry =
      byMovement.get(r.movement_id) ??
      ({
        movementId: r.movement_id,
        name:
          nameById.get(r.movement_id) ||
          prescribedNameById.get(r.movement_id) ||
          null,
        loggedSets: [],
      } satisfies PerformedMovement);
    entry.loggedSets.push({
      weightKg: weight,
      reps,
      rpe: r.rpe == null ? null : Number(r.rpe),
      skipped,
      setKind: kind,
    });
    byMovement.set(r.movement_id, entry);
  }

  // Prescribed movements with no logged set at all = planned-but-not-done.
  const loggedIdSet = new Set(byMovement.keys());
  const notPerformed: string[] = [];
  const seenNames = new Set<string>();
  for (const it of prescription?.items ?? []) {
    if (!it.movementId || loggedIdSet.has(it.movementId)) continue;
    const name = it.movementName ?? it.movementSlug ?? null;
    if (name && !seenNames.has(name)) {
      seenNames.add(name);
      notPerformed.push(name);
    }
  }

  return {
    hasLog: true,
    totalLoggedSets,
    loggedWorkingSets,
    movements: Array.from(byMovement.values()),
    notPerformed,
  };
}

export async function loadSessionDetail(
  userId: string,
  sessionId: string,
  supabase: SupabaseClient,
  tz: string,
): Promise<SessionDetail | null> {
  const { data: sessionData } = await supabase
    .from("sessions")
    .select("id, performed_at, title, prescription")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();

  const session = (sessionData as SessionRow | null) ?? null;

  // The id may be a real `sessions.id` (a started/completed workout) or a
  // `planned_sessions.id` (a not-yet-started planned workout — the Today card
  // and plan drawer hold this id before any session row exists). Resolve both.
  let planned: PlannedRow | null = null;
  let onPlan = false;

  if (session) {
    // Started/completed. On-plan prescription + plan position come from the
    // linked planned_sessions row; off-plan / quick sessions carry their own
    // prescription jsonb on the session row instead.
    const { data: plannedData } = await supabase
      .from("planned_sessions")
      .select(
        "id, prescription, week_index, day_index, block_id, role, title, session_modality",
      )
      .eq("completed_session_id", sessionId)
      .eq("user_id", userId)
      .maybeSingle();
    planned = (plannedData as PlannedRow | null) ?? null;
    onPlan = planned != null;
  } else {
    // Not a session row — resolve the id as a planned (not-yet-started)
    // session the user owns.
    const { data: plannedById } = await supabase
      .from("planned_sessions")
      .select(
        "id, prescription, week_index, day_index, block_id, role, title, session_modality",
      )
      .eq("id", sessionId)
      .eq("user_id", userId)
      .maybeSingle();
    planned = (plannedById as PlannedRow | null) ?? null;
    if (!planned) return null; // neither a session nor a planned session owned by the user
    onPlan = true;
  }

  const prescription: Prescription | null = session
    ? onPlan
      ? planned?.prescription ?? null
      : session.prescription ?? null
    : planned?.prescription ?? null;

  // Resolve the parent block — by the planned session's block_id (on-plan),
  // else fall back to the user's active block (off-plan context).
  let block: BlockRow | null = null;
  if (planned?.block_id) {
    const { data: blockData } = await supabase
      .from("training_blocks")
      .select(
        "id, archetype, started_on, weeks, focus_muscles, secondary_focus, accessory_volume, power_emphasis",
      )
      .eq("id", planned.block_id)
      .eq("user_id", userId)
      .is("deleted_at", null)
      .maybeSingle();
    block = (blockData as BlockRow | null) ?? null;
  } else {
    const { data: activeBlock } = await supabase
      .from("training_blocks")
      .select(
        "id, archetype, started_on, weeks, focus_muscles, secondary_focus, accessory_volume, power_emphasis",
      )
      .eq("user_id", userId)
      .eq("status", "active")
      .is("deleted_at", null)
      .order("started_on", { ascending: false })
      .limit(1)
      .maybeSingle();
    block = (activeBlock as BlockRow | null) ?? null;
  }

  const weekIndex = onPlan ? planned?.week_index ?? null : null;
  const archetype = block?.archetype ?? null;
  const phase = onPlan
    ? computePhase(
        archetype,
        block?.weeks ?? null,
        weekIndex,
        prescription?.deloadSkipped ?? false,
        prescription?.earlyDeload ?? false,
      )
    : OFF_PLAN_PHASE;

  const title = onPlan
    ? planned?.title ?? session?.title ?? null
    : session?.title ?? null;

  const generationContext = await loadGenerationContext(
    userId,
    supabase,
    tz,
    block,
    weekIndex,
    phase,
    prescription,
  );

  // Actuals: only a real session row can have logged sets. A planned-only
  // id (not yet started) has nothing performed → null.
  const performance = session
    ? await loadSessionPerformance(userId, session.id, supabase, prescription)
    : null;

  return {
    onPlan,
    session: {
      id: session?.id ?? sessionId,
      date: session?.performed_at
        ? String(session.performed_at).slice(0, 10)
        : null,
      title,
      archetype,
      weekIndex,
      phase,
    },
    movements: mapMovements(prescription?.items),
    performance,
    generationContext,
  };
}
