/**
 * DC-K1 query layer — per-user weekly recovery rollup.
 *
 * Aggregates the inputs feeding `isRecoveredWeek(week)` (from
 * `@hta/engine`) over a configurable window of ISO weeks ending at
 * the current calendar week (Monday-anchored, timezone-aware via the
 * user's profile.timezone — DST-safe because all arithmetic runs on
 * UTC YYYY-MM-DD anchors).
 *
 * What it joins (all RLS-protected; we still filter by user_id
 * explicitly for fast queries):
 *
 *   - `training_blocks`     — to resolve `planned_sessions.week_index`
 *                             + `.day_index` into a real date relative
 *                             to `started_on`.
 *   - `planned_sessions`    — counted: total, logged, skipped,
 *                             missed-past-due.
 *   - `sessions`            — non-deleted; aggregated: max sRPE,
 *                             avg fatigue, avg soreness across the
 *                             logged sessions of the week.
 *   - `set_logs`            — non-warmup; sum(weight_kg × reps) →
 *                             weekly tonnage (the volume metric
 *                             reused from `lib/stats/volume.ts`).
 *
 * "Missed past due" = planned_session whose resolved date is strictly
 * before today AND completed_session_id IS NULL AND skipped_at IS NULL.
 *
 * Block context: tagging is per user-week, NOT per block — a week can
 * span the end of one block and the start of the next; both planned
 * sessions contribute (DC-K1 is a user-level qualifier, not a
 * block-scoped one).
 *
 * Returns rows sorted desc by weekStart (most recent week first) so
 * the ceiling-base picker can take `.slice(0, 3)` of recovered weeks.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WeekRecoveryInput } from "@hta/engine";
import { addDaysToYmd, mondayOfYmd, todayYmd } from "@/lib/dates";

export type WeeklyRecoveryRow = WeekRecoveryInput & {
  /** Weekly tonnage kg (Σ weight_kg × reps across non-warmup sets, non-deleted sessions). */
  weeklyTonnageKg: number;
};

/**
 * Pure aggregator — given the raw planned/session/set rows for the
 * window, bucket them into per-week recovery rows. Exposed for
 * testing without a Supabase round-trip.
 *
 * `today` is YYYY-MM-DD in the user's timezone — used to decide
 * "missed past due". All other date math runs on the YMD anchors.
 */
export type PlannedRow = {
  user_id: string;
  week_index: number;
  day_index: number;
  completed_session_id: string | null;
  skipped_at: string | null;
  /** Block started_on YYYY-MM-DD (joined). */
  blockStartedOn: string;
};

export type SessionRow = {
  performedYmd: string;
  fatigue: number | null;
  soreness: number | null;
  session_rpe: number | null;
};

export type SetRowForWeek = {
  performedYmd: string;
  weightKg: number;
  reps: number;
};

export function aggregateWeeklyRecovery(
  planned: readonly PlannedRow[],
  sessions: readonly SessionRow[],
  sets: readonly SetRowForWeek[],
  weeks: number,
  today: string,
): WeeklyRecoveryRow[] {
  const currentMonday = mondayOfYmd(today);
  const weekStarts: string[] = [];
  for (let i = 0; i < weeks; i++) {
    weekStarts.push(addDaysToYmd(currentMonday, -7 * i));
  }
  // Map week → blank accumulator.
  type Acc = {
    weekStart: string;
    plannedSessions: number;
    loggedSessions: number;
    skippedSessions: number;
    missedSessions: number;
    rpeMax: number | null;
    fatigueSum: number;
    fatigueN: number;
    sorenessSum: number;
    sorenessN: number;
    tonnageKg: number;
  };
  const blank = (weekStart: string): Acc => ({
    weekStart,
    plannedSessions: 0,
    loggedSessions: 0,
    skippedSessions: 0,
    missedSessions: 0,
    rpeMax: null,
    fatigueSum: 0,
    fatigueN: 0,
    sorenessSum: 0,
    sorenessN: 0,
    tonnageKg: 0,
  });
  const byWeek = new Map<string, Acc>();
  for (const ws of weekStarts) byWeek.set(ws, blank(ws));

  // Planned sessions → resolve to a date, bucket by Monday-anchored week.
  for (const ps of planned) {
    const offset = ps.week_index * 7 + ps.day_index;
    const plannedYmd = addDaysToYmd(ps.blockStartedOn, offset);
    const wk = mondayOfYmd(plannedYmd);
    const acc = byWeek.get(wk);
    if (!acc) continue; // outside window
    acc.plannedSessions += 1;
    if (ps.completed_session_id != null) {
      acc.loggedSessions += 1;
    } else if (ps.skipped_at != null) {
      acc.skippedSessions += 1;
    } else if (plannedYmd < today) {
      // DC-K1 "missed past due": scheduled in the past, never logged,
      // never explicitly skipped.
      acc.missedSessions += 1;
    }
  }

  // Sessions → max sRPE, avg fatigue / soreness per week.
  for (const s of sessions) {
    const wk = mondayOfYmd(s.performedYmd);
    const acc = byWeek.get(wk);
    if (!acc) continue;
    if (s.session_rpe != null) {
      acc.rpeMax = acc.rpeMax == null ? s.session_rpe : Math.max(acc.rpeMax, s.session_rpe);
    }
    if (s.fatigue != null) {
      acc.fatigueSum += s.fatigue;
      acc.fatigueN += 1;
    }
    if (s.soreness != null) {
      acc.sorenessSum += s.soreness;
      acc.sorenessN += 1;
    }
  }

  // Set logs → weekly tonnage (volume metric, same definition as
  // `lib/stats/volume.ts`: Σ weight × reps across non-warmup sets).
  for (const set of sets) {
    const wk = mondayOfYmd(set.performedYmd);
    const acc = byWeek.get(wk);
    if (!acc) continue;
    acc.tonnageKg += set.weightKg * set.reps;
  }

  // Emit desc-sorted by weekStart. We populated in order from
  // currentMonday backwards, so the insertion order is already desc.
  return weekStarts.map((ws) => {
    const acc = byWeek.get(ws)!;
    return {
      weekStart: acc.weekStart,
      plannedSessions: acc.plannedSessions,
      loggedSessions: acc.loggedSessions,
      skippedSessions: acc.skippedSessions,
      missedSessions: acc.missedSessions,
      maxSrpe: acc.rpeMax,
      avgFatigue: acc.fatigueN === 0 ? null : acc.fatigueSum / acc.fatigueN,
      avgSoreness: acc.sorenessN === 0 ? null : acc.sorenessSum / acc.sorenessN,
      weeklyTonnageKg: acc.tonnageKg,
    } satisfies WeeklyRecoveryRow;
  });
}

