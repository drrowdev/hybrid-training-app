/**
 * Adherence dashboard — Phase 4 detail helpers.
 *
 * Surfaces five views of the user's planned-vs-actual record:
 *   1. Weekly stacked counts (logged / skipped / missed)
 *   2. Per-weekday completion %
 *   3. Per-archetype completion %
 *   4. Recent skipped sessions with the planned title (notes-mined)
 *   5. Current + longest day streak
 *
 * Methodology decisions:
 *  - `skipped = MISSED` for any completion % we compute — pinned by the
 *    Phase 1 brief decision (see `lib/stats/adherence.ts`). The three
 *    columns are still surfaced individually for the stacked bars.
 *  - A planned session is "missed" only once its date is strictly before
 *    `today` AND it has neither `completed_session_id` nor `skipped_at`.
 *    Past-due sessions on today itself remain in a "pending" bucket so
 *    a mid-day visit to the dashboard doesn't penalise the user for a
 *    session they still intend to do. The streak helper uses the same
 *    grace period — pending-today doesn't break the run, but it also
 *    doesn't extend it (count back from yesterday until something
 *    breaks).
 *  - Skip detail rows ride on `planned_sessions.title` because there's
 *    no per-skip note column on the schema. Free-form note mining (the
 *    user wouldn't typically write a note for a session they didn't do)
 *    is intentionally deferred — the spec calls out the "without notes"
 *    fallback.
 *
 * Pure functions are exported alongside the I/O wrappers so unit tests
 * can pin the shape against fixture rows.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  addDaysToYmd,
  daysBetweenYmd,
  isoWeekdayYmd,
  mondayOfYmd,
  todayYmd,
} from "@/lib/dates";
import { archetypeDisplayName } from "@/lib/planner/queries";
import {
  summariseOverridesByWeekday,
  type WeekdayOverrideSummary,
} from "@/lib/engine/overrides";
import {
  ADHERENCE_RANGE_LABEL,
  DEFAULT_ADHERENCE_RANGE,
  adherenceRangeWindowDays,
  parseAdherenceRange,
  type AdherenceRange,
} from "./adherence-range";

// ──────────────────────────────────────────────────────────────────────
// Range — adherence uses week-units (the natural bucket here).
// Pure tokens/parsers re-exported from `./adherence-range` so client
// components can pull them without dragging server-only imports in.
// ──────────────────────────────────────────────────────────────────────

export {
  ADHERENCE_RANGE_LABEL,
  DEFAULT_ADHERENCE_RANGE,
  adherenceRangeWindowDays,
  parseAdherenceRange,
};
export type { AdherenceRange };

// ──────────────────────────────────────────────────────────────────────
// Pure types
// ──────────────────────────────────────────────────────────────────────

export type PlannedRow = {
  plannedId: string;
  blockId: string;
  archetype: string;
  /** Free-form notes column on the block (resolves the archetype display name for `custom` blocks). */
  blockNotes: string | null;
  blockStartedOn: string;
  weekIndex: number;
  dayIndex: number;
  title: string;
  completedSessionId: string | null;
  skippedAt: string | null;
};

/** Resolve the canonical date for a planned row. */
export function plannedRowDate(row: PlannedRow): string {
  const startWeekday = isoWeekdayYmd(row.blockStartedOn);
  const blockMonday = addDaysToYmd(row.blockStartedOn, -startWeekday);
  return addDaysToYmd(blockMonday, row.weekIndex * 7 + row.dayIndex);
}

export type DayStatus =
  | "logged"
  | "skipped"
  | "missed"
  | "pending"
  | "rest"
  | "future";

/** Classify a single planned row relative to `today`. */
export function classifyPlannedRow(row: PlannedRow, today: string): DayStatus {
  const date = plannedRowDate(row);
  if (date > today) return "future";
  if (row.completedSessionId) return "logged";
  if (row.skippedAt) return "skipped";
  if (date === today) return "pending";
  return "missed";
}

export type WeekBucket = {
  /** Monday (YYYY-MM-DD) of the bucket. */
  weekStart: string;
  logged: number;
  skipped: number;
  missed: number;
  /** logged / (logged + skipped + missed). 0 when total is 0. */
  percentage: number;
};

export type WeekdayBucket = {
  /** Mon=0..Sun=6. */
  weekdayIndex: number;
  weekdayLabel: string;
  logged: number;
  skipped: number;
  missed: number;
  /** logged / (logged + skipped + missed). 0 when total is 0. */
  percentage: number;
};

