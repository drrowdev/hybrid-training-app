/**
 * Adherence — completion ratio for the Stats overview card.
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
 * Denominator: every planned_session whose calendar date is ≥ today−N
 * AND ≤ today (i.e. "was scheduled to be done by now"). Future-dated
 * planned sessions are not yet due, so they don't penalise the user.
 * When `windowDays === null` (Phase 2 "all-time" range), the lower
 * bound is dropped entirely — every past planned session counts.
 *
 * Numerator: planned sessions linked to a non-deleted session.
 *
 * The query fans through every non-deleted block the user owns. Cost is
 * bounded — a user's active + recent blocks contain at most a few
 * hundred planned rows in practice — and computing the per-row date
 * client-side (block.startedOn + week*7 + day) keeps the SQL simple.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysToYmd, daysBetweenYmd, isoWeekdayYmd, todayYmd, ymdInTimezone } from "@/lib/dates";
import { resolveLinkedSession } from "@/lib/sessions/linked-session-state";

export type AdherenceInput = {
  /** Today as YYYY-MM-DD in the user's timezone. */
  today: string;
  /**
   * Window length in days. `null` skips the lower bound (all-time).
   * Default is 30, matching the Phase 1 card.
   */
  windowDays?: number | null;
  /** Planned-session rows joined with their block.started_on. */
  planned: Array<{
    weekIndex: number;
    dayIndex: number;
    completedSessionId: string | null;
    skippedAt: string | null;
    blockStartedOn: string;
    /**
     * YYYY-MM-DD (in user tz) of the linked session's `performed_at`,
     * or null when not completed / unknown. Used purely to split
     * `completed` into on-time vs late-logged for the breakdown
     * card — does NOT affect the headline ratio.
     */
    performedYmd?: string | null;
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
  /**
   * Completed AND performed on (or before) the planned date, OR
   * completed with no planned date. Diagnostic breakdown — does NOT
   * change `ratio`.
   */
  onTime: number;
  /**
   * Completed but the linked session's `performed_at` (in user tz)
   * fell strictly after the planned date. Diagnostic only.
   */
  lateLogged: number;
  /**
   * Still in limbo: not completed, not skipped, date in the past.
   * Equals `missed - skipped`. Diagnostic only.
   */
  accidentallyMissed: number;
};

/**
 * Pure adherence calculator. Filters planned_sessions to those whose
 * derived date sits inside the window (today−windowDays … today, both
 * inclusive) and then buckets them.
 */
export function computeAdherence(input: AdherenceInput): AdherenceResult {
  const windowDays = input.windowDays === undefined ? 30 : input.windowDays;
  const earliest = windowDays == null ? null : addDaysToYmd(input.today, -windowDays);
  let scheduled = 0;
  let completed = 0;
  let skipped = 0;
  let onTime = 0;
  let lateLogged = 0;

  for (const row of input.planned) {
    const date = dayDateFor(row.blockStartedOn, row.weekIndex, row.dayIndex);
    if (earliest != null && date < earliest) continue;
    if (date > input.today) continue;
    scheduled++;
    if (row.completedSessionId) {
      completed++;
      // Late-logged when we know `performed_at` and it lands strictly
      // after the planned date in the user's tz. Falls back to
      // on-time when we don't have a performed_at (legacy rows /
      // joins that didn't fetch it).
      if (row.performedYmd && row.performedYmd > date) {
        lateLogged++;
      } else {
        onTime++;
      }
    } else if (row.skippedAt) skipped++;
  }

  const missed = scheduled - completed;
  const accidentallyMissed = missed - skipped;
  const ratio = scheduled === 0 ? 0 : completed / scheduled;
  return {
    completed,
    scheduled,
    skipped,
    missed,
    ratio,
    onTime,
    lateLogged,
    accidentallyMissed,
  };
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
      "week_index, day_index, completed_session_id, skipped_at, training_blocks!inner(started_on, deleted_at, user_id), sessions(performed_at, deleted_at)",
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
    sessions:
      | { performed_at: string | null; deleted_at: string | null }
      | Array<{ performed_at: string | null; deleted_at: string | null }>
      | null;
  };
  const rows = (data ?? []) as Row[];
  const planned = rows
    .map((r) => {
      const blk = Array.isArray(r.training_blocks) ? r.training_blocks[0] : r.training_blocks;
      if (!blk?.started_on) return null;
      const sess = Array.isArray(r.sessions) ? r.sessions[0] : r.sessions;
      const linked = resolveLinkedSession(
        r.completed_session_id,
        sess && r.completed_session_id
          ? {
              id: r.completed_session_id,
              completedAt: null,
              deletedAt: sess.deleted_at,
            }
          : null,
      );
      const activeSession = linked.completedSessionId ? sess : null;
      const performedYmd =
        activeSession?.performed_at != null
          ? ymdInTimezone(new Date(activeSession.performed_at), tz)
          : null;
      return {
        weekIndex: r.week_index,
        dayIndex: r.day_index,
        completedSessionId: linked.completedSessionId,
        skippedAt: r.skipped_at,
        blockStartedOn: blk.started_on,
        performedYmd,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r != null);

  return computeAdherence({ today: todayYmd(tz), planned });
}

/**
 * Phase 2 range-aware adherence reader. Identical to `getAdherence30d`
 * but parametrised by window in days; `null` = all-time.
 */
export async function getAdherenceForWindow(
  supabase: SupabaseClient,
  userId: string,
  tz: string,
  windowDays: number | null,
): Promise<AdherenceResult> {
  const { data, error } = await supabase
    .from("planned_sessions")
    .select(
      "week_index, day_index, completed_session_id, skipped_at, training_blocks!inner(started_on, deleted_at, user_id), sessions(performed_at, deleted_at)",
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
    sessions:
      | { performed_at: string | null; deleted_at: string | null }
      | Array<{ performed_at: string | null; deleted_at: string | null }>
      | null;
  };
  const rows = (data ?? []) as Row[];
  const planned = rows
    .map((r) => {
      const blk = Array.isArray(r.training_blocks) ? r.training_blocks[0] : r.training_blocks;
      if (!blk?.started_on) return null;
      const sess = Array.isArray(r.sessions) ? r.sessions[0] : r.sessions;
      const linked = resolveLinkedSession(
        r.completed_session_id,
        sess && r.completed_session_id
          ? {
              id: r.completed_session_id,
              completedAt: null,
              deletedAt: sess.deleted_at,
            }
          : null,
      );
      const activeSession = linked.completedSessionId ? sess : null;
      const performedYmd =
        activeSession?.performed_at != null
          ? ymdInTimezone(new Date(activeSession.performed_at), tz)
          : null;
      return {
        weekIndex: r.week_index,
        dayIndex: r.day_index,
        completedSessionId: linked.completedSessionId,
        skippedAt: r.skipped_at,
        blockStartedOn: blk.started_on,
        performedYmd,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r != null);

  return computeAdherence({ today: todayYmd(tz), windowDays, planned });
}
