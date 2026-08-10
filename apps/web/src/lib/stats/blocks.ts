/**
 * Block outcomes helpers — Phase 2 deep-dive surface.
 *
 * Every export here is bounded to a single block (or pair, for
 * `compareBlocks`) so the queries scan at most a few hundred rows.
 * The pure aggregators are exported alongside the I/O wrappers so
 * unit tests can pin the shape against fixture rows without touching
 * Supabase.
 *
 * Design rules carried over from Phase 1:
 *   - All weights persist in kg; UI converts at the read boundary
 *     (`@/lib/stats/units`).
 *   - "First heavy set" / "last heavy set" of the block mean the
 *     highest-e1RM `main`-kind set in the earliest / latest week that
 *     had a logged session for the role. This is the same conservative
 *     `bestEstimateOneRm` formula used everywhere else in the app
 *     (`@/lib/engine/one-rm`), so the block-delta number matches the
 *     in-session PR pop and the per-movement curve.
 *   - PR detection delegates to the canonical `detectPrs` in
 *     `@/lib/engine/pr`. We only count e1RM PRs for the block-summary
 *     KPI tiles since that's what the brief specifies.
 *   - "Power-emphasis comparison" matches against the user's
 *     most-recent prior block with the same archetype AND
 *     `power_emphasis = false` (the no-power-emphasis baseline). If
 *     no such block exists, the section renders solo with a note.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveLinkedSession } from "@/lib/sessions/linked-session-state";
import { addDaysToYmd, isoWeekdayYmd } from "@/lib/dates";
import { archetypeDisplayName } from "@/lib/planner/queries";
import { bestEstimateOneRm } from "@/lib/engine/one-rm";
import { detectPrs, type HistoricalSet, type PrHit } from "@/lib/engine/pr";
import type { StrengthRole } from "@/lib/planner/archetypes";

// ──────────────────────────────────────────────────────────────────────
// Pure types
// ──────────────────────────────────────────────────────────────────────

export const MAIN_LIFT_ROLES: ReadonlyArray<StrengthRole> = [
  "squat",
  "horizontal_press",
  "deadlift",
  "vertical_press",
];

export const MAIN_LIFT_LABEL: Record<StrengthRole, string> = {
  squat: "Squat",
  horizontal_press: "Bench",
  deadlift: "Deadlift",
  vertical_press: "Overhead Press",
};

export type BlockMeta = {
  id: string;
  archetype: string;
  archetypeName: string;
  /** Platform program family (e.g. "531"); NULL on legacy archetype blocks. */
  programFamily: string | null;
  status: "active" | "completed" | "archived";
  startedOn: string;
  endedOn: string | null;
  weeks: number;
  daysPerWeek: number | null;
  powerEmphasis: boolean;
  /** Mon-anchored last day in the block (inclusive). */
  lastDayYmd: string;
};

export type BlockAdherenceWeekday = {
  /** Mon=0..Sun=6. */
  weekdayIndex: number;
  weekdayLabel: string;
  scheduled: number;
  completed: number;
  ratio: number;
};

export type BlockAdherence = {
  scheduled: number;
  completed: number;
  skipped: number;
  /** Scheduled to date but not yet logged (active blocks only). */
  notYetLogged: number;
  /** Detail rows for the skipped sessions. */
  skippedDetail: Array<{
    plannedId: string;
    date: string;
    title: string;
  }>;
  weekday: BlockAdherenceWeekday[];
};

export type E1RmPoint = {
  weekIndex: number;
  sessionDate: string;
  e1rm: number;
  weight: number;
  reps: number;
};

export type BlockMainLift = {
  role: StrengthRole;
  movementId: string;
  movementDisplayName: string;
  /** Weeks (1-indexed) where the lift appeared at least once. */
  weeksAppeared: number[];
  startE1rm: number | null;
  endE1rm: number | null;
  deltaKg: number | null;
  deltaPct: number | null;
  bestPr: { hit: PrHit; date: string } | null;
  trend: E1RmPoint[];
};

export type BlockRpeCreepRow = {
  role: StrengthRole;
  /** Week-indexed avg RPE; null entries when no RPE logged that week. */
  weeklyAvgRpe: Array<number | null>;
  /** Sample prescribed intensity per week (avg %TM). null if missing. */
  weeklyPrescribedPct: Array<number | null>;
  /** True when avg RPE rose by ≥2 from first to last logged week while %TM stayed within 5%. */
  creepFlag: boolean;
};

export type BlockPowerOutcome = {
  totalAccessoriesPrescribed: number;
  totalPowerAccessoriesPrescribed: number;
  totalPowerAccessoriesPerformed: number;
  powerPrSet: { movementSlug: string; movementDisplayName: string; date: string; hit: PrHit }[];
  comparisonBlock: ComparisonBlockSummary | null;
};

export type ComparisonBlockSummary = {
  id: string;
  archetype: string;
  archetypeName: string;
  powerEmphasis: boolean;
  startedOn: string;
  endedOn: string | null;
  prCount: number;
  avgE1RmDeltaPct: number | null;
};

export type BlockWellnessAverages = {
  motivationAvg: number | null;
  fatigueAvg: number | null;
  sorenessAvg: number | null;
  motivationSeries: Array<number | null>;
  fatigueSeries: Array<number | null>;
  sorenessSeries: Array<number | null>;
};

export type BlockSummary = {
  block: BlockMeta;
  mainLifts: BlockMainLift[];
  adherence: BlockAdherence;
  rpeCreep: BlockRpeCreepRow[];
  powerOutcome: BlockPowerOutcome | null;
  wellness: BlockWellnessAverages;
  /** Total PR count from main-lift sets across the block (all kinds). */
  prCount: number;
  /** Aggregate sum of %-delta across main lifts (avg %). null if no lifts had both start+end. */
  avgE1RmDeltaPct: number | null;
};