export type WeekdayBuckets = {
  mon: WeekdayBucket;
  tue: WeekdayBucket;
  wed: WeekdayBucket;
  thu: WeekdayBucket;
  fri: WeekdayBucket;
  sat: WeekdayBucket;
  sun: WeekdayBucket;
  totalPlanned: number;
  rangeWeeks: number;
};

export type ArchetypeBucket = {
  archetypeId: string;
  displayName: string;
  blockCount: number;
  logged: number;
  skipped: number;
  missed: number;
  percentage: number;
};

export type SkippedNote = {
  plannedId: string;
  blockId: string;
  date: string;
  archetype: string;
  archetypeDisplayName: string;
  title: string;
  note: string | null;
};

export type Streaks = {
  currentDays: number;
  longestDays: number;
};

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

function emptyWeekday(i: number): WeekdayBucket {
  return {
    weekdayIndex: i,
    weekdayLabel: WEEKDAY_LABELS[i],
    logged: 0,
    skipped: 0,
    missed: 0,
    percentage: 0,
  };
}

function pctOf(logged: number, skipped: number, missed: number): number {
  const total = logged + skipped + missed;
  if (total === 0) return 0;
  return logged / total;
}

// ──────────────────────────────────────────────────────────────────────
// Pure helpers
// ──────────────────────────────────────────────────────────────────────

/**
 * Bucket planned sessions into ISO weeks (Mon-anchored).
 *
 * `pending` rows are excluded from the week's counts on purpose — see
 * the module header for the grace-period rule. `future` rows are
 * dropped entirely.
 *
 * If `rangeStart` is provided, only weeks whose Monday is >=
 * mondayOf(rangeStart) appear. The resulting array is dense up to the
 * latest week with at least one bucket-eligible row, with zero-filled
 * intermediate weeks so a stacked bar chart renders a continuous
 * x-axis.
 */
export function computeWeeklyAdherence(
  rows: PlannedRow[],
  today: string,
  rangeStart: string | null,
): WeekBucket[] {
  const todayMonday = mondayOfYmd(today);
  const earliestMonday = rangeStart ? mondayOfYmd(rangeStart) : null;

  const map = new Map<string, { logged: number; skipped: number; missed: number }>();
  let minMonday: string | null = null;

  for (const row of rows) {
    const status = classifyPlannedRow(row, today);
    if (status === "future" || status === "pending") continue;
    const date = plannedRowDate(row);
    const monday = mondayOfYmd(date);
    if (earliestMonday && monday < earliestMonday) continue;
    if (monday > todayMonday) continue;
    let bucket = map.get(monday);
    if (!bucket) {
      bucket = { logged: 0, skipped: 0, missed: 0 };
      map.set(monday, bucket);
    }
    if (status === "logged") bucket.logged++;
    else if (status === "skipped") bucket.skipped++;
    else if (status === "missed") bucket.missed++;
    if (!minMonday || monday < minMonday) minMonday = monday;
  }

  if (!minMonday) return [];

  // Dense walk from min → today, week step.
  const out: WeekBucket[] = [];
  let cursor = minMonday;
  while (cursor <= todayMonday) {
    const b = map.get(cursor) ?? { logged: 0, skipped: 0, missed: 0 };
    out.push({
      weekStart: cursor,
      logged: b.logged,
      skipped: b.skipped,
      missed: b.missed,
      percentage: pctOf(b.logged, b.skipped, b.missed),
    });
    cursor = addDaysToYmd(cursor, 7);
  }
  return out;
}

/** Bucket planned sessions by weekday across the range. */
export function computeWeekdayAdherence(
  rows: PlannedRow[],
  today: string,
  rangeStart: string | null,
): WeekdayBuckets {
  const buckets = Array.from({ length: 7 }, (_, i) => emptyWeekday(i));
  let total = 0;
  let earliestDate: string | null = null;
  let latestDate: string | null = null;

  for (const row of rows) {
    const status = classifyPlannedRow(row, today);
    if (status === "future" || status === "pending") continue;
    const date = plannedRowDate(row);
    if (rangeStart && date < rangeStart) continue;
    if (date > today) continue;
    const wd = isoWeekdayYmd(date);
    const b = buckets[wd];
    if (status === "logged") b.logged++;
    else if (status === "skipped") b.skipped++;
    else if (status === "missed") b.missed++;
    total++;
    if (!earliestDate || date < earliestDate) earliestDate = date;
    if (!latestDate || date > latestDate) latestDate = date;
  }

  for (const b of buckets) {
    b.percentage = pctOf(b.logged, b.skipped, b.missed);
  }

  const rangeWeeks =
    earliestDate && latestDate
      ? Math.max(1, Math.ceil((daysBetweenYmd(earliestDate, latestDate) + 1) / 7))
      : 0;

  return {
    mon: buckets[0],
    tue: buckets[1],
    wed: buckets[2],
    thu: buckets[3],
    fri: buckets[4],
    sat: buckets[5],
    sun: buckets[6],
    totalPlanned: total,
    rangeWeeks,
  };
}

