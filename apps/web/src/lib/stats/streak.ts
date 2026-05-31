/**
 * Streak — consecutive ISO weeks where the user hit their session
 * target. The "target" is read off the active training block's
 * `days_per_week`, which is the field the block config exposes for
 * weekly frequency (see `active-block-progress.ts` and the schema's
 * `training_blocks.days_per_week`).
 *
 * Streak target definition (HEURISTIC / CP-1)
 * ───────────────────────────────────────────
 * `weeklyTarget = active_block.days_per_week` — if the user set up a
 * 4-days-per-week block, hitting ≥4 sessions in an ISO week counts as
 * a successful week. We use the user-declared frequency rather than
 * `planned_sessions` counts because the latter can spike during deload
 * weeks or shift during recalibration; the declared frequency is the
 * promise the user made to themselves. When `days_per_week` is null,
 * we fall back to `ceil(planned_sessions / weeks)` per the block.
 *
 * Streak walks backwards from the LAST COMPLETED week (the week before
 * the current one). The in-progress current week is reported separately
 * so a user who has logged 2 of 4 days on a Thursday isn't counted as
 * having "broken" the streak yet — they still have the weekend.
 *
 * `currentStreakWeeks = 0` means "no active block" OR "last completed
 * week missed target". `hasActiveBlock = false` short-circuits to all
 * zeros.
 *
 * Read-only / no engine inputs (mirrors `readiness.ts`).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  addDaysToYmd,
  mondayOfYmd,
  todayYmd,
  ymdInTimezone,
} from "@/lib/dates";

export type Streak = {
  /** Consecutive completed weeks meeting target, walking back from last week. */
  currentStreakWeeks: number;
  /** Sessions-per-week required to count a week as "made". */
  weeklyTarget: number;
  /** Completed sessions so far in the in-progress current ISO week. */
  thisWeekCompleted: number;
  /** Same as `weeklyTarget` — duplicated for the UI's "X / Y this week" chip. */
  thisWeekTarget: number;
  hasActiveBlock: boolean;
};

/**
 * Pure streak computer.
 *
 * @param completedByWeek
 *   Map of `weekStart` (Monday YYYY-MM-DD) → number of completed sessions
 *   in that week.
 * @param currentMonday
 *   Monday of the user's current ISO week.
 * @param weeklyTarget
 *   Minimum sessions to count a week. Must be > 0.
 *
 * Walks backwards starting from `currentMonday - 7d` (the most recent
 * COMPLETED week). Stops at the first week that falls short of target
 * OR at the 52-week horizon (kept finite so a misconfigured fixture
 * can't infinite-loop).
 */
export function computeStreak(
  completedByWeek: ReadonlyMap<string, number>,
  currentMonday: string,
  weeklyTarget: number,
): { currentStreakWeeks: number; thisWeekCompleted: number } {
  const thisWeekCompleted = completedByWeek.get(currentMonday) ?? 0;
  if (weeklyTarget <= 0) {
    return { currentStreakWeeks: 0, thisWeekCompleted };
  }
  let streak = 0;
  for (let i = 1; i <= 52; i++) {
    const monday = addDaysToYmd(currentMonday, -7 * i);
    const count = completedByWeek.get(monday) ?? 0;
    if (count >= weeklyTarget) streak += 1;
    else break;
  }
  return { currentStreakWeeks: streak, thisWeekCompleted };
}

type BlockRow = {
  id: string;
  started_on: string;
  weeks: number;
  days_per_week: number | null;
  planned_sessions?: { week_index: number }[];
};
type SessionPerformedRow = { performed_at: string };

/**
 * Read-side wrapper. One round trip for the active block (with planned
 * count for fallback), one for completed sessions in the last ~13 weeks.
 *
 * Read path only — user-scoped Supabase client.
 */
export async function getStreak(
  supabase: SupabaseClient,
  userId: string,
  tz: string,
): Promise<Streak> {
  const today = todayYmd(tz);
  const currentMonday = mondayOfYmd(today);

  // 1. Active block + its planned counts (for fallback when
  //    days_per_week is null on legacy blocks).
  const { data: blockData } = await supabase
    .from("training_blocks")
    .select("id, started_on, weeks, days_per_week, planned_sessions(week_index)")
    .eq("user_id", userId)
    .eq("status", "active")
    .is("deleted_at", null)
    .order("started_on", { ascending: false })
    .limit(1)
    .maybeSingle();

  const block = (blockData ?? null) as BlockRow | null;
  if (!block) {
    return {
      currentStreakWeeks: 0,
      weeklyTarget: 0,
      thisWeekCompleted: 0,
      thisWeekTarget: 0,
      hasActiveBlock: false,
    };
  }

  let weeklyTarget = block.days_per_week ?? 0;
  if (!weeklyTarget) {
    // Fallback: distinct day_index per week across the block's planned
    // rows. A user with 12 planned sessions across 4 weeks averages 3
    // sessions per week.
    const planned = block.planned_sessions ?? [];
    if (planned.length > 0 && block.weeks > 0) {
      weeklyTarget = Math.max(1, Math.ceil(planned.length / block.weeks));
    }
  }

  // 2. Completed sessions in the last ~13 weeks (plenty for a 12-week
  //    streak walk + the current week).
  const lookbackIso = new Date(
    Date.now() - 13 * 7 * 86_400_000,
  ).toISOString();
  const { data: sessionRows } = await supabase
    .from("sessions")
    .select("performed_at")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .not("completed_at", "is", null)
    .gte("performed_at", lookbackIso);

  const completedByWeek = new Map<string, number>();
  for (const r of (sessionRows ?? []) as SessionPerformedRow[]) {
    if (!r.performed_at) continue;
    const ymd = ymdInTimezone(new Date(r.performed_at), tz);
    const monday = mondayOfYmd(ymd);
    completedByWeek.set(monday, (completedByWeek.get(monday) ?? 0) + 1);
  }

  const { currentStreakWeeks, thisWeekCompleted } = computeStreak(
    completedByWeek,
    currentMonday,
    weeklyTarget,
  );

  return {
    currentStreakWeeks,
    weeklyTarget,
    thisWeekCompleted,
    thisWeekTarget: weeklyTarget,
    hasActiveBlock: true,
  };
}