// ──────────────────────────────────────────────────────────────────────
// Card / index shape (re-uses BlockWithCompletionStats but adds KPIs)
// ──────────────────────────────────────────────────────────────────────

export type BlockIndexRow = {
  id: string;
  archetype: string;
  archetypeName: string;
  status: "active" | "completed" | "archived";
  startedOn: string;
  endedOn: string | null;
  weeks: number;
  daysPerWeek: number | null;
  totalSessions: number;
  loggedSessions: number;
  skippedSessions: number;
  avgE1RmDeltaPct: number | null;
  prCount: number;
};

// ──────────────────────────────────────────────────────────────────────
// Pure helpers
// ──────────────────────────────────────────────────────────────────────

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

function blockLastDay(startedOn: string, weeks: number): string {
  const startWeekday = isoWeekdayYmd(startedOn);
  const blockMonday = addDaysToYmd(startedOn, -startWeekday);
  return addDaysToYmd(blockMonday, weeks * 7 - 1);
}

function dayDateFor(startedOn: string, weekIndex: number, dayIndex: number): string {
  const startWeekday = isoWeekdayYmd(startedOn);
  const blockMonday = addDaysToYmd(startedOn, -startWeekday);
  return addDaysToYmd(blockMonday, weekIndex * 7 + dayIndex);
}

/**
 * Pure adherence aggregator for one block. Mirrors the Phase 1 overview
 * aggregator (`computeAdherence`) but bucketed by weekday + with a
 * skipped-detail list so the deep-dive can expand them.
 */
export type BlockAdherenceInput = {
  today: string;
  startedOn: string;
  planned: Array<{
    plannedId: string;
    weekIndex: number;
    dayIndex: number;
    title: string;
    completedSessionId: string | null;
    skippedAt: string | null;
  }>;
};

export function computeBlockAdherence(input: BlockAdherenceInput): BlockAdherence {
  let scheduled = 0;
  let completed = 0;
  let skipped = 0;
  let notYetLogged = 0;
  const skippedDetail: BlockAdherence["skippedDetail"] = [];
  const byWeekday = new Map<number, { scheduled: number; completed: number }>();
  for (let i = 0; i < 7; i++) byWeekday.set(i, { scheduled: 0, completed: 0 });

  for (const row of input.planned) {
    const date = dayDateFor(input.startedOn, row.weekIndex, row.dayIndex);
    // Only count sessions whose date has passed (or is today).
    if (date > input.today) continue;
    scheduled++;
    const wd = isoWeekdayYmd(date);
    const wdBucket = byWeekday.get(wd)!;
    wdBucket.scheduled++;
    if (row.completedSessionId) {
      completed++;
      wdBucket.completed++;
    } else if (row.skippedAt) {
      skipped++;
      skippedDetail.push({ plannedId: row.plannedId, date, title: row.title });
    } else {
      notYetLogged++;
    }
  }

  const weekday: BlockAdherenceWeekday[] = [];
  for (let i = 0; i < 7; i++) {
    const b = byWeekday.get(i)!;
    weekday.push({
      weekdayIndex: i,
      weekdayLabel: WEEKDAY_LABELS[i],
      scheduled: b.scheduled,
      completed: b.completed,
      ratio: b.scheduled === 0 ? 0 : b.completed / b.scheduled,
    });
  }

  // Skipped detail sorted oldest-first so the expanded list reads
  // chronologically.
  skippedDetail.sort((a, b) => a.date.localeCompare(b.date));

  return { scheduled, completed, skipped, notYetLogged, skippedDetail, weekday };
}

/**
 * Pure RPE creep detector. "Creep" fires when average RPE rose ≥ 2
 * points from the first logged week to the last logged week, AND the
 * average prescribed %TM didn't go up by more than 5 percentage
 * points across the same interval (so the engine wasn't asking for it).
 */
export function computeRpeCreep(
  weeklyAvgRpe: Array<number | null>,
  weeklyPrescribedPct: Array<number | null>,
): boolean {
  const firstIdx = weeklyAvgRpe.findIndex((v) => v != null);
  const lastIdx = lastNonNullIndex(weeklyAvgRpe);
  if (firstIdx === -1 || lastIdx === -1 || firstIdx === lastIdx) return false;
  const startRpe = weeklyAvgRpe[firstIdx]!;
  const endRpe = weeklyAvgRpe[lastIdx]!;
  if (endRpe - startRpe < 2) return false;
  // Compare prescribed intensity. Tolerate missing data (assume flat).
  const startPct = weeklyPrescribedPct[firstIdx];
  const endPct = weeklyPrescribedPct[lastIdx];
  if (startPct != null && endPct != null && endPct - startPct > 5) return false;
  return true;
}

function lastNonNullIndex<T>(arr: Array<T | null>): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] != null) return i;
  }
  return -1;
}

// ──────────────────────────────────────────────────────────────────────
// I/O helpers
// ──────────────────────────────────────────────────────────────────────

type RawPlannedRow = {
  id: string;
  week_index: number;
  day_index: number;
  title: string;
  role: string | null;
  prescription: { items?: Array<Record<string, unknown>> } | null;
  completed_session_id: string | null;
  skipped_at: string | null;
  sessions:
    | { deleted_at: string | null }
    | Array<{ deleted_at: string | null }>
    | null;
};

type RawSetRow = {
  weight_kg: number | string | null;
  reps: number | null;
  rpe: number | string | null;
  set_kind: string | null;
  movement_id: string;
  session_id: string;
  performed_at: string;
};