/**
 * Thin I/O layer: fetch the raw rows from Supabase and feed them
 * through `aggregateWeeklyRecovery`. Defaults `weeks` to 12 (the
 * DC-K1 lookback window) and `today` to the user's local YMD.
 */
export async function getWeeklyRecoveryRollup(
  supabase: SupabaseClient,
  userId: string,
  opts?: { weeks?: number; today?: string; tz?: string },
): Promise<WeeklyRecoveryRow[]> {
  const weeks = opts?.weeks ?? 12;
  const today = opts?.today ?? todayYmd(opts?.tz);
  const earliestMonday = addDaysToYmd(mondayOfYmd(today), -7 * (weeks - 1));
  const earliestIso = `${earliestMonday}T00:00:00Z`;

  // ── planned_sessions ⨝ training_blocks ─────────────────────────
  // We need started_on to resolve week_index / day_index to a date.
  const plannedRes = await supabase
    .from("planned_sessions")
    .select(
      "week_index, day_index, completed_session_id, skipped_at, user_id, training_blocks!inner(started_on, deleted_at, user_id)",
    )
    .eq("user_id", userId)
    .eq("training_blocks.user_id", userId)
    .is("training_blocks.deleted_at", null);
  if (plannedRes.error) throw new Error(plannedRes.error.message);
  type PlannedRaw = {
    user_id: string;
    week_index: number;
    day_index: number;
    completed_session_id: string | null;
    skipped_at: string | null;
    training_blocks:
      | { started_on: string }
      | Array<{ started_on: string }>
      | null;
  };
  const planned: PlannedRow[] = ((plannedRes.data ?? []) as PlannedRaw[])
    .map((r) => {
      const tb = Array.isArray(r.training_blocks) ? r.training_blocks[0] : r.training_blocks;
      if (!tb?.started_on) return null;
      return {
        user_id: r.user_id,
        week_index: r.week_index,
        day_index: r.day_index,
        completed_session_id: r.completed_session_id,
        skipped_at: r.skipped_at,
        blockStartedOn: String(tb.started_on).slice(0, 10),
      } satisfies PlannedRow;
    })
    .filter((r): r is PlannedRow => r != null);

  // ── sessions (non-deleted) — sRPE max, fatigue/soreness averages ─
  const sessionsRes = await supabase
    .from("sessions")
    .select("performed_at, fatigue, soreness, session_rpe")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .not("completed_at", "is", null)
    .gte("performed_at", earliestIso);
  if (sessionsRes.error) throw new Error(sessionsRes.error.message);
  type SessRaw = {
    performed_at: string;
    fatigue: number | null;
    soreness: number | null;
    session_rpe: number | string | null;
  };
  const sessions: SessionRow[] = ((sessionsRes.data ?? []) as SessRaw[]).map((s) => ({
    performedYmd: String(s.performed_at).slice(0, 10),
    fatigue: s.fatigue,
    soreness: s.soreness,
    session_rpe: s.session_rpe == null ? null : Number(s.session_rpe),
  }));

  // ── set_logs ⨝ sessions (non-deleted) — tonnage by week ────────
  const setsRes = await supabase
    .from("set_logs")
    .select(
      "weight_kg, reps, set_kind, sessions!inner(performed_at, user_id, deleted_at)",
    )
    .eq("sessions.user_id", userId)
    .is("sessions.deleted_at", null)
    .neq("set_kind", "warmup")
    .not("weight_kg", "is", null)
    .not("reps", "is", null)
    .gte("sessions.performed_at", earliestIso);
  if (setsRes.error) throw new Error(setsRes.error.message);
  type SetRaw = {
    weight_kg: number | string | null;
    reps: number | null;
    set_kind: string | null;
    sessions:
      | { performed_at: string }
      | Array<{ performed_at: string }>
      | null;
  };
  const sets: SetRowForWeek[] = ((setsRes.data ?? []) as SetRaw[])
    .map((r) => {
      const s = Array.isArray(r.sessions) ? r.sessions[0] : r.sessions;
      if (!s?.performed_at) return null;
      if (r.weight_kg == null || r.reps == null) return null;
      const w = Number(r.weight_kg);
      if (!Number.isFinite(w) || w <= 0 || r.reps <= 0) return null;
      return {
        performedYmd: String(s.performed_at).slice(0, 10),
        weightKg: w,
        reps: r.reps,
      } satisfies SetRowForWeek;
    })
    .filter((r): r is SetRowForWeek => r != null);

  return aggregateWeeklyRecovery(planned, sessions, sets, weeks, today);
}
