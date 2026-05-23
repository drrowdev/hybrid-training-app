/**
 * Run-plan adherence — weekly planned vs actual cardio.
 *
 * Answers "am I sticking to the planned cardio?" by bucketing the user's
 * `planned_sessions` rows that carry cardio prescription items against
 * the matching `cardio_logs` rows on the completed session. Each weekly
 * bucket is the ISO week of `dayDate(block.started_on, week, day)`.
 *
 *   - Planned sessions: count of planned_sessions whose prescription has
 *     at least one `cardio_*` item. Volume = sum of `durationMin` across
 *     those items.
 *   - Actual sessions: distinct completed sessions covered by at least
 *     one cardio_log row. Volume = sum of `cardio_logs.duration_sec`
 *     converted to minutes.
 *
 * Pure math lives in `computeAdherence`; the server fetcher only shapes
 * Supabase rows into that input. Cards consume the returned `WeekRow[]`
 * directly.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Prescription } from "@hta/db";
import { addDaysToYmd, mondayOfYmd, todayYmd } from "@/lib/dates";
import { dayDate } from "@/lib/planner/queries";

export type PlannedCardio = {
  /** YYYY-MM-DD of the planned day. */
  date: string;
  /** Total planned cardio minutes across all `cardio_*` items in the prescription. */
  durationMin: number;
};

export type ActualCardio = {
  /** YYYY-MM-DD of the completed session. */
  date: string;
  /** Actual cardio minutes (sum across cardio_logs rows for the session). */
  durationMin: number;
};

export type WeekRow = {
  /** Monday of the ISO week as YYYY-MM-DD. */
  weekStart: string;
  plannedSessions: number;
  actualSessions: number;
  plannedMin: number;
  actualMin: number;
  /** Sessions ratio (actual / planned). Null when nothing was planned. */
  sessionsPct: number | null;
  /** Volume ratio (actual / planned). Null when nothing was planned. */
  volumePct: number | null;
};

/**
 * Bucket planned + actual cardio into weekly rows for the most recent
 * `weeks` ISO weeks ending the week of `today`. Output is oldest →
 * newest so the rendered card reads left-to-right chronologically.
 */
export function computeAdherence(
  weeks: number,
  planned: PlannedCardio[],
  actual: ActualCardio[],
  today: string,
): WeekRow[] {
  const rows: WeekRow[] = [];
  const lastMonday = mondayOfYmd(today);
  // Pre-bucket by week start.
  const plannedByWeek = new Map<string, { sessions: number; minutes: number }>();
  for (const p of planned) {
    const wk = mondayOfYmd(p.date);
    const cur = plannedByWeek.get(wk) ?? { sessions: 0, minutes: 0 };
    cur.sessions += 1;
    cur.minutes += p.durationMin;
    plannedByWeek.set(wk, cur);
  }
  const actualByWeek = new Map<string, { sessions: number; minutes: number }>();
  // Distinct sessions per week — collapse multiple cardio_logs on one date.
  const actualSeenDateByWeek = new Map<string, Set<string>>();
  for (const a of actual) {
    const wk = mondayOfYmd(a.date);
    const cur = actualByWeek.get(wk) ?? { sessions: 0, minutes: 0 };
    const seen = actualSeenDateByWeek.get(wk) ?? new Set<string>();
    if (!seen.has(a.date)) {
      cur.sessions += 1;
      seen.add(a.date);
    }
    cur.minutes += a.durationMin;
    actualByWeek.set(wk, cur);
    actualSeenDateByWeek.set(wk, seen);
  }

  for (let i = weeks - 1; i >= 0; i--) {
    const weekStart = addDaysToYmd(lastMonday, -i * 7);
    const p = plannedByWeek.get(weekStart) ?? { sessions: 0, minutes: 0 };
    const a = actualByWeek.get(weekStart) ?? { sessions: 0, minutes: 0 };
    rows.push({
      weekStart,
      plannedSessions: p.sessions,
      actualSessions: a.sessions,
      plannedMin: p.minutes,
      actualMin: a.minutes,
      sessionsPct: p.sessions === 0 ? null : a.sessions / p.sessions,
      volumePct: p.minutes === 0 ? null : a.minutes / p.minutes,
    });
  }
  return rows;
}