async function fetchBlockMeta(
  supabase: SupabaseClient,
  blockId: string,
  userId: string,
): Promise<BlockMeta | null> {
  const { data } = await supabase
    .from("training_blocks")
    .select(
      "id, archetype, program_family, status, started_on, ended_at, weeks, days_per_week, power_emphasis, notes",
    )
    .eq("id", blockId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    archetype: data.archetype,
    archetypeName: archetypeDisplayName(data.archetype, data.notes ?? null),
    programFamily: (data.program_family as string | null) ?? null,
    status: data.status as BlockMeta["status"],
    startedOn: data.started_on,
    endedOn:
      data.status === "active"
        ? null
        : ((data.ended_at as string | null) ?? null),
    weeks: data.weeks,
    daysPerWeek: (data.days_per_week as number | null) ?? null,
    powerEmphasis: !!data.power_emphasis,
    lastDayYmd: blockLastDay(data.started_on, data.weeks),
  };
}

async function fetchPlannedRows(
  supabase: SupabaseClient,
  blockId: string,
): Promise<RawPlannedRow[]> {
  const { data } = await supabase
    .from("planned_sessions")
    .select(
      "id, week_index, day_index, title, role, prescription, completed_session_id, skipped_at, sessions(deleted_at)",
    )
    .eq("block_id", blockId)
    .order("week_index", { ascending: true })
    .order("day_index", { ascending: true });
  return ((data ?? []) as RawPlannedRow[]).map((row) => {
    const session = Array.isArray(row.sessions)
      ? row.sessions[0]
      : row.sessions;
    const linked = resolveLinkedSession(
      row.completed_session_id,
      session && row.completed_session_id
        ? {
            id: row.completed_session_id,
            completedAt: null,
            deletedAt: session.deleted_at,
          }
        : null,
    );
    return {
      ...row,
      completed_session_id: linked.completedSessionId,
    };
  });
}

async function fetchSetLogsForSessions(
  supabase: SupabaseClient,
  sessionIds: string[],
): Promise<RawSetRow[]> {
  if (sessionIds.length === 0) return [];
  const { data } = await supabase
    .from("set_logs")
    .select(
      "weight_kg, reps, rpe, set_kind, movement_id, session_id, sessions!inner(performed_at, deleted_at)",
    )
    .in("session_id", sessionIds)
    .is("sessions.deleted_at", null)
    .eq("skipped", false)
    .not("weight_kg", "is", null)
    .not("reps", "is", null)
    .gt("reps", 0);
  type Raw = {
    weight_kg: number | string | null;
    reps: number | null;
    rpe: number | string | null;
    set_kind: string | null;
    movement_id: string;
    session_id: string;
    sessions:
      | { performed_at: string }
      | Array<{ performed_at: string }>
      | null;
  };
  return ((data ?? []) as Raw[])
    .map((r) => {
      const s = Array.isArray(r.sessions) ? r.sessions[0] : r.sessions;
      if (!s?.performed_at) return null;
      return {
        weight_kg: r.weight_kg,
        reps: r.reps,
        rpe: r.rpe,
        set_kind: r.set_kind,
        movement_id: r.movement_id,
        session_id: r.session_id,
        performed_at: s.performed_at,
      } satisfies RawSetRow;
    })
    .filter((r): r is RawSetRow => r != null);
}

/**
 * Identify which movement_id corresponds to each main-lift role for
 * this block. A block can have only one movement per role (the user
 * picks the variant they want in the wizard), so we read the first
 * `main` item per planned session whose `role` matches and trust it.
 */
function mapRolesToMovements(planned: RawPlannedRow[]): Map<StrengthRole, string> {
  const map = new Map<StrengthRole, string>();
  for (const p of planned) {
    if (!p.role || !MAIN_LIFT_ROLES.includes(p.role as StrengthRole)) continue;
    if (map.has(p.role as StrengthRole)) continue;
    const items = p.prescription?.items ?? [];
    for (const item of items) {
      if ((item.kind as string | undefined) !== "main") continue;
      const mid = item.movementId as string | undefined;
      if (mid) {
        map.set(p.role as StrengthRole, mid);
        break;
      }
    }
  }
  return map;
}

/**
 * Compute e1RM trend (oldest-first) for one main lift in a block. One
 * point per session that logged a `main` set for the lift; the point
 * is the session's best e1RM. `bestEstimateOneRm` is used so the
 * number matches the in-session PR pop.
 */
export function buildE1RmTrend(
  sets: RawSetRow[],
  movementId: string,
  sessionToWeek: Map<string, number>,
): E1RmPoint[] {
  type Best = { weight: number; reps: number; e1rm: number; performedAt: string; weekIndex: number };
  const bySession = new Map<string, Best>();
  for (const s of sets) {
    if (s.movement_id !== movementId) continue;
    if (s.set_kind !== "main") continue;
    const weight = s.weight_kg == null ? null : Number(s.weight_kg);
    const reps = s.reps;
    if (weight == null || reps == null || reps < 1 || weight <= 0) continue;
    const e1rm = bestEstimateOneRm({
      weight,
      reps,
      rpe: s.rpe == null ? null : Number(s.rpe),
    });
    if (e1rm == null) continue;
    const existing = bySession.get(s.session_id);
    if (!existing || e1rm > existing.e1rm) {
      bySession.set(s.session_id, {
        weight,
        reps,
        e1rm,
        performedAt: s.performed_at,
        weekIndex: sessionToWeek.get(s.session_id) ?? 0,
      });
    }
  }
  return Array.from(bySession.values())
    .sort((a, b) => a.performedAt.localeCompare(b.performedAt))
    .map((b) => ({
      weekIndex: b.weekIndex,
      sessionDate: b.performedAt.slice(0, 10),
      e1rm: Math.round(b.e1rm * 10) / 10,
      weight: b.weight,
      reps: b.reps,
    }));
}

// ──────────────────────────────────────────────────────────────────────
// Exported readers
// ──────────────────────────────────────────────────────────────────────

/**
 * Per-block e1RM trend for one main-lift role. Public for the deep-dive
 * page and isolated for testability — returns one point per session in
 * the block that logged a `main` set for the role's resolved movement.
 */
