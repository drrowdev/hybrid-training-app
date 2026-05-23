/**
 * Training heatmap — server-side data fetcher + pure cell builder.
 *
 * Shape: a Mon→Sun × N-week grid (default 20 weeks). The grid is anchored
 * to the Monday of the current ISO week in the user's timezone and walks
 * back N-1 weeks. Columns are weeks (oldest left → newest right), rows
 * are weekdays Mon (0) … Sun (6) — exactly like GitHub's contribution
 * graph but with seven rows instead of seven columns flipped.
 *
 * Cell state precedence (highest first):
 *   1. completed sessions in that day → 'strength' | 'cardio' | 'both'
 *      ("both" = day had at least one strength signal AND at least one
 *      cardio signal — either two separate sessions or one mixed
 *      session whose movements span both modalities).
 *   2. past planned-not-done → 'missed' (includes skipped). Surfaces
 *      sessions that slipped through.
 *   3. past day inside an active block week → 'rest' (light grey).
 *      "Inside a block week" = any planned_session exists in the same
 *      ISO week; otherwise we'd paint every gap day rest even before
 *      the user ever opened the app.
 *   4. everything else → 'empty'.
 *
 * Today's cell gets `isToday: true` regardless of state (the visual
 * layer paints a ring around it).
 *
 * The pure `buildHeatmap` function is exported separately so the unit
 * tests can drive it with deterministic inputs (no Supabase mock
 * gymnastics — that's covered indirectly by the e2e seed).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  addDaysToYmd,
  isoWeekdayYmd,
  mondayOfYmd,
  todayYmd,
  ymdInTimezone,
} from "@/lib/dates";

export type CellState =
  | "empty"
  | "strength"
  | "cardio"
  | "both"
  | "rest"
  | "missed";

export type HeatmapCell = {
  /** ISO date YYYY-MM-DD (in user's timezone). */
  date: string;
  /** 0 = leftmost column (oldest week). */
  weekIndex: number;
  /** 0 = Mon … 6 = Sun. */
  dayIndex: number;
  state: CellState;
  isToday: boolean;
  isFuture: boolean;
  /** Sessions completed on this date (ids — for click-through). */
  sessionIds: string[];
  /** Short summaries for the tooltip ("Squat day", "Z2 ride · 45min"). */
  titles: string[];
};

export type RawSessionInput = {
  id: string;
  performedYmd: string;
  title: string | null;
  isStrength: boolean;
  isCardio: boolean;
  /** Optional cardio summary appended to the tooltip. */
  cardioSummary?: string | null;
};

export type RawPlannedInput = {
  date: string;
  title: string;
  completedSessionId: string | null;
  skippedAt: string | null;
};

export type BuildHeatmapInput = {
  today: string;
  weeks: number;
  sessions: RawSessionInput[];
  planned: RawPlannedInput[];
};

/**
 * Pure cell builder. Deterministic given (today, weeks, sessions,
 * planned) — the tests live on this surface.
 */