/** Color-coding for the actual bar based on volume completion ratio. */
export type AdherenceTone = "success" | "warning" | "danger" | "neutral";
export function toneForPct(pct: number | null): AdherenceTone {
  if (pct == null) return "neutral";
  if (pct >= 0.9) return "success";
  if (pct >= 0.7) return "warning";
  return "danger";
}

const CARDIO_KINDS = new Set([
  "cardio_z2",
  "cardio_alactic",
  "cardio_vo2",
  "cardio_threshold",
]);

function plannedCardioMinutes(prescription: Prescription | null): number {
  if (!prescription || !Array.isArray(prescription.items)) return 0;
  let total = 0;
  for (const item of prescription.items) {
    if (CARDIO_KINDS.has(item.kind) && typeof item.durationMin === "number") {
      total += item.durationMin;
    }
  }
  return total;
}

function hasCardio(prescription: Prescription | null): boolean {
  if (!prescription || !Array.isArray(prescription.items)) return false;
  return prescription.items.some((i) => CARDIO_KINDS.has(i.kind));
}

export type AdherenceData = {
  weeks: WeekRow[];
  /** True when the user has at least one active or recent training block AND a Strava connection. */
  hasPlan: boolean;
  hasStravaConnection: boolean;
};

/**
 * Server fetcher. Returns the last `weeksWindow` ISO weeks of planned
 * vs actual cardio. Strava is treated as the source of actual data —
 * `cardio_logs` rows imported with `external_source = 'strava'` count;
 * manually-logged rows also count.
 */
export async function getRunPlanAdherence(
  supabase: SupabaseClient,
  userId: string,
  tz: string,
  weeksWindow = 12,
): Promise<AdherenceData> {
  const today = todayYmd(tz);
  const earliest = addDaysToYmd(mondayOfYmd(today), -(weeksWindow - 1) * 7);

  // Pull blocks (need started_on to convert week_index/day_index → date)
  // plus their planned_sessions with prescriptions.
  const { data: blocks } = await supabase
    .from("training_blocks")
    .select(
      "id, started_on, planned_sessions(id, week_index, day_index, prescription, completed_session_id)",
    )
    .eq("user_id", userId)
    .is("deleted_at", null);

  const planned: PlannedCardio[] = [];
  for (const b of blocks ?? []) {
    const startedOn = (b as { started_on: string }).started_on;
    const ps = ((b as { planned_sessions?: Array<{ week_index: number; day_index: number; prescription: Prescription | null }> }).planned_sessions ?? []);
    for (const p of ps) {
      const minutes = plannedCardioMinutes(p.prescription);
      if (minutes === 0 && !hasCardio(p.prescription)) continue;
      const date = dayDate(startedOn, p.week_index, p.day_index);
      if (date < earliest || date > today) continue;
      planned.push({ date, durationMin: minutes });
    }
  }

  // Actual: cardio_logs joined to their session for performed_at.
  const { data: logs } = await supabase
    .from("cardio_logs")
    .select("duration_sec, session:sessions!inner(performed_at, deleted_at)")
    .eq("session.user_id", userId)
    .is("session.deleted_at", null)
    .gte("session.performed_at", `${earliest}T00:00:00Z`);

  const actual: ActualCardio[] = [];
  for (const row of logs ?? []) {
    const session = Array.isArray(row.session) ? row.session[0] : row.session;
    if (!session?.performed_at) continue;
    const date = String(session.performed_at).slice(0, 10);
    if (date < earliest || date > today) continue;
    actual.push({ date, durationMin: Math.round((row.duration_sec ?? 0) / 60) });
  }

  const { data: strava } = await supabase
    .from("strava_connections")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  return {
    weeks: computeAdherence(weeksWindow, planned, actual, today),
    hasPlan: (blocks ?? []).length > 0,
    hasStravaConnection: strava != null,
  };
}