export async function getBlockE1RMTrend(
  supabase: SupabaseClient,
  blockId: string,
  userId: string,
  role: StrengthRole,
): Promise<E1RmPoint[]> {
  const meta = await fetchBlockMeta(supabase, blockId, userId);
  if (!meta) return [];
  const planned = await fetchPlannedRows(supabase, blockId);
  const roleMap = mapRolesToMovements(planned);
  const movementId = roleMap.get(role);
  if (!movementId) return [];
  const sessionIds = planned
    .map((p) => p.completed_session_id)
    .filter((id): id is string => id != null);
  const sessionToWeek = new Map<string, number>();
  for (const p of planned) {
    if (p.completed_session_id) sessionToWeek.set(p.completed_session_id, p.week_index);
  }
  const sets = await fetchSetLogsForSessions(supabase, sessionIds);
  return buildE1RmTrend(sets, movementId, sessionToWeek);
}

/** Per-block adherence with weekday breakdown + skipped detail. */
export async function getBlockAdherence(
  supabase: SupabaseClient,
  blockId: string,
  userId: string,
  today: string,
): Promise<BlockAdherence | null> {
  const meta = await fetchBlockMeta(supabase, blockId, userId);
  if (!meta) return null;
  const planned = await fetchPlannedRows(supabase, blockId);
  return computeBlockAdherence({
    today,
    startedOn: meta.startedOn,
    planned: planned.map((p) => ({
      plannedId: p.id,
      weekIndex: p.week_index,
      dayIndex: p.day_index,
      title: p.title,
      completedSessionId: p.completed_session_id,
      skippedAt: p.skipped_at,
    })),
  });
}

/**
 * Per-block RPE creep — for each main lift role used in the block,
 * return the per-week avg RPE + prescribed %TM + a single boolean
 * flag indicating "creep" (see `computeRpeCreep`).
 */
export async function getBlockRpeCreep(
  supabase: SupabaseClient,
  blockId: string,
  userId: string,
): Promise<BlockRpeCreepRow[]> {
  const meta = await fetchBlockMeta(supabase, blockId, userId);
  if (!meta) return [];
  const planned = await fetchPlannedRows(supabase, blockId);
  const roleMap = mapRolesToMovements(planned);
  if (roleMap.size === 0) return [];

  const sessionToWeek = new Map<string, number>();
  for (const p of planned) {
    if (p.completed_session_id) sessionToWeek.set(p.completed_session_id, p.week_index);
  }
  const sessionIds = Array.from(sessionToWeek.keys());
  const sets = await fetchSetLogsForSessions(supabase, sessionIds);

  // Prescribed %TM per week per role: scan planned items.
  type WeeklyMeta = { rpeSum: number; rpeCount: number; pctSum: number; pctCount: number };
  const weeks = meta.weeks;
  const buckets = new Map<StrengthRole, WeeklyMeta[]>();
  for (const role of roleMap.keys()) {
    buckets.set(role, Array.from({ length: weeks }, () => ({ rpeSum: 0, rpeCount: 0, pctSum: 0, pctCount: 0 })));
  }
  // Prescribed intensity from planned items (avg of `percentTm` on main items).
  for (const p of planned) {
    const role = p.role as StrengthRole | null;
    if (!role || !buckets.has(role)) continue;
    const items = p.prescription?.items ?? [];
    for (const item of items) {
      if ((item.kind as string | undefined) !== "main") continue;
      const pct = item.percentTm as number | undefined;
      if (pct == null) continue;
      const slot = buckets.get(role)![p.week_index];
      if (!slot) continue;
      slot.pctSum += pct;
      slot.pctCount += 1;
    }
  }
  // Logged RPE from set_logs (main sets only).
  for (const s of sets) {
    if (s.set_kind !== "main") continue;
    if (s.rpe == null) continue;
    const weekIdx = sessionToWeek.get(s.session_id);
    if (weekIdx == null) continue;
    // Find which role this movement belongs to.
    let role: StrengthRole | null = null;
    for (const [r, mid] of roleMap) {
      if (mid === s.movement_id) {
        role = r;
        break;
      }
    }
    if (role == null) continue;
    const slot = buckets.get(role)![weekIdx];
    if (!slot) continue;
    slot.rpeSum += Number(s.rpe);
    slot.rpeCount += 1;
  }

  const rows: BlockRpeCreepRow[] = [];
  for (const role of MAIN_LIFT_ROLES) {
    const series = buckets.get(role);
    if (!series) continue;
    const weeklyAvgRpe = series.map((s) => (s.rpeCount === 0 ? null : s.rpeSum / s.rpeCount));
    const weeklyPrescribedPct = series.map((s) =>
      s.pctCount === 0 ? null : s.pctSum / s.pctCount,
    );
    rows.push({
      role,
      weeklyAvgRpe,
      weeklyPrescribedPct,
      creepFlag: computeRpeCreep(weeklyAvgRpe, weeklyPrescribedPct),
    });
  }
  return rows;
}

/**
 * Per-block power-emphasis outcome. Returns null when the block did
 * NOT have power_emphasis enabled — the section is gated on that.
 *
 * When the block did have it, returns:
 *   - count of power-tagged accessories prescribed vs performed
 *   - PRs hit specifically on movements with a `power_*` functionalRole
 *   - if a previous block with the same archetype but power_emphasis=
 *     false exists, a comparison summary (PRs, avg e1RM delta)
 */
