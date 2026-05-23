/**
 * Adherence — 30-day completion ratio for the Stats overview card.
 *
 * Phase 1 brief decision (Stats Overview §B): **skipped sessions count
 * as MISSED for adherence**. The user explicitly chose not to do the
 * planned session, so it's a deviation from the plan — not a neutral
 * "didn't happen". Treating skipped as a third category would let the
 * adherence number drift north every time a user trashes a session
 * instead of doing it, which defeats the purpose of the metric. If we
 * later want a softer view (e.g. "intentional rest", "auto-skipped
 * after deload"), Phase 2's adherence dashboard is the right venue.
 *
 * Denominator: every planned_session whose calendar date is ≥ today−30
 * AND ≤ today (i.e. "was scheduled to be done by now"). Future-dated
 * planned sessions are not yet due, so they don't penalise the user.
 *
 * Numerator: planned_sessions with `completed_session_id IS NOT NULL`.
 *
 * The query fans through every non-deleted block the user owns. Cost is
 * bounded — a user's active + recent blocks contain at most a few
 * hundred planned rows in practice — and computing the per-row date
 * client-side (block.startedOn + week*7 + day) keeps the SQL simple.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysToYmd, daysBetweenYmd, isoWeekdayYmd, todayYmd } from "@/lib/dates";

export type AdherenceInput = {
  /** Today as YYYY-MM-DD in the user's timezone. */
  today: string;
  /** Window length in days (default 30). */
  windowDays?: number;
  /** Planned-session rows joined with their block.started_on. */
  planned: Array<{
    weekIndex: number;
    dayIndex: number;
    completedSessionId: string | null;
    skippedAt: string | null;
    blockStartedOn: string;
  }>;
};

export type AdherenceResult = {
  /** completed (i.e. logged a real session) — numerator. */
  completed: number;
  /** Scheduled to be done by now within the window — denominator. */
  scheduled: number;
  /** Skipped within the window. Tracked separately for diagnostics; included in `missed`. */
  skipped: number;
  /** Scheduled minus completed. Includes skipped. */
  missed: number;
  /** completed / scheduled, in [0, 1]. NaN-safe: 0 when scheduled === 0. */
  ratio: number;
};

/**
 * Pure adherence calculator. Filters planned_sessions to those whose
 * derived date sits inside the window (today−windowDays … today, both
 * inclusive) and then buckets them.
 */
export function computeAdherence(input: AdherenceInput): AdherenceResult {
  const windowDays = input.windowDays ?? 30;
  const earliest = addDaysToYmd(input.today, -windowDays);
  let scheduled = 0;
  let completed = 0;
  let skipped = 0;

  for (const row of input.planned) {
    const date = dayDateFor(row.blockStartedOn, row.weekIndex, row.dayIndex);
    if (date < earliest) continue;
    if (date > input.today) continue;
    scheduled++;
    if (row.completedSessionId) completed++;
    else if (row.skippedAt) skipped++;
  }

  const missed = scheduled - completed;
  const ratio = scheduled === 0 ? 0 : completed / scheduled;
  return { completed, scheduled, skipped, missed, ratio };
}

/** Date for week i, day j of a block starting on `startedOn` (snapped to the Monday of that ISO week). */
function dayDateFor(startedOn: string, weekIndex: number, dayIndex: number): string {
  const startWeekday = isoWeekdayYmd(startedOn);
  const blockMonday = addDaysToYmd(startedOn, -startWeekday);
  return addDaysToYmd(blockMonday, weekIndex * 7 + dayIndex);
}

/** Convenience for `computeAdherence` when caller only has a Date. */
export function daysAgoYmd(today: string, ymd: string): number {
  return daysBetweenYmd(ymd, today);
}

/**
 * Read every non-deleted planned_session for the user, then run the
 * pure aggregator. One round trip; planned_sessions row count is the
 * sum-of-(weeks × daysPerWeek) across their non-trashed blocks, which
 * is bounded for any human user (hundreds, not thousands).
 */
export async function getAdherence30d(
  supabase: SupabaseClient,
  userId: string,
  tz: string,
): Promise<AdherenceResult> {
  const { data, error } = await supabase
    .from("planned_sessions")
    .select(
      "week_index, day_index, completed_session_id, skipped_at, training_blocks!inner(started_on, deleted_at, user_id)",
    )
    .eq("training_blocks.user_id", userId)
    .is("training_blocks.deleted_at", null);
  if (error) throw new Error(error.message);
  type Row = {
    week_index: number;
    day_index: number;
    completed_session_id: string | null;
    skipped_at: string | null;
    training_blocks:
      | { started_on: string }
      | Array<{ started_on: string }>
      | null;
  };
  const rows = (data ?? []) as Row[];
  const planned = rows
    .map((r) => {
      const blk = Array.isArray(r.training_blocks) ? r.training_blocks[0] : r.training_blocks;
      if (!blk?.started_on) return null;
      return {
        weekIndex: r.week_index,
        dayIndex: r.day_index,
        completedSessionId: r.completed_session_id,
        skippedAt: r.skipped_at,
        blockStartedOn: blk.started_on,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r != null);

  return computeAdherence({ today: todayYmd(tz), planned });
}
