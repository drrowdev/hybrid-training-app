/**
 * Weekly rhythm — per-ISO-week counts of strength sessions, cardio
 * sessions, and planned sessions for the rolling-N-weeks bar chart.
 *
 * Why session counts, not minutes
 * ───────────────────────────────
 * `sessions.duration_min` is sparse — many strength sessions never
 * record a duration (the user closes the page without hitting the timer)
 * and cardio rows persist `duration_sec` instead. Mixing them would
 * silently under-weight strength weeks. Counts are the honest signal:
 * "you trained X strength days and Y cardio days this week, against Z
 * planned days". A single session can be BOTH (mixed strength+cardio)
 * and counts toward both buckets — that's the actual rhythm the user
 * lived. Mixed-modality sessions count as one strength + one cardio.
 *
 * Bucketing: ISO weeks, Monday-anchored (`mondayOfYmd`), most recent
 * `weeks` weeks ending at the Monday of the current ISO week.
 * Empty weeks DO render with zeros so the chart shape stays stable.
 *
 * Read-only / no engine inputs (mirrors `readiness.ts` /
 * `training-heatmap-data.ts`).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  addDaysToYmd,
  isoWeekdayYmd,
  mondayOfYmd,
  todayYmd,
  ymdInTimezone,
} from "@/lib/dates";

export type WeeklyRhythmWeek = {
  /** Monday YYYY-MM-DD (oldest first). */
  weekStart: string;
  strengthCount: number;
  cardioCount: number;
  plannedCount: number;
};

export type WeeklyRhythm = {
  weeks: WeeklyRhythmWeek[];
};

export type RawCompletedSession = {
  /** YYYY-MM-DD in the user's tz. */
  performedYmd: string;
  isStrength: boolean;
  isCardio: boolean;
};

export type RawPlannedSession = {
  /** YYYY-MM-DD (block-relative date). */
  date: string;
};

/**
 * Pure aggregator. Given the latest `weeks` ISO weeks (anchored on
 * `today`), bucket each completed session into the right week and tally
 * planned-session counts likewise. Empty weeks present as zeros.
 */
export function aggregateWeeklyRhythm(
  today: string,
  weeks: number,
  completed: readonly RawCompletedSession[],
  planned: readonly RawPlannedSession[],
): WeeklyRhythm {
  const w = Math.max(1, Math.floor(weeks));
  const currentMonday = mondayOfYmd(today);
  // Oldest first.
  const weekStarts: string[] = [];
  for (let i = w - 1; i >= 0; i--) {
    weekStarts.push(addDaysToYmd(currentMonday, -7 * i));
  }
  const earliest = weekStarts[0]!;
  const latest = addDaysToYmd(currentMonday, 6); // Sunday of current week.
  const idxByMonday = new Map(weekStarts.map((m, i) => [m, i]));

  const out: WeeklyRhythmWeek[] = weekStarts.map((monday) => ({
    weekStart: monday,
    strengthCount: 0,
    cardioCount: 0,
    plannedCount: 0,
  }));

  for (const s of completed) {
    if (!s.performedYmd) continue;
    if (s.performedYmd < earliest || s.performedYmd > latest) continue;
    const monday = mondayOfYmd(s.performedYmd);
    const i = idxByMonday.get(monday);
    if (i == null) continue;
    // A mixed-modality session contributes to BOTH counts. That's the
    // honest reading of "what rhythm did the user live?" — they did
    // both flavours of work that day.
    if (s.isStrength) out[i]!.strengthCount += 1;
    if (s.isCardio) out[i]!.cardioCount += 1;
    if (!s.isStrength && !s.isCardio) {
      // No modality tag (legacy / empty session) — treat as strength so
      // the cell still represents "you trained", matching the heatmap
      // fallback in `training-heatmap-data.ts`.
      out[i]!.strengthCount += 1;
    }
  }

  for (const p of planned) {
    if (!p.date) continue;
    if (p.date < earliest || p.date > latest) continue;
    const monday = mondayOfYmd(p.date);
    const i = idxByMonday.get(monday);
    if (i == null) continue;
    out[i]!.plannedCount += 1;
  }

  return { weeks: out };
}

