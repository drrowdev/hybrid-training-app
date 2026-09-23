/**
 * Active block progress — top-of-page strip on /app/stats.
 *
 * Each program's completion and streak use only its linked workouts.
 * Started sessions remain available to log but do not count as completed.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isPlannedRest } from "@hta/domain";
import { resolveLinkedSessionRelation } from "@/lib/sessions/linked-session-state";
import { addDaysToYmd, daysBetweenYmd, isoWeekdayYmd, mondayOfYmd, todayYmd, ymdInTimezone } from "@/lib/dates";
import { archetypeDisplayName } from "@/lib/planner/queries";
import { computeStreak, type Streak } from "./streak";

export type ActiveBlockProgress = {
  blockId: string;
  archetypeName: string;
  weeks: number;
  daysPerWeek: number | null;
  /** 1-indexed current week. Clamped to the block's bounds. */
  currentWeek: number;
  totalScheduled: number;
  scheduledToDate: number;
  logged: number;
  skipped: number;
  /** Any planned session whose modality is strength-flavoured. */
  planStrength: boolean;
  /** Any planned session whose modality is cardio-flavoured. */
  planCardio: boolean;
  /**
   * True when this block is driven by the adaptive engine — the built-in
   * Hybrid generator (`program_id === "hybrid"`) or a legacy adaptive
   * archetype block (no `program_id`, but an `archetype` set). Foreign
   * platform programs (5/3/1, Tactical Barbell, Green Protocol, HYROX) run
   * fixed templates, so the engine page ("Adaptive engine") doesn't apply.
   */
  usesAdaptiveEngine: boolean;
  streak: Streak;
};

type PlannedRow = {
  week_index: number;
  day_index: number;
  role: string | null;
  prescription: unknown;
  completed_session_id: string | null;
  skipped_at: string | null;
  session_modality: string | null;
  sessions:
    | { deleted_at: string | null; completed_at: string | null; performed_at: string | null }
    | Array<{ deleted_at: string | null; completed_at: string | null; performed_at: string | null }>
    | null;
};

type BlockRow = {
  id: string;
  archetype: string | null;
  notes: string | null;
  program_id: string | null;
  started_on: string;
  weeks: number;
  days_per_week: number | null;
  planned_sessions: PlannedRow[];
};

export async function getActiveBlocksProgress(
  supabase: SupabaseClient,
  userId: string,
  tz: string,
): Promise<ActiveBlockProgress[]> {
  const { data, error } = await supabase
    .from("training_blocks")
    .select(
      "id, archetype, program_id, started_on, weeks, days_per_week, status, notes, planned_sessions(week_index, day_index, role, prescription, completed_session_id, skipped_at, session_modality, sessions(deleted_at, completed_at, performed_at))",
    )
    .eq("user_id", userId)
    .eq("status", "active")
    .is("deleted_at", null)
    .order("started_on", { ascending: false });
  if (error) throw new Error(error.message);
  const today = todayYmd(tz);
  return ((data ?? []) as BlockRow[]).map((block) => blockProgress(block, today, tz));
}

function blockProgress(data: BlockRow, today: string, tz: string): ActiveBlockProgress {
  const planned = (data.planned_sessions ?? []).filter((row) => !isPlannedRest(row));
  const startWeekday = isoWeekdayYmd(data.started_on);
  const blockMonday = addDaysToYmd(data.started_on, -startWeekday);

  const totalScheduled = planned.length;
  let scheduledToDate = 0;
  let logged = 0;
  let skipped = 0;
  const completedByWeek = new Map<string, number>();
  const countedSessionIds = new Set<string>();

  // Current week index based on today (0-indexed, clamped 0..weeks-1).
  const daysSinceStart = Math.max(0, daysBetweenYmd(blockMonday, today));
  const rawWeek = Math.floor(daysSinceStart / 7);
  const currentWeekIdx = Math.min(Math.max(rawWeek, 0), Math.max(0, data.weeks - 1));

  for (const p of planned) {
    const date = addDaysToYmd(blockMonday, p.week_index * 7 + p.day_index);
    const linked = resolveLinkedSessionRelation(p.completed_session_id, p.sessions);
    const session = Array.isArray(p.sessions) ? p.sessions[0] : p.sessions;
    if (linked.completedAt && linked.completedSessionId && session?.performed_at && !countedSessionIds.has(linked.completedSessionId)) {
      const performed = ymdInTimezone(new Date(session.performed_at), tz);
      if (performed <= today) {
        const monday = mondayOfYmd(performed);
        completedByWeek.set(monday, (completedByWeek.get(monday) ?? 0) + 1);
        countedSessionIds.add(linked.completedSessionId);
      }
    }
    if (date <= today) {
      scheduledToDate++;
      if (linked.completedAt) logged++;
      else if (p.skipped_at) skipped++;
    }
  }

  const dpw = (data.days_per_week as number | null) ?? null;
  const weeklyTarget = today < data.started_on ? 0 : dpw ??
    (planned.length > 0 && data.weeks > 0 ? Math.ceil(planned.length / data.weeks) : 0);
  const streak = computeStreak(completedByWeek, mondayOfYmd(today), weeklyTarget);

  const CARDIO_MODALITIES = new Set(["pure_z2_aerobic", "pure_hiit", "mixed_modal"]);
  const STRENGTH_MODALITIES = new Set(["pure_strength", "pure_hypertrophy", "mixed_modal"]);
  let planCardio = false;
  let planStrength = false;
  for (const p of planned) {
    const m = p.session_modality;
    if (m == null) continue;
    if (CARDIO_MODALITIES.has(m)) planCardio = true;
    if (STRENGTH_MODALITIES.has(m)) planStrength = true;
  }

  const programId = (data.program_id as string | null) ?? null;
  const usesAdaptiveEngine =
    programId === "hybrid" || (programId == null && data.archetype != null);

  return {
    blockId: data.id,
    archetypeName: archetypeDisplayName(data.archetype, data.notes ?? null),
    weeks: data.weeks,
    daysPerWeek: dpw,
    currentWeek: currentWeekIdx + 1,
    totalScheduled,
    scheduledToDate,
    logged,
    skipped,
    planStrength,
    planCardio,
    usesAdaptiveEngine,
    streak: { ...streak, weeklyTarget, thisWeekTarget: weeklyTarget, hasActiveBlock: true },
  };
}