/** Bucket per-archetype across the range, sorted by descending block count. */
export function computeArchetypeAdherence(
  rows: PlannedRow[],
  today: string,
  rangeStart: string | null,
): ArchetypeBucket[] {
  const map = new Map<
    string,
    {
      archetypeId: string;
      displayName: string;
      blocks: Set<string>;
      logged: number;
      skipped: number;
      missed: number;
    }
  >();

  for (const row of rows) {
    const status = classifyPlannedRow(row, today);
    if (status === "future" || status === "pending") continue;
    const date = plannedRowDate(row);
    if (rangeStart && date < rangeStart) continue;
    if (date > today) continue;

    let entry = map.get(row.archetype);
    if (!entry) {
      entry = {
        archetypeId: row.archetype,
        // Defensive fallback to the slug when the archetype registry
        // doesn't recognise the id (e.g. a future archetype landed in
        // the DB before the UI shipped its label).
        displayName: archetypeDisplayName(row.archetype, row.blockNotes),
        blocks: new Set(),
        logged: 0,
        skipped: 0,
        missed: 0,
      };
      map.set(row.archetype, entry);
    }
    entry.blocks.add(row.blockId);
    if (status === "logged") entry.logged++;
    else if (status === "skipped") entry.skipped++;
    else if (status === "missed") entry.missed++;
  }

  return Array.from(map.values())
    .map((e) => ({
      archetypeId: e.archetypeId,
      displayName: e.displayName,
      blockCount: e.blocks.size,
      logged: e.logged,
      skipped: e.skipped,
      missed: e.missed,
      percentage: pctOf(e.logged, e.skipped, e.missed),
    }))
    .sort((a, b) => {
      if (b.blockCount !== a.blockCount) return b.blockCount - a.blockCount;
      return a.displayName.localeCompare(b.displayName);
    });
}

/**
 * Per-day status across the range. Used by `computeStreaks` but
 * exported so the UI / tests can introspect the underlying timeline.
 *
 * Rules:
 *   - If any planned row on `date` has `completed_session_id` set → "logged".
 *   - Else if any has `skipped_at` set → "skipped".
 *   - Else if any planned exists and `date < today` → "missed".
 *   - Else if any planned exists and `date === today` → "pending".
 *   - Else → "rest" (no planned session that day).
 */
export function buildDayStatusTimeline(
  rows: PlannedRow[],
  today: string,
  rangeStart: string,
): Array<{ date: string; status: DayStatus }> {
  const byDate = new Map<string, DayStatus>();
  for (const row of rows) {
    const date = plannedRowDate(row);
    if (date < rangeStart) continue;
    if (date > today) continue;
    // Prefer the strongest signal in priority: logged > skipped > pending > missed.
    const cur = byDate.get(date);
    if (cur === "logged") continue;
    const status = classifyPlannedRow(row, today);
    if (status === "future") continue;
    if (status === "logged") {
      byDate.set(date, "logged");
    } else if (status === "skipped") {
      byDate.set(date, "skipped");
    } else if (status === "pending") {
      if (!cur || cur === "missed") byDate.set(date, "pending");
    } else if (status === "missed") {
      if (!cur) byDate.set(date, "missed");
    }
  }

  const out: Array<{ date: string; status: DayStatus }> = [];
  let cursor = rangeStart;
  while (cursor <= today) {
    out.push({ date: cursor, status: byDate.get(cursor) ?? "rest" });
    cursor = addDaysToYmd(cursor, 1);
  }
  return out;
}

/**
 * Streak rule:
 *   - "logged" or "rest" day extends the streak.
 *   - "skipped" or "missed" day breaks the streak.
 *   - "pending" (today only, planned but not yet logged) neither
 *     extends nor breaks — we drop today and count back from
 *     yesterday. This is the mid-day grace period.
 *
 * `currentDays` is the run that ends at `today` (or yesterday when
 * today is pending). `longestDays` is the longest run anywhere in the
 * range.
 */
