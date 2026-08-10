/**
 * Active block progress — top-of-page strip on /app/stats.
 *
 * Resolves the active block (if any), computes the current (week, day)
 * position, and counts completed vs scheduled-to-date so the strip can
 * render "Week 2 of 4 · Day 3 of 4 days/week" + a progress bar.
 *
 * Single round-trip: pulls the active training_blocks row joined with
 * its planned_sessions (slim columns only). Reuses the same join shape
 * as `getAllBlocksWithCompletionStats` so the access pattern is
 * familiar to the planner team.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveLinkedSession } from "@/lib/sessions/linked-session-state";
import { addDaysToYmd, isoWeekdayYmd, todayYmd } from "@/lib/dates";
import { archetypeDisplayName } from "@/lib/planner/queries";

export type ActiveBlockProgress = {
  blockId: string;
  archetypeName: string;
  weeks: number;
  daysPerWeek: number | null;
  /** 1-indexed current week. Clamped to the block's bounds. */
  currentWeek: number;
  /** 1-indexed current day-of-week position among the block's training days. */
  currentDayInWeek: number;
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
};

export async function getActiveBlockProgress(
  supabase: SupabaseClient,
  userId: string,
  tz: string,
): Promise<ActiveBlockProgress | null> {
  const { data, error } = await supabase
    .from("training_blocks")
    .select(
      "id, archetype, program_id, started_on, weeks, days_per_week, status, notes, day_index_overrides, planned_sessions(week_index, day_index, completed_session_id, skipped_at, session_modality, sessions(deleted_at))",
    )
    .eq("user_id", userId)
    .eq("status", "active")
    .is("deleted_at", null)
    .order("started_on", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  type PlannedRow = {
    week_index: number;
    day_index: number;
    completed_session_id: string | null;
    skipped_at: string | null;
    session_modality: string | null;
    sessions:
      | { deleted_at: string | null }
      | Array<{ deleted_at: string | null }>
      | null;
  };
  const planned = (data.planned_sessions ?? []) as PlannedRow[];
  const today = todayYmd(tz);
  const startWeekday = isoWeekdayYmd(data.started_on);
  const blockMonday = addDaysToYmd(data.started_on, -startWeekday);

  let totalScheduled = planned.length;
  let scheduledToDate = 0;
  let logged = 0;
  let skipped = 0;
  // Track which planned rows have today's-or-earlier date so we can
  // pin "Day X of Y" to the right value.
  const datesInThisWeek: string[] = [];

  // Current week index based on today (0-indexed, clamped 0..weeks-1).
  const daysSinceStart = Math.max(0, daysSince(blockMonday, today));
  const rawWeek = Math.floor(daysSinceStart / 7);
  const currentWeekIdx = Math.min(Math.max(rawWeek, 0), Math.max(0, data.weeks - 1));

  for (const p of planned) {
    const date = addDaysToYmd(blockMonday, p.week_index * 7 + p.day_index);
    if (date <= today) {
      scheduledToDate++;
      const session = Array.isArray(p.sessions) ? p.sessions[0] : p.sessions;
      const linked = resolveLinkedSession(
        p.completed_session_id,
        session && p.completed_session_id
          ? {
              id: p.completed_session_id,
              completedAt: null,
              deletedAt: session.deleted_at,
            }
          : null,
      );
      if (linked.completedSessionId) logged++;
      else if (p.skipped_at) skipped++;
    }
    if (p.week_index === currentWeekIdx && date <= today) {
      datesInThisWeek.push(date);
    }
  }

  // Total scheduled fallback if planned is incomplete: weeks × daysPerWeek.
  const dpw = (data.days_per_week as number | null) ?? null;
  if (totalScheduled === 0 && dpw != null) {
    totalScheduled = data.weeks * dpw;
  }

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
    currentDayInWeek: Math.max(1, datesInThisWeek.length),
    totalScheduled,
    scheduledToDate,
    logged,
    skipped,
    planStrength,
    planCardio,
    usesAdaptiveEngine,
  };
}

/** Inclusive day count between two YYYY-MM-DD dates. */
function daysSince(start: string, end: string): number {
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
