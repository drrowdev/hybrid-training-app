/**
 * Streak — consecutive ISO weeks where the user hit their session
 * target. Each program's target is read off its own active training block's
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
 * `active-block-progress.ts` supplies only that program's completed workouts.
 * Other programs and standalone sessions cannot meet its target.
 */
import { addDaysToYmd } from "@/lib/dates";

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