type SessionRow = { id: string; performed_at: string };
type CardioFlagRow = { session_id: string };
type SetFlagRow = { session_id: string };
type PlannedRow = {
  week_index: number;
  day_index: number;
  training_blocks:
    | { started_on: string }
    | Array<{ started_on: string }>
    | null;
};

/** Block-relative date math (mirror of `training-heatmap-data.ts`). */
function dayDateFor(startedOn: string, weekIndex: number, dayIndex: number): string {
  const startWeekday = isoWeekdayYmd(startedOn);
  const blockMonday = addDaysToYmd(startedOn, -startWeekday);
  return addDaysToYmd(blockMonday, weekIndex * 7 + dayIndex);
}

/**
 * Read-side wrapper. Three round trips:
 *   1. completed sessions in the window
 *   2. cardio_logs + set_logs (`session_id`-only) so we can stamp
 *      modality WITHOUT pulling per-set data
 *   3. planned_sessions joined with blocks for the planned bar
 *
 * Read path only — user-scoped Supabase client, `.eq("user_id", userId)`
 * on every base query (planned uses `!inner(...user_id...)`).
 */
export async function getWeeklyRhythm(
  supabase: SupabaseClient,
  userId: string,
  tz: string,
  weeks = 12,
): Promise<WeeklyRhythm> {
  const today = todayYmd(tz);
  const w = Math.max(1, Math.floor(weeks));
  const currentMonday = mondayOfYmd(today);
  const earliest = addDaysToYmd(currentMonday, -7 * (w - 1));
  // Pad both ends by a day to be safe across tz boundaries (mirrors the
  // heatmap wrapper's same trick).
  const earliestIso = `${addDaysToYmd(earliest, -1)}T00:00:00.000Z`;
  const latestIso = `${addDaysToYmd(currentMonday, 8)}T00:00:00.000Z`;

  const { data: sessionRows, error: sessionsErr } = await supabase
    .from("sessions")
    .select("id, performed_at")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .not("completed_at", "is", null)
    .gte("performed_at", earliestIso)
    .lt("performed_at", latestIso);
  if (sessionsErr) throw new Error(sessionsErr.message);
  const sessions = (sessionRows ?? []) as SessionRow[];
  const sessionIds = sessions.map((s) => s.id);

  const cardioBySession = new Set<string>();
  const strengthBySession = new Set<string>();
  if (sessionIds.length > 0) {
    const [cardioRes, setRes] = await Promise.all([
      supabase
        .from("cardio_logs")
        .select("session_id")
        .in("session_id", sessionIds),
      supabase
        .from("set_logs")
        .select("session_id")
        .in("session_id", sessionIds),
    ]);
    if (cardioRes.error) throw new Error(cardioRes.error.message);
    if (setRes.error) throw new Error(setRes.error.message);
    for (const r of (cardioRes.data ?? []) as CardioFlagRow[]) {
      cardioBySession.add(r.session_id);
    }
    for (const r of (setRes.data ?? []) as SetFlagRow[]) {
      strengthBySession.add(r.session_id);
    }
  }

  const completed: RawCompletedSession[] = sessions.map((s) => ({
    performedYmd: ymdInTimezone(new Date(s.performed_at), tz),
    isStrength: strengthBySession.has(s.id),
    isCardio: cardioBySession.has(s.id),
  }));

  const { data: plannedRows, error: plannedErr } = await supabase
    .from("planned_sessions")
    .select(
      "week_index, day_index, training_blocks!inner(started_on, deleted_at, user_id)",
    )
    .eq("training_blocks.user_id", userId)
    .is("training_blocks.deleted_at", null);
  if (plannedErr) throw new Error(plannedErr.message);
  const planned: RawPlannedSession[] = ((plannedRows ?? []) as PlannedRow[])
    .map((r) => {
      const blk = Array.isArray(r.training_blocks)
        ? r.training_blocks[0]
        : r.training_blocks;
      if (!blk?.started_on) return null;
      return { date: dayDateFor(blk.started_on, r.week_index, r.day_index) };
    })
    .filter((r): r is RawPlannedSession => r != null);

  return aggregateWeeklyRhythm(today, w, completed, planned);
}