export async function getBlockPowerOutcome(
  supabase: SupabaseClient,
  blockId: string,
  userId: string,
): Promise<BlockPowerOutcome | null> {
  const meta = await fetchBlockMeta(supabase, blockId, userId);
  if (!meta || !meta.powerEmphasis) return null;
  const planned = await fetchPlannedRows(supabase, blockId);

  // Collect every movement_id referenced as an accessory in the block.
  const accessoryMovementIds = new Set<string>();
  let totalAccessoriesPrescribed = 0;
  for (const p of planned) {
    const items = p.prescription?.items ?? [];
    for (const item of items) {
      const kind = item.kind as string | undefined;
      if (kind !== "accessory" && kind !== "power_potentiation") continue;
      totalAccessoriesPrescribed += 1;
      const mid = item.movementId as string | undefined;
      if (mid) accessoryMovementIds.add(mid);
    }
  }

  // Resolve which of those have a power_* functionalRole tag.
  const powerMovementIds = new Set<string>();
  if (accessoryMovementIds.size > 0) {
    const { data: mvs } = await supabase
      .from("movements")
      .select("id, slug, display_name, functional_roles")
      .in("id", Array.from(accessoryMovementIds));
    type MvRow = { id: string; slug: string; display_name: string; functional_roles: string[] | null };
    for (const m of (mvs ?? []) as MvRow[]) {
      const tags = m.functional_roles ?? [];
      if (tags.some((t) => t.startsWith("power_"))) powerMovementIds.add(m.id);
    }
  }

  // Count power accessories that were prescribed (planned) vs actually
  // logged (set_logs in completed sessions for the block).
  let totalPowerAccessoriesPrescribed = 0;
  for (const p of planned) {
    const items = p.prescription?.items ?? [];
    for (const item of items) {
      const kind = item.kind as string | undefined;
      if (kind !== "accessory" && kind !== "power_potentiation") continue;
      const mid = item.movementId as string | undefined;
      if (mid && powerMovementIds.has(mid)) totalPowerAccessoriesPrescribed += 1;
    }
  }

  const sessionIds = planned
    .map((p) => p.completed_session_id)
    .filter((id): id is string => id != null);
  const sets = await fetchSetLogsForSessions(supabase, sessionIds);
  let totalPowerAccessoriesPerformed = 0;
  for (const s of sets) {
    if (s.set_kind !== "accessory") continue;
    if (powerMovementIds.has(s.movement_id)) totalPowerAccessoriesPerformed += 1;
  }

  // PRs on power-tagged movements during the block (e1RM PRs only —
  // mirroring the Phase 1 PR card).
  const powerPrSet: BlockPowerOutcome["powerPrSet"] = [];
  if (powerMovementIds.size > 0 && sessionIds.length > 0) {
    // Pull every prior set for these movements before the block to seed
    // history for PR detection.
    const { data: priorRows } = await supabase
      .from("set_logs")
      .select(
        "movement_id, weight_kg, reps, rpe, set_kind, sessions!inner(user_id, performed_at, deleted_at)",
      )
      .in("movement_id", Array.from(powerMovementIds))
      .eq("sessions.user_id", userId)
      .is("sessions.deleted_at", null)
      .lt("sessions.performed_at", `${meta.startedOn}T00:00:00Z`)
      .eq("skipped", false)
      .neq("set_kind", "warmup")
      .not("weight_kg", "is", null)
      .not("reps", "is", null)
      .gt("reps", 0);
    type Raw = {
      movement_id: string;
      weight_kg: number | string;
      reps: number;
      rpe: number | string | null;
      sessions: { performed_at: string } | Array<{ performed_at: string }> | null;
    };
    const historyByMovement = new Map<string, HistoricalSet[]>();
    for (const r of (priorRows ?? []) as Raw[]) {
      const s = Array.isArray(r.sessions) ? r.sessions[0] : r.sessions;
      if (!s?.performed_at) continue;
      const arr = historyByMovement.get(r.movement_id) ?? [];
      arr.push({
        weight: Number(r.weight_kg),
        reps: Number(r.reps),
        rpe: r.rpe == null ? null : Number(r.rpe),
        performed_at: s.performed_at,
      });
      historyByMovement.set(r.movement_id, arr);
    }
    const mvNames = new Map<string, { slug: string; displayName: string }>();
    {
      const { data: mvs } = await supabase
        .from("movements")
        .select("id, slug, display_name")
        .in("id", Array.from(powerMovementIds));
      for (const m of (mvs ?? []) as Array<{ id: string; slug: string; display_name: string }>) {
        mvNames.set(m.id, { slug: m.slug, displayName: m.display_name });
      }
    }

    // Walk in-block sets chronologically, run detector, only collect
    // hits on power-tagged movements.
    const inBlock = sets
      .filter((s) => powerMovementIds.has(s.movement_id))
      .sort((a, b) => a.performed_at.localeCompare(b.performed_at));
    for (const s of inBlock) {
      const weight = s.weight_kg == null ? 0 : Number(s.weight_kg);
      const reps = s.reps ?? 0;
      if (weight <= 0 || reps < 1) continue;
      const history = historyByMovement.get(s.movement_id) ?? [];
      const result = detectPrs(
        { weight, reps, rpe: s.rpe == null ? null : Number(s.rpe) },
        history,
      );
      history.push({ weight, reps, rpe: s.rpe == null ? null : Number(s.rpe), performed_at: s.performed_at });
      historyByMovement.set(s.movement_id, history);
      const mv = mvNames.get(s.movement_id);
      if (!mv) continue;
      for (const hit of result.hits) {
        if (hit.kind !== "e1rm") continue;
        powerPrSet.push({
          movementSlug: mv.slug,
          movementDisplayName: mv.displayName,
          date: s.performed_at.slice(0, 10),
          hit,
        });
      }
    }
  }

  // Look for a comparable previous block: same archetype, power_emphasis
  // off, most recent before this block.
  const { data: prior } = await supabase
    .from("training_blocks")
    .select("id, archetype, started_on, ended_at, status, weeks, days_per_week, power_emphasis, notes")
    .eq("user_id", userId)
    .eq("archetype", meta.archetype)
    .eq("power_emphasis", false)
    .is("deleted_at", null)
    .lt("started_on", meta.startedOn)
    .order("started_on", { ascending: false })
    .limit(1)
    .maybeSingle();
  let comparisonBlock: ComparisonBlockSummary | null = null;
  if (prior) {
    const priorSummary = await summariseBlockForComparison(supabase, prior.id, userId);
    if (priorSummary) {
      comparisonBlock = {
        id: prior.id,
        archetype: prior.archetype,
        archetypeName: archetypeDisplayName(prior.archetype, (prior.notes as string | null) ?? null),
        powerEmphasis: !!prior.power_emphasis,
        startedOn: prior.started_on,
        endedOn:
          prior.status === "active"
            ? null
            : ((prior.ended_at as string | null) ?? null),
        prCount: priorSummary.prCount,
        avgE1RmDeltaPct: priorSummary.avgE1RmDeltaPct,
      };
    }
  }

  return {
    totalAccessoriesPrescribed,
    totalPowerAccessoriesPrescribed,
    totalPowerAccessoriesPerformed,
    powerPrSet,
    comparisonBlock,
  };
}