export function buildHeatmap(input: BuildHeatmapInput): HeatmapCell[] {
  const weeks = Math.max(1, Math.floor(input.weeks));
  const anchorMonday = mondayOfYmd(input.today);
  const earliest = addDaysToYmd(anchorMonday, -(weeks - 1) * 7);
  // Last cell rendered is the Sunday of the current ISO week.
  const latest = addDaysToYmd(anchorMonday, 6);

  // Index sessions by date so we resolve in O(1) per cell.
  const sessionsByDate = new Map<string, RawSessionInput[]>();
  for (const s of input.sessions) {
    if (s.performedYmd < earliest || s.performedYmd > latest) continue;
    const bucket = sessionsByDate.get(s.performedYmd);
    if (bucket) bucket.push(s);
    else sessionsByDate.set(s.performedYmd, [s]);
  }

  // Index planned by date AND by ISO-week-Monday so we can detect
  // "this day is inside a block week" without a second pass.
  const plannedByDate = new Map<string, RawPlannedInput[]>();
  const blockWeekMondays = new Set<string>();
  for (const p of input.planned) {
    if (p.date < earliest || p.date > latest) continue;
    const bucket = plannedByDate.get(p.date);
    if (bucket) bucket.push(p);
    else plannedByDate.set(p.date, [p]);
    blockWeekMondays.add(mondayOfYmd(p.date));
  }

  const cells: HeatmapCell[] = [];
  for (let w = 0; w < weeks; w++) {
    const weekMonday = addDaysToYmd(earliest, w * 7);
    for (let d = 0; d < 7; d++) {
      const date = addDaysToYmd(weekMonday, d);
      const isToday = date === input.today;
      const isFuture = date > input.today;
      const daySessions = sessionsByDate.get(date) ?? [];
      const dayPlanned = plannedByDate.get(date) ?? [];

      let hasStrength = false;
      let hasCardio = false;
      const sessionIds: string[] = [];
      const titles: string[] = [];
      for (const s of daySessions) {
        if (s.isStrength) hasStrength = true;
        if (s.isCardio) hasCardio = true;
        sessionIds.push(s.id);
        const base = s.title?.trim() || (s.isCardio && !s.isStrength ? "Cardio" : "Session");
        const summary = s.cardioSummary ? `${base} · ${s.cardioSummary}` : base;
        titles.push(summary);
      }

      let state: CellState;
      if (hasStrength && hasCardio) state = "both";
      else if (hasStrength) state = "strength";
      else if (hasCardio) state = "cardio";
      else if (
        !isFuture &&
        dayPlanned.length > 0 &&
        dayPlanned.every((p) => !p.completedSessionId)
      ) {
        // Past day with planned session(s) but nothing logged (or all
        // skipped) → missed.
        state = "missed";
        for (const p of dayPlanned) titles.push(`${p.title} (missed)`);
      } else if (
        !isFuture &&
        dayPlanned.length === 0 &&
        blockWeekMondays.has(weekMonday)
      ) {
        state = "rest";
      } else {
        state = "empty";
      }

      cells.push({
        date,
        weekIndex: w,
        dayIndex: d,
        state,
        isToday,
        isFuture,
        sessionIds,
        titles,
      });
    }
  }
  return cells;
}

/**
 * Read sessions + cardio + planned for the window and assemble the
 * grid. One round trip per table, all bounded by the 20-week window.
 *
 * Cardio detection: a session is "cardio" if it has any `cardio_logs`
 * row attached. Strength = anything else (or a session that also has
 * set_logs). We only ask `set_logs` for an existence flag per session
 * (head/count) to keep the payload tiny — the heatmap doesn't care
 * about reps/weights, only "did the session contain a lift".
 */