export function computeStreaks(
  rows: PlannedRow[],
  today: string,
  rangeStart: string,
): Streaks {
  const timeline = buildDayStatusTimeline(rows, today, rangeStart);
  if (timeline.length === 0) return { currentDays: 0, longestDays: 0 };

  // Longest streak — single pass.
  let longest = 0;
  let run = 0;
  for (const day of timeline) {
    if (day.status === "logged" || day.status === "rest") {
      run++;
      if (run > longest) longest = run;
    } else if (day.status === "pending") {
      // Pending neither breaks nor extends. Keep run as-is.
    } else {
      run = 0;
    }
  }

  // Current streak — walk backwards from today. If today is "pending",
  // start at yesterday.
  let i = timeline.length - 1;
  if (timeline[i].status === "pending") i--;
  let current = 0;
  while (i >= 0) {
    const s = timeline[i].status;
    if (s === "logged" || s === "rest") {
      current++;
      i--;
      continue;
    }
    if (s === "pending") {
      // Pending mid-stream shouldn't happen (only today can be pending),
      // but be defensive — treat it like the today grace and skip.
      i--;
      continue;
    }
    break;
  }

  return { currentDays: current, longestDays: longest };
}

// ──────────────────────────────────────────────────────────────────────
// I/O wrappers
// ──────────────────────────────────────────────────────────────────────

type PlannedRowDbShape = {
  id: string;
  block_id: string;
  week_index: number;
  day_index: number;
  title: string;
  completed_session_id: string | null;
  skipped_at: string | null;
  training_blocks:
    | { id: string; archetype: string; notes: string | null; started_on: string; deleted_at: string | null }
    | Array<{ id: string; archetype: string; notes: string | null; started_on: string; deleted_at: string | null }>
    | null;
};

/** Read every non-trashed planned_session for the user with block context. */
async function readAllPlanned(
  supabase: SupabaseClient,
  userId: string,
): Promise<PlannedRow[]> {
  const { data, error } = await supabase
    .from("planned_sessions")
    .select(
      "id, block_id, week_index, day_index, title, completed_session_id, skipped_at, training_blocks!inner(id, archetype, notes, started_on, deleted_at, user_id)",
    )
    .eq("training_blocks.user_id", userId)
    .is("training_blocks.deleted_at", null);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as PlannedRowDbShape[];
  const out: PlannedRow[] = [];
  for (const r of rows) {
    const blk = Array.isArray(r.training_blocks) ? r.training_blocks[0] : r.training_blocks;
    if (!blk?.started_on) continue;
    if (blk.deleted_at) continue;
    out.push({
      plannedId: r.id,
      blockId: r.block_id,
      archetype: blk.archetype,
      blockNotes: blk.notes,
      blockStartedOn: blk.started_on,
      weekIndex: r.week_index,
      dayIndex: r.day_index,
      title: r.title,
      completedSessionId: r.completed_session_id,
      skippedAt: r.skipped_at,
    });
  }
  return out;
}

function startOfRange(today: string, range: AdherenceRange): string | null {
  const w = adherenceRangeWindowDays(range);
  return w == null ? null : addDaysToYmd(today, -(w - 1));
}

export async function getWeeklyAdherence(
  supabase: SupabaseClient,
  userId: string,
  tz: string,
  range: AdherenceRange,
): Promise<WeekBucket[]> {
  const today = todayYmd(tz);
  const rows = await readAllPlanned(supabase, userId);
  return computeWeeklyAdherence(rows, today, startOfRange(today, range));
}

export async function getWeekdayAdherence(
  supabase: SupabaseClient,
  userId: string,
  tz: string,
  range: AdherenceRange,
): Promise<WeekdayBuckets> {
  const today = todayYmd(tz);
  const rows = await readAllPlanned(supabase, userId);
  return computeWeekdayAdherence(rows, today, startOfRange(today, range));
}

export async function getArchetypeAdherence(
  supabase: SupabaseClient,
  userId: string,
  tz: string,
  range: AdherenceRange,
): Promise<ArchetypeBucket[]> {
  const today = todayYmd(tz);
  const rows = await readAllPlanned(supabase, userId);
  return computeArchetypeAdherence(rows, today, startOfRange(today, range));
}

/**
 * Recent skipped planned sessions, newest first, with the planned
 * title surfaced and the block's notes column carried through so we
 * can resolve the archetype display name.
 *
 * The `note` field is left as `null` for now — the schema doesn't have
 * a per-skip note column. If we add one later (e.g. `planned_sessions.
 * skip_note`) this is where to wire it in.
 */
