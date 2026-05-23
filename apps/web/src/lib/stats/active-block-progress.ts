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
};

export async function getActiveBlockProgress(
  supabase: SupabaseClient,
  userId: string,
  tz: string,
): Promise<ActiveBlockProgress | null> {
  const { data, error } = await supabase
    .from("training_blocks")
    .select(
      "id, archetype, started_on, weeks, days_per_week, status, notes, day_index_overrides, planned_sessions(week_index, day_index, completed_session_id, skipped_at)",
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
      if (p.completed_session_id) logged++;
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