/**
 * Wellness averages during the block's calendar window.
 *
 *  - motivation from `wellness` (one row per date)
 *  - fatigue / soreness from session pre-check-ins (one per session,
 *    1–5 scale, DC-P1)
 *
 * Sleep was previously read from `wellness.sleep_hours` here; the
 * manual-sleep walk-back deferred that to the future health-app
 * integration so it's been dropped from the response shape.
 *
 * Series are per-week values (oldest-first), null when the week had
 * no signal — feeds the per-tile sparkline.
 */
export async function getBlockWellnessAverages(
  supabase: SupabaseClient,
  blockId: string,
  userId: string,
  today: string,
): Promise<BlockWellnessAverages | null> {
  const meta = await fetchBlockMeta(supabase, blockId, userId);
  if (!meta) return null;
  const startedOn = meta.startedOn;
  // Bound on whichever is earlier: block end or today (active blocks).
  const endBound = meta.lastDayYmd < today ? meta.lastDayYmd : today;

  // Wellness: motivation by date.
  const { data: wellnessRows } = await supabase
    .from("wellness")
    .select("date, motivation")
    .eq("user_id", userId)
    .gte("date", startedOn)
    .lte("date", endBound);
  type WRow = { date: string; motivation: number | null };

  // Sessions: fatigue + soreness with performed_at.
  const { data: sessionRows } = await supabase
    .from("sessions")
    .select("performed_at, fatigue, soreness")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .gte("performed_at", `${startedOn}T00:00:00Z`)
    .lte("performed_at", `${endBound}T23:59:59Z`);
  type SRow = { performed_at: string; fatigue: number | null; soreness: number | null };

  const weeks = meta.weeks;
  const motivBuckets = Array.from({ length: weeks }, () => ({ sum: 0, n: 0 }));
  const fatigueBuckets = Array.from({ length: weeks }, () => ({ sum: 0, n: 0 }));
  const sorenessBuckets = Array.from({ length: weeks }, () => ({ sum: 0, n: 0 }));

  function bucketIndex(dateYmd: string): number {
    const startWeekday = isoWeekdayYmd(startedOn);
    const blockMonday = addDaysToYmd(startedOn, -startWeekday);
    // Days since block Monday.
    const a = parseUtc(blockMonday);
    const b = parseUtc(dateYmd);
    const days = Math.round((b - a) / 86_400_000);
    if (days < 0) return -1;
    const w = Math.floor(days / 7);
    if (w >= weeks) return -1;
    return w;
  }

  for (const r of (wellnessRows ?? []) as WRow[]) {
    const w = bucketIndex(r.date);
    if (w < 0) continue;
    if (r.motivation != null) {
      motivBuckets[w].sum += r.motivation;
      motivBuckets[w].n += 1;
    }
  }
  for (const r of (sessionRows ?? []) as SRow[]) {
    const ymd = r.performed_at.slice(0, 10);
    const w = bucketIndex(ymd);
    if (w < 0) continue;
    if (r.fatigue != null) {
      fatigueBuckets[w].sum += r.fatigue;
      fatigueBuckets[w].n += 1;
    }
    if (r.soreness != null) {
      sorenessBuckets[w].sum += r.soreness;
      sorenessBuckets[w].n += 1;
    }
  }

  function avg(buckets: Array<{ sum: number; n: number }>): number | null {
    let s = 0;
    let n = 0;
    for (const b of buckets) {
      s += b.sum;
      n += b.n;
    }
    return n === 0 ? null : Math.round((s / n) * 10) / 10;
  }
  function series(buckets: Array<{ sum: number; n: number }>): Array<number | null> {
    return buckets.map((b) => (b.n === 0 ? null : Math.round((b.sum / b.n) * 10) / 10));
  }

  return {
    motivationAvg: avg(motivBuckets),
    fatigueAvg: avg(fatigueBuckets),
    sorenessAvg: avg(sorenessBuckets),
    motivationSeries: series(motivBuckets),
    fatigueSeries: series(fatigueBuckets),
    sorenessSeries: series(sorenessBuckets),
  };
}

function parseUtc(ymd: string): number {
  return Date.UTC(
    Number(ymd.slice(0, 4)),
    Number(ymd.slice(5, 7)) - 1,
    Number(ymd.slice(8, 10)),
  );
}

// ──────────────────────────────────────────────────────────────────────
// Block summary + comparison
// ──────────────────────────────────────────────────────────────────────