export async function getSkippedSessionNotes(
  supabase: SupabaseClient,
  userId: string,
  range: AdherenceRange,
  tz: string,
  limit = 10,
): Promise<SkippedNote[]> {
  const today = todayYmd(tz);
  const start = startOfRange(today, range);
  const rows = await readAllPlanned(supabase, userId);
  const skipped = rows
    .filter((r) => r.skippedAt != null)
    .map((r) => ({
      plannedId: r.plannedId,
      blockId: r.blockId,
      date: plannedRowDate(r),
      archetype: r.archetype,
      archetypeDisplayName: archetypeDisplayName(r.archetype, r.blockNotes),
      title: r.title,
      note: null as string | null,
    }))
    .filter((s) => (start ? s.date >= start : true) && s.date <= today)
    .sort((a, b) => b.date.localeCompare(a.date));
  return skipped.slice(0, limit);
}

export async function getStreaks(
  supabase: SupabaseClient,
  userId: string,
  tz: string,
  range: AdherenceRange,
): Promise<Streaks> {
  const today = todayYmd(tz);
  const start = startOfRange(today, range);
  const rows = await readAllPlanned(supabase, userId);
  // Streaks need an explicit start. For "all-time", anchor at the
  // earliest planned-row date in the user's history (or today if none).
  let rangeStart = start;
  if (rangeStart == null) {
    let earliest: string | null = null;
    for (const r of rows) {
      const d = plannedRowDate(r);
      if (!earliest || d < earliest) earliest = d;
    }
    rangeStart = earliest ?? today;
  }
  return computeStreaks(rows, today, rangeStart);
}

/** Combined read — used by the page so the four queries share one round trip. */
export async function getAdherenceDashboard(
  supabase: SupabaseClient,
  userId: string,
  tz: string,
  range: AdherenceRange,
): Promise<{
  weekly: WeekBucket[];
  weekday: WeekdayBuckets;
  archetypes: ArchetypeBucket[];
  skipped: SkippedNote[];
  streaks: Streaks;
  totalPlanned: number;
  /**
   * Override audit-log summary by ISO weekday across the same range.
   * Powers the "you skip 60% of Sundays" analytic surfaced next to
   * the weekday card. Wired in for first-class engine override audit
   * log (DC-K4).
   */
  overridesByWeekday: WeekdayOverrideSummary[];
}> {
  const today = todayYmd(tz);
  const start = startOfRange(today, range);
  const rows = await readAllPlanned(supabase, userId);

  // Streak anchor — see `getStreaks`.
  let streakStart = start;
  if (streakStart == null) {
    let earliest: string | null = null;
    for (const r of rows) {
      const d = plannedRowDate(r);
      if (!earliest || d < earliest) earliest = d;
    }
    streakStart = earliest ?? today;
  }

  const weekly = computeWeeklyAdherence(rows, today, start);
  const weekday = computeWeekdayAdherence(rows, today, start);
  const archetypes = computeArchetypeAdherence(rows, today, start);
  const streaks = computeStreaks(rows, today, streakStart);

  // Read reasons from the override audit log (migration 0028) so the
  // skip-notes card can finally surface free-form user notes. Falls
  // back to NULL when no audit row exists (pre-migration skips).
  const skipReasonByPlannedId = await readSkipReasons(supabase, userId);

  const skipped = rows
    .filter((r) => r.skippedAt != null)
    .map((r) => ({
      plannedId: r.plannedId,
      blockId: r.blockId,
      date: plannedRowDate(r),
      archetype: r.archetype,
      archetypeDisplayName: archetypeDisplayName(r.archetype, r.blockNotes),
      title: r.title,
      note: skipReasonByPlannedId.get(r.plannedId) ?? null,
    }))
    .filter((s) => (start ? s.date >= start : true) && s.date <= today)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 10);

  const rangeFromIso = start ? `${start}T00:00:00Z` : "1970-01-01T00:00:00Z";
  const overridesByWeekday = await summariseOverridesByWeekday(
    supabase,
    userId,
    { fromIso: rangeFromIso, toIso: `${today}T23:59:59Z` },
  );

  return {
    weekly,
    weekday,
    archetypes,
    skipped,
    streaks,
    totalPlanned: weekday.totalPlanned,
    overridesByWeekday,
  };
}

async function readSkipReasons(
  supabase: SupabaseClient,
  userId: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const { data } = await supabase
    .from("engine_override_events")
    .select("planned_session_id, reason")
    .eq("user_id", userId)
    .eq("event_type", "skip")
    .not("reason", "is", null);
  for (const r of data ?? []) {
    const id = r.planned_session_id as string | null;
    const reason = r.reason as string | null;
    if (id && reason) out.set(id, reason);
  }
  return out;
}