export async function getTrainingHeatmap(
  supabase: SupabaseClient,
  userId: string,
  tz: string,
  weeks = 20,
): Promise<HeatmapCell[]> {
  const today = todayYmd(tz);
  const anchorMonday = mondayOfYmd(today);
  const earliest = addDaysToYmd(anchorMonday, -(weeks - 1) * 7);
  // Use earliest-day-start as ISO for performed_at gte.
  const earliestIso = `${earliest}T00:00:00.000Z`;
  // Pull sessions for ±1 day of the window edges to be safe with TZ
  // shifts; the buildHeatmap filter snips back into the exact range.
  const lookbehindIso = `${addDaysToYmd(earliest, -1)}T00:00:00.000Z`;
  const lookaheadIso = `${addDaysToYmd(anchorMonday, 8)}T00:00:00.000Z`;

  const { data: sessionsRows, error: sessionsErr } = await supabase
    .from("sessions")
    .select("id, performed_at, title")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .not("completed_at", "is", null)
    .gte("performed_at", lookbehindIso)
    .lt("performed_at", lookaheadIso);
  if (sessionsErr) throw new Error(sessionsErr.message);

  const sessions = (sessionsRows ?? []) as Array<{
    id: string;
    performed_at: string;
    title: string | null;
  }>;
  const sessionIds = sessions.map((s) => s.id);

  const cardioBySession = new Map<
    string,
    { duration_sec: number | null; modality: string | null }
  >();
  const strengthSessionIds = new Set<string>();
  if (sessionIds.length > 0) {
    const [cardioRes, setRes] = await Promise.all([
      supabase
        .from("cardio_logs")
        .select("session_id, duration_sec, modality")
        .in("session_id", sessionIds),
      supabase
        .from("set_logs")
        .select("session_id")
        .in("session_id", sessionIds),
    ]);
    if (cardioRes.error) throw new Error(cardioRes.error.message);
    if (setRes.error) throw new Error(setRes.error.message);
    for (const c of cardioRes.data ?? []) {
      if (!cardioBySession.has(c.session_id)) {
        cardioBySession.set(c.session_id, {
          duration_sec: (c as { duration_sec: number | null }).duration_sec ?? null,
          modality: (c as { modality: string | null }).modality ?? null,
        });
      }
    }
    for (const r of setRes.data ?? []) {
      strengthSessionIds.add((r as { session_id: string }).session_id);
    }
  }

  const rawSessions: RawSessionInput[] = sessions.map((s) => {
    const performedYmd = ymdInTimezone(new Date(s.performed_at), tz);
    const cardio = cardioBySession.get(s.id);
    const hasCardio = cardio != null;
    const hasStrength = strengthSessionIds.has(s.id);
    // Fallback: a session with neither set_logs nor cardio_logs (e.g.
    // logged-but-empty) is treated as strength so the cell isn't
    // invisible.
    const finalStrength = hasStrength || (!hasCardio && !hasStrength);
    let cardioSummary: string | null = null;
    if (cardio) {
      const mins = cardio.duration_sec ? Math.round(cardio.duration_sec / 60) : null;
      const parts: string[] = [];
      if (cardio.modality) parts.push(cardio.modality);
      if (mins) parts.push(`${mins}min`);
      cardioSummary = parts.length ? parts.join(" · ") : null;
    }
    return {
      id: s.id,
      performedYmd,
      title: s.title,
      isStrength: finalStrength,
      isCardio: hasCardio,
      cardioSummary,
    };
  });

  // Planned: same join shape as adherence.ts so RLS + filters match.
  const { data: plannedRows, error: plannedErr } = await supabase
    .from("planned_sessions")
    .select(
      "week_index, day_index, title, completed_session_id, skipped_at, training_blocks!inner(started_on, deleted_at, user_id)",
    )
    .eq("training_blocks.user_id", userId)
    .is("training_blocks.deleted_at", null);
  if (plannedErr) throw new Error(plannedErr.message);

  type PlannedRow = {
    week_index: number;
    day_index: number;
    title: string;
    completed_session_id: string | null;
    skipped_at: string | null;
    training_blocks:
      | { started_on: string }
      | Array<{ started_on: string }>
      | null;
  };
  const rawPlanned: RawPlannedInput[] = ((plannedRows ?? []) as PlannedRow[])
    .map((r) => {
      const blk = Array.isArray(r.training_blocks)
        ? r.training_blocks[0]
        : r.training_blocks;
      if (!blk?.started_on) return null;
      const date = dayDateFor(blk.started_on, r.week_index, r.day_index);
      return {
        date,
        title: r.title,
        completedSessionId: r.completed_session_id,
        skippedAt: r.skipped_at,
      };
    })
    .filter((r): r is RawPlannedInput => r != null);

  // Avoid the unused-iso lint hit — kept for documentation/debugging.
  void earliestIso;

  return buildHeatmap({ today, weeks, sessions: rawSessions, planned: rawPlanned });
}

/** Mirror of the helper in `adherence.ts` — block-relative date math. */
function dayDateFor(startedOn: string, weekIndex: number, dayIndex: number): string {
  const startWeekday = isoWeekdayYmd(startedOn);
  const blockMonday = addDaysToYmd(startedOn, -startWeekday);
  return addDaysToYmd(blockMonday, weekIndex * 7 + dayIndex);
}