async function buildMainLifts(
  supabase: SupabaseClient,
  meta: BlockMeta,
  userId: string,
  planned: RawPlannedRow[],
): Promise<BlockMainLift[]> {
  const roleMap = mapRolesToMovements(planned);
  if (roleMap.size === 0) return [];

  // Sessions and week index map.
  const sessionToWeek = new Map<string, number>();
  for (const p of planned) {
    if (p.completed_session_id) sessionToWeek.set(p.completed_session_id, p.week_index);
  }
  const sessionIds = Array.from(sessionToWeek.keys());
  const sets = await fetchSetLogsForSessions(supabase, sessionIds);

  // Movement names.
  const movementIds = Array.from(roleMap.values());
  const mvNames = new Map<string, string>();
  if (movementIds.length > 0) {
    const { data } = await supabase
      .from("movements")
      .select("id, display_name")
      .in("id", movementIds);
    for (const m of (data ?? []) as Array<{ id: string; display_name: string }>) {
      mvNames.set(m.id, m.display_name);
    }
  }

  // Prior history for PR detection — every set BEFORE the block, used to
  // seed `detectPrs` so the first set of the block isn't auto-PR'd.
  const historyByMovement = new Map<string, HistoricalSet[]>();
  if (movementIds.length > 0) {
    const { data: prior } = await supabase
      .from("set_logs")
      .select(
        "movement_id, weight_kg, reps, rpe, set_kind, sessions!inner(user_id, performed_at, deleted_at)",
      )
      .in("movement_id", movementIds)
      .eq("sessions.user_id", userId)
      .is("sessions.deleted_at", null)
      .lt("sessions.performed_at", `${meta.startedOn}T00:00:00Z`)
      .eq("skipped", false)
      .neq("set_kind", "warmup")
      .not("weight_kg", "is", null)
      .not("reps", "is", null)
      .gt("reps", 0);
    type Raw = {
      movement_id: string;
      weight_kg: number | string;
      reps: number;
      rpe: number | string | null;
      sessions: { performed_at: string } | Array<{ performed_at: string }> | null;
    };
    for (const r of (prior ?? []) as Raw[]) {
      const s = Array.isArray(r.sessions) ? r.sessions[0] : r.sessions;
      if (!s?.performed_at) continue;
      const arr = historyByMovement.get(r.movement_id) ?? [];
      arr.push({
        weight: Number(r.weight_kg),
        reps: Number(r.reps),
        rpe: r.rpe == null ? null : Number(r.rpe),
        performed_at: s.performed_at,
      });
      historyByMovement.set(r.movement_id, arr);
    }
  }

  const result: BlockMainLift[] = [];
  for (const role of MAIN_LIFT_ROLES) {
    const movementId = roleMap.get(role);
    if (!movementId) continue;
    const trend = buildE1RmTrend(sets, movementId, sessionToWeek);
    const weeksAppeared = Array.from(
      new Set(planned.filter((p) => p.role === role && p.completed_session_id).map((p) => p.week_index + 1)),
    ).sort((a, b) => a - b);

    const startE1rm = trend.length > 0 ? trend[0].e1rm : null;
    const endE1rm = trend.length > 0 ? trend[trend.length - 1].e1rm : null;
    const deltaKg =
      startE1rm != null && endE1rm != null
        ? Math.round((endE1rm - startE1rm) * 10) / 10
        : null;
    const deltaPct =
      startE1rm != null && endE1rm != null && startE1rm > 0
        ? Math.round(((endE1rm - startE1rm) / startE1rm) * 1000) / 10
        : null;

    // Best PR in the block — walk in chronological order with the
    // prior history seeded so it matches the canonical PR pop.
    const history = (historyByMovement.get(movementId) ?? []).slice();
    let bestPr: { hit: PrHit; date: string } | null = null;
    const inBlock = sets
      .filter((s) => s.movement_id === movementId && s.set_kind === "main")
      .sort((a, b) => a.performed_at.localeCompare(b.performed_at));
    for (const s of inBlock) {
      const weight = s.weight_kg == null ? 0 : Number(s.weight_kg);
      const reps = s.reps ?? 0;
      if (weight <= 0 || reps < 1) continue;
      const res = detectPrs(
        { weight, reps, rpe: s.rpe == null ? null : Number(s.rpe) },
        history,
      );
      history.push({ weight, reps, rpe: s.rpe == null ? null : Number(s.rpe), performed_at: s.performed_at });
      for (const hit of res.hits) {
        if (hit.kind !== "e1rm") continue;
        if (!bestPr || hit.value > bestPr.hit.value) {
          bestPr = { hit, date: s.performed_at.slice(0, 10) };
        }
      }
    }

    result.push({
      role,
      movementId,
      movementDisplayName: mvNames.get(movementId) ?? role,
      weeksAppeared,
      startE1rm,
      endE1rm,
      deltaKg,
      deltaPct,
      bestPr,
      trend,
    });
  }
  return result;
}

/**
 * Lightweight comparison summary used by `getBlockPowerOutcome` and
 * `compareBlocks`. Computes PR count and avg e1RM delta only — keeps
 * the round-trip small.
 */
async function summariseBlockForComparison(
  supabase: SupabaseClient,
  blockId: string,
  userId: string,
): Promise<{ prCount: number; avgE1RmDeltaPct: number | null } | null> {
  const meta = await fetchBlockMeta(supabase, blockId, userId);
  if (!meta) return null;
  const planned = await fetchPlannedRows(supabase, blockId);
  const lifts = await buildMainLifts(supabase, meta, userId, planned);

  const deltas = lifts
    .map((l) => l.deltaPct)
    .filter((d): d is number => d != null);
  const avgE1RmDeltaPct =
    deltas.length === 0
      ? null
      : Math.round((deltas.reduce((a, b) => a + b, 0) / deltas.length) * 10) / 10;
  const prCount = lifts.reduce((acc, l) => acc + (l.bestPr ? 1 : 0), 0);
  return { prCount, avgE1RmDeltaPct };
}

/** Whole-page summary for `/app/stats/blocks/[id]`. */
export async function getBlockSummary(
  supabase: SupabaseClient,
  blockId: string,
  userId: string,
  today: string,
): Promise<BlockSummary | null> {
  const meta = await fetchBlockMeta(supabase, blockId, userId);
  if (!meta) return null;
  const planned = await fetchPlannedRows(supabase, blockId);

  const [mainLifts, adherence, rpeCreep, powerOutcome, wellness] = await Promise.all([
    buildMainLifts(supabase, meta, userId, planned),
    Promise.resolve(
      computeBlockAdherence({
        today,
        startedOn: meta.startedOn,
        planned: planned.map((p) => ({
          plannedId: p.id,
          weekIndex: p.week_index,
          dayIndex: p.day_index,
          title: p.title,
          completedSessionId: p.completed_session_id,
          skippedAt: p.skipped_at,
        })),
      }),
    ),
    getBlockRpeCreep(supabase, blockId, userId),
    getBlockPowerOutcome(supabase, blockId, userId),
    getBlockWellnessAverages(supabase, blockId, userId, today),
  ]);

  const deltas = mainLifts.map((l) => l.deltaPct).filter((d): d is number => d != null);
  const avgE1RmDeltaPct =
    deltas.length === 0
      ? null
      : Math.round((deltas.reduce((a, b) => a + b, 0) / deltas.length) * 10) / 10;
  const prCount = mainLifts.reduce((acc, l) => acc + (l.bestPr ? 1 : 0), 0);

  return {
    block: meta,
    mainLifts,
    adherence,
    rpeCreep,
    powerOutcome,
    wellness: wellness ?? {
      motivationAvg: null,
      fatigueAvg: null,
      sorenessAvg: null,
      motivationSeries: [],
      fatigueSeries: [],
      sorenessSeries: [],
    },
    prCount,
    avgE1RmDeltaPct,
  };
}

export type BlockComparison = {
  a: BlockSummary;
  b: BlockSummary;
  sameArchetype: boolean;
};

/**
 * Side-by-side comparison of two blocks. Each side reuses
 * `getBlockSummary` so the data shapes line up — the UI does the
 * "this beats that" rendering. `sameArchetype` flags when the user is
 * comparing apples-to-oranges so the UI can render a soft warning.
 */
export async function compareBlocks(
  supabase: SupabaseClient,
  blockIdA: string,
  blockIdB: string,
  userId: string,
  today: string,
): Promise<BlockComparison | null> {
  const [a, b] = await Promise.all([
    getBlockSummary(supabase, blockIdA, userId, today),
    getBlockSummary(supabase, blockIdB, userId, today),
  ]);
  if (!a || !b) return null;
  // Compare program identity: program family for platform blocks (both NULL
  // archetype), archetype slug for legacy blocks. Without this, two different
  // platform programs (e.g. 5/3/1 vs TB) would both read archetype=NULL and be
  // wrongly flagged as the "same" program, suppressing the apples-to-oranges
  // warning.
  const idA = a.block.programFamily ?? a.block.archetype;
  const idB = b.block.programFamily ?? b.block.archetype;
  return { a, b, sameArchetype: idA === idB };
}

// ──────────────────────────────────────────────────────────────────────
// Index page (list of all blocks with KPIs)
// ──────────────────────────────────────────────────────────────────────

/**
 * List of all user blocks (deleted_at IS NULL), each enriched with the
 * Phase 2 KPI tile values: avg e1RM delta, PR count.
 *
 * We reuse `getAllBlocksWithCompletionStats` for the heavy lifting and
 * compute KPIs per block in parallel. Cost is bounded by the page size
 * (default 20) — well below the I/O budget for the dashboard.
 *
 * The avg-sleep KPI was removed in fix/sleep-walkback (manual sleep
 * deferred to health-integration). The wellness.sleep_hours column
 * remains; we just don't surface it.
 */
export async function getBlockIndex(
  supabase: SupabaseClient,
  userId: string,
  // _today kept for API compatibility; sleep-window read that used it was
  // removed in fix/sleep-walkback.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _today: string,
): Promise<BlockIndexRow[]> {
  const { data: blocks } = await supabase
    .from("training_blocks")
    .select(
      "id, archetype, started_on, status, weeks, days_per_week, notes, ended_at, planned_sessions(id, completed_session_id, skipped_at, week_index, day_index, sessions(deleted_at))",
    )
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("started_on", { ascending: false })
    .limit(50);
  if (!blocks) return [];

  return Promise.all(
    blocks.map(async (b) => {
      const planned = (b.planned_sessions ?? []) as Array<{
        id: string;
        completed_session_id: string | null;
        skipped_at: string | null;
        week_index: number;
        day_index: number;
        sessions:
          | { deleted_at: string | null }
          | Array<{ deleted_at: string | null }>
          | null;
      }>;
      const totalSessions = planned.length;
      let loggedSessions = 0;
      let skippedSessions = 0;
      for (const p of planned) {
        const session = Array.isArray(p.sessions)
          ? p.sessions[0]
          : p.sessions;
        const linked = resolveLinkedSession(
          p.completed_session_id,
          session && p.completed_session_id
            ? {
                id: p.completed_session_id,
                completedAt: null,
                deletedAt: session.deleted_at,
              }
            : null,
        );
        if (linked.completedSessionId) loggedSessions++;
        else if (p.skipped_at) skippedSessions++;
      }
      const summary = await summariseBlockForComparison(supabase, b.id, userId);

      const status = b.status as BlockIndexRow["status"];
      return {
        id: b.id,
        archetype: b.archetype,
        archetypeName: archetypeDisplayName(b.archetype, (b.notes as string | null) ?? null),
        status,
        startedOn: b.started_on,
        endedOn: status === "active" ? null : ((b.ended_at as string | null) ?? null),
        weeks: b.weeks,
        daysPerWeek: (b.days_per_week as number | null) ?? null,
        totalSessions,
        loggedSessions,
        skippedSessions,
        avgE1RmDeltaPct: summary?.avgE1RmDeltaPct ?? null,
        prCount: summary?.prCount ?? 0,
      } satisfies BlockIndexRow;
    }),
  );
}
