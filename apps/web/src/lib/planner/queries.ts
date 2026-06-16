/**
 * Queries for the planner UI.
 */
import { createClient, getAuthUser } from "@/lib/supabase/server";
import type { Prescription, SessionSlot } from "@hta/db";
import {
  addDaysToYmd,
  isoWeekdayYmd,
  todayYmd as todayYmdImpl,
  ymdInTimezone as ymdInTimezoneImpl,
} from "@/lib/dates";
import { ARCHETYPES, type ArchetypeId } from "./archetypes";
import { applyAutoregVolumeScale } from "./autoreg-volume";
import {
  applyModificationsToPrescription,
  getActiveModificationRows,
  resolveModificationsForDate,
} from "./modifications";
import {
  applySupersetPairing,
  getSupersetAccessoriesPref,
  loadPrimaryMusclesByMovementId,
  resolverFromMap,
} from "./superset-view";

/**
 * Resolve a block's `archetype` column to the human-facing display name.
 *
 * Lives server-side so we don't ship the whole `ARCHETYPES` registry to
 * the browser. For `custom` blocks the user-supplied name lives in
 * `training_blocks.notes` — fall through to that, or to the literal
 * "Custom block" if unset. Unknown archetype slugs fall back to the slug
 * itself rather than throwing so a future archetype id can't silently
 * crash the planner UI.
 */
export function archetypeDisplayName(
  archetype: string | null,
  notes?: string | null,
): string {
  // Platform-program blocks leave archetype NULL (migration 0103) and carry a
  // brand-neutral label in notes; archetype blocks keep their slug.
  if (archetype == null || archetype.startsWith("program:")) {
    return notes?.trim() || "Training block";
  }
  if (archetype === "custom") return notes?.trim() || "Custom block";
  const a = ARCHETYPES[archetype as Exclude<ArchetypeId, "custom">];
  return a?.name ?? archetype;
}

// Re-exports for back-compat: these helpers used to live in this module.
// New code should import from "@/lib/dates" directly.
export const todayYmd = todayYmdImpl;
export const ymdInTimezone = ymdInTimezoneImpl;

export type ActiveBlock = {
  id: string;
  archetype: string;
  startedOn: string;
  weeks: number;
  status: "active" | "completed" | "archived";
  notes: string | null;
  /** Engine family (e.g. "531", "tactical-barbell", "tactical-barbell-green",
   * "hybrid"). Drives program-aware copy — 5/3/1 calls a training block a
   * "cycle"; Tactical Barbell / Green Protocol call it a "block". */
  programFamily: string | null;
  /** Migration 0079 — per-block focus muscle groups (0–2). */
  focusMuscles: string[];
  /** Wizard step-2 power emphasis toggle (already on the row). */
  powerEmphasis: boolean;
};

export type PlannedDay = {
  id: string;
  blockId: string;
  weekIndex: number;
  dayIndex: number;
  /** Two-a-day slot. "single" = legacy one-session day. */
  slot: SessionSlot;
  /** Explicit planned start time, or null when planner defers to profile AM/PM window. */
  plannedAt: string | null;
  title: string;
  role: string;
  prescription: Prescription;
  /** Session linked to this planned day (set on START — presence ≠ done). */
  completedSessionId: string | null;
  /** When the linked session was actually finished. null = started-but-not-done. */
  completedAt: string | null;
  skippedAt: string | null;
  /** Drawer notes — see migration 0055 / `hybrid-sync-audit.md` §3a. */
  notes: string | null;
  /** Absolute calendar date this day falls on (derived from block start + week + day). */
  date: string;
};

/**
 * Pure YYYY-MM-DD arithmetic. Anchored in UTC internally so the math is
 * timezone-free — see `lib/dates.ts` for the shared primitives. The
 * thin wrappers below remain here because they're planner-internal.
 */
function addDays(iso: string, days: number): string {
  return addDaysToYmd(iso, days);
}

/** Mon=0 ... Sun=6 from a YYYY-MM-DD date string. */
function isoWeekday(iso: string): number {
  return isoWeekdayYmd(iso);
}

/**
 * Today as YYYY-MM-DD in the given timezone. See `lib/dates.ts` for the
 * canonical implementation — exported above as a re-export.
 */

/** Read the current user's profile timezone. Falls back to "UTC". */
export async function getUserTimezone(userId?: string): Promise<string> {
  const supabase = await createClient();
  let id = userId;
  if (!id) {
    const {
      data: { user },
    } = await getAuthUser();
    if (!user) return "UTC";
    id = user.id;
  }
  const { data } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("id", id)
    .maybeSingle();
  return data?.timezone ?? "UTC";
}

/** Date for week i, day j of a block that started on `startedOn` (snapping start to Monday of that week). */
export function dayDate(startedOn: string, weekIndex: number, dayIndex: number): string {
  const startWeekday = isoWeekday(startedOn);
  const blockMonday = addDays(startedOn, -startWeekday);
  return addDays(blockMonday, weekIndex * 7 + dayIndex);
}

export async function getActiveBlock(): Promise<ActiveBlock | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("training_blocks")
    .select("id, archetype, started_on, weeks, status, notes, program_family, focus_muscles, power_emphasis")
    .eq("status", "active")
    .is("deleted_at", null)
    .order("started_on", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    archetype: data.archetype,
    startedOn: data.started_on,
    weeks: data.weeks,
    status: data.status,
    notes: data.notes ?? null,
    programFamily: (data as { program_family?: string | null }).program_family ?? null,
    focusMuscles: Array.isArray(data.focus_muscles)
      ? (data.focus_muscles as string[])
      : [],
    powerEmphasis: Boolean(data.power_emphasis),
  };
}

export async function getPlannedDays(blockId: string, startedOn: string): Promise<PlannedDay[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  const modRows = user ? await getActiveModificationRows(user.id) : [];
  const { data } = await supabase
    .from("planned_sessions")
    .select(
      "id, block_id, week_index, day_index, slot, planned_at, title, role, prescription, completed_session_id, skipped_at, notes, training_blocks!inner(superset_accessories)",
    )
    .eq("block_id", blockId)
    .order("week_index", { ascending: true })
    .order("day_index", { ascending: true })
    .order("slot", { ascending: true });
  if (!data) return [];

  // `completed_session_id` is set when a planned session is STARTED (see
  // startSessionDirect), so its presence only means "linked / in-progress".
  // Resolve the linked sessions' `completed_at` so callers can tell a truly
  // finished day from one that was merely opened.
  const linkedIds = Array.from(
    new Set(
      data
        .map((d) => d.completed_session_id as string | null)
        .filter((x): x is string => !!x),
    ),
  );
  const completedAtById = new Map<string, string | null>();
  if (linkedIds.length > 0) {
    const { data: linkedSessions } = await supabase
      .from("sessions")
      .select("id, completed_at")
      .in("id", linkedIds);
    for (const s of linkedSessions ?? []) {
      completedAtById.set(s.id as string, (s.completed_at as string | null) ?? null);
    }
  }

  const days = data.map((d) => {
    const date = dayDate(startedOn, d.week_index, d.day_index);
    const base = applyAutoregVolumeScale(
      (d.prescription as Prescription) ?? { items: [] },
    );
    const prescription = applyModificationsToPrescription(
      base,
      resolveModificationsForDate(modRows, date),
    );
    return {
      id: d.id,
      blockId: d.block_id,
      weekIndex: d.week_index,
      dayIndex: d.day_index,
      slot: (d.slot as SessionSlot) ?? "single",
      plannedAt: d.planned_at ?? null,
      title: d.title,
      role: d.role,
      prescription,
      completedSessionId: d.completed_session_id,
      completedAt: d.completed_session_id
        ? completedAtById.get(d.completed_session_id) ?? null
        : null,
      skippedAt: d.skipped_at,
      notes: (d.notes as string | null) ?? null,
      date,
    };
  });

  // ADR 0026 P4 — antagonist-superset pairing is a read-time presentation
  // layer applied AFTER autoreg + modifications. Migration 0111 moves the gate
  // from a single profile pref to a PER-BLOCK choice: each day uses its own
  // block's `superset_accessories`; null falls back to the profile pref. `??`
  // (not `||`) lets an explicit per-block `false` override a profile `true`.
  // Resolve PER DAY (days may span multiple blocks). Off (resolved false) -> no
  // pairing, no muscle query, byte-identical prescription. If NO day is
  // superset-on we return early, byte-identical to the pre-0111 behaviour.
  let profilePref: boolean | null = null;
  const readProfilePref = async (): Promise<boolean> => {
    if (profilePref === null) {
      profilePref = user
        ? await getSupersetAccessoriesPref(supabase, user.id)
        : false;
    }
    return profilePref;
  };
  const resolvedFlags: boolean[] = [];
  let anySupersetOn = false;
  for (const d of data) {
    const blockRel = (d as { training_blocks?: unknown }).training_blocks;
    const block = (Array.isArray(blockRel) ? blockRel[0] : blockRel) as
      | { superset_accessories?: boolean | null }
      | null
      | undefined;
    const blockSuperset = block?.superset_accessories ?? null;
    const on = blockSuperset ?? (await readProfilePref());
    resolvedFlags.push(on);
    if (on) anySupersetOn = true;
  }
  if (!anySupersetOn) return days;
  // Only resolve muscles for the movements present on superset-on days — the
  // off days never touch the catalog, so they stay byte-identical.
  const movementIds = days
    .filter((_, i) => resolvedFlags[i])
    .flatMap((d) => (d.prescription.items ?? []).map((it) => it.movementId));
  const muscleMap = await loadPrimaryMusclesByMovementId(supabase, movementIds);
  const resolve = resolverFromMap(muscleMap);
  return days.map((d, i) =>
    resolvedFlags[i]
      ? { ...d, prescription: applySupersetPairing(d.prescription, true, resolve) }
      : d,
  );
}

/**
 * Regex matching a v4-style lowercase UUID. Shared between the
 * `/app/sessions/start/[plannedId]` route and the
 * `/app/plan/preview/[plannedId]` route so a hand-typed or fuzzed id
 * is rejected at the route boundary before we ever hit the DB.
 */
export const PLANNED_ID_REGEX = /^[0-9a-f-]{36}$/i;

/**
 * Load a single planned session by id, scoped to the authenticated
 * user via Supabase RLS. Returns null when the row doesn't exist or
 * isn't visible to the caller — both cases should map to `notFound()`
 * at the route level. Includes the parent block's archetype + start
 * date so callers can render the eyebrow ("ARCHETYPE · WEEK N ·
 * DATE") without a second round-trip.
 */
export type PlannedSessionWithBlock = PlannedDay & {
  archetype: string;
  archetypeName: string;
  blockStartedOn: string;
};

export async function getPlannedSessionById(
  plannedId: string,
): Promise<PlannedSessionWithBlock | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  const { data } = await supabase
    .from("planned_sessions")
    .select(
      "id, block_id, week_index, day_index, slot, planned_at, title, role, prescription, completed_session_id, skipped_at, notes, training_blocks!inner(archetype, started_on, notes, superset_accessories)",
    )
    .eq("id", plannedId)
    .maybeSingle();
  if (!data) return null;
  const blockRel = data.training_blocks as
    | { archetype: string; started_on: string; notes: string | null; superset_accessories: boolean | null }
    | { archetype: string; started_on: string; notes: string | null; superset_accessories: boolean | null }[]
    | null;
  const block = Array.isArray(blockRel) ? blockRel[0] : blockRel;
  if (!block) return null;
  const date = dayDate(block.started_on, data.week_index, data.day_index);
  const base = applyAutoregVolumeScale(
    (data.prescription as Prescription) ?? { items: [] },
  );
  const modRows = user ? await getActiveModificationRows(user.id) : [];
  const modified = applyModificationsToPrescription(
    base,
    resolveModificationsForDate(modRows, date),
  );
  // ADR 0026 P4 — read-time superset pairing after autoreg + modifications.
  // Migration 0111: the per-block `superset_accessories` value WINS; null falls
  // back to the profile pref. `??` (not `||`) lets an explicit per-block `false`
  // override a profile `true`. The profile pref is only queried when the block
  // value is null (avoids a needless query when the block has an explicit value).
  let prescription = modified;
  const supersetOn =
    block.superset_accessories ??
    (user ? await getSupersetAccessoriesPref(supabase, user.id) : false);
  if (supersetOn) {
    const muscleMap = await loadPrimaryMusclesByMovementId(
      supabase,
      (modified.items ?? []).map((it) => it.movementId),
    );
    prescription = applySupersetPairing(
      modified,
      true,
      resolverFromMap(muscleMap),
    );
  }
  let completedAt: string | null = null;
  if (data.completed_session_id) {
    const { data: linked } = await supabase
      .from("sessions")
      .select("completed_at")
      .eq("id", data.completed_session_id)
      .maybeSingle();
    completedAt = (linked?.completed_at as string | null) ?? null;
  }
  return {
    id: data.id,
    blockId: data.block_id,
    weekIndex: data.week_index,
    dayIndex: data.day_index,
    slot: (data.slot as SessionSlot) ?? "single",
    plannedAt: data.planned_at ?? null,
    title: data.title,
    role: data.role,
    prescription,
    completedSessionId: data.completed_session_id,
    completedAt,
    skippedAt: data.skipped_at,
    notes: (data.notes as string | null) ?? null,
    date,
    archetype: block.archetype,
    archetypeName: archetypeDisplayName(block.archetype, block.notes),
    blockStartedOn: block.started_on,
  };
}

/** Today's planned sessions (active block + matching date). Returns both AM and PM if present. */
export async function getTodayPlannedSessions(): Promise<PlannedDay[]> {
  const block = await getActiveBlock();
  if (!block) return [];
  const [all, tz] = await Promise.all([
    getPlannedDays(block.id, block.startedOn),
    getUserTimezone(),
  ]);
  const today = todayYmd(tz);
  return all.filter((d) => d.date === today);
}

/** Today's first planned session (back-compat shim for single-slot consumers). */
export async function getTodayPlannedSession(): Promise<PlannedDay | null> {
  const sessions = await getTodayPlannedSessions();
  return sessions[0] ?? null;
}

/** Next N planned sessions after today (skipping rest days and the current day). */
export async function getUpcomingPlannedSessions(limit = 3): Promise<PlannedDay[]> {
  const block = await getActiveBlock();
  if (!block) return [];
  const [all, tz] = await Promise.all([
    getPlannedDays(block.id, block.startedOn),
    getUserTimezone(),
  ]);
  const today = todayYmd(tz);
  return all
    .filter((d) => d.date > today && !d.completedSessionId && !d.skippedAt)
    .slice(0, limit);
}

/**
 * One row in the "Run it again" picker on /plan/new. Three most-recent
 * blocks for the current user, regardless of status, so the user can
 * 1-click clone any of them.
 *
 * `archetypeName` is resolved server-side from the archetype registry
 * so the client doesn't need to ship `ARCHETYPES` (40k+ chars). For
 * legacy blocks where `days_per_week` was never persisted (`null`), we
 * derive the value from the block's planned_sessions (count of
 * distinct day_index in week 0). The UI renders "Unknown frequency"
 * when even that derivation fails.
 */
export type RecentBlock = {
  id: string;
  archetype: string;
  archetypeName: string;
  /** Platform program id (e.g. "wendler-531"); NULL on legacy archetype blocks. */
  programId: string | null;
  /** Platform program family (e.g. "531"); NULL on legacy archetype blocks. */
  programFamily: string | null;
  startedOn: string;
  daysPerWeek: number | null;
  status: "active" | "completed" | "archived";
  dayIndexOverrides: { days: number[]; twoADay: boolean } | null;
};

/**
 * Derive `daysPerWeek` from a block's planned_sessions when the column
 * is null. Counts the number of distinct day_index values in the first
 * week — every block's week 0 is fully scheduled, so this is a stable
 * proxy. Returns null when there are no planned_sessions for the block
 * (e.g. partially-seeded fixtures), letting the caller render the
 * "Unknown frequency" placeholder.
 */
export async function deriveDaysPerWeek(blockId: string): Promise<number | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("planned_sessions")
    .select("day_index")
    .eq("block_id", blockId)
    .eq("week_index", 0);
  if (!data || data.length === 0) return null;
  const distinct = new Set<number>();
  for (const row of data) {
    if (typeof row.day_index === "number") distinct.add(row.day_index);
  }
  return distinct.size > 0 ? distinct.size : null;
}

/**
 * Resolve "Block N of N" for the active block — chronological 1-indexed
 * position of `blockId` across the user's non-deleted blocks, alongside
 * the total count. Used by the /app/plan page header so the user can
 * see where the current block sits in their training timeline without
 * leaking external program names.
 */
export async function getBlockNumberAndTotal(
  blockId: string,
): Promise<{ index: number; total: number }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return { index: 1, total: 1 };
  const { data } = await supabase
    .from("training_blocks")
    .select("id, started_on, created_at")
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .order("started_on", { ascending: true })
    .order("created_at", { ascending: true });
  if (!data || data.length === 0) return { index: 1, total: 1 };
  const idx = data.findIndex((b) => b.id === blockId);
  return {
    index: idx >= 0 ? idx + 1 : data.length,
    total: data.length,
  };
}

export async function getRecentBlocks(limit = 3): Promise<RecentBlock[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return [];
  const { data } = await supabase
    .from("training_blocks")
    .select("id, archetype, program_id, program_family, started_on, days_per_week, status, day_index_overrides, notes")
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .order("started_on", { ascending: false })
    .limit(limit);
  if (!data) return [];

  // Resolve daysPerWeek for any block where the column is null by
  // counting distinct day_index in week 0 of planned_sessions. Runs in
  // parallel — most lists are 3-5 blocks so the fan-out is bounded.
  const resolved = await Promise.all(
    data.map(async (d) => {
      const stored = d.days_per_week ?? null;
      const daysPerWeek =
        typeof stored === "number" ? stored : await deriveDaysPerWeek(d.id);
      return {
        id: d.id,
        archetype: d.archetype,
        archetypeName: archetypeDisplayName(d.archetype, d.notes),
        programId: (d.program_id as string | null) ?? null,
        programFamily: (d.program_family as string | null) ?? null,
        startedOn: d.started_on,
        daysPerWeek,
        status: d.status as "active" | "completed" | "archived",
        dayIndexOverrides:
          (d.day_index_overrides as RecentBlock["dayIndexOverrides"]) ?? null,
      };
    }),
  );
  return resolved;
}

/**
 * One row in the /app/plan/history list. Adds completion stats on top
 * of `RecentBlock` so the page can render "12 of 16 sessions logged"
 * without an extra round-trip per block.
 *
 * `endedOn` prefers the explicit `ended_at` column (migration 0025) and
 * falls back to `updated_at` for older rows that pre-date the backfill
 * — defensive so the history page never blanks the date out.
 */
export type BlockWithCompletionStats = RecentBlock & {
  weeks: number;
  endedOn: string | null;
  totalSessions: number;
  loggedSessions: number;
  skippedSessions: number;
};

/**
 * Lists all blocks for the current user with derived completion stats.
 * Pagination is offset-based; the history page uses 20-per-page.
 *
 * Joining via Supabase's relationship-select pulls the planned_sessions
 * rows alongside the block so the completion counts can be computed in
 * a single round-trip instead of an N+1 fan-out.
 */
export async function getAllBlocksWithCompletionStats(
  opts: { limit?: number; offset?: number } = {},
): Promise<BlockWithCompletionStats[]> {
  const limit = opts.limit ?? 20;
  const offset = opts.offset ?? 0;
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return [];
  const { data } = await supabase
    .from("training_blocks")
    .select(
      "id, archetype, program_id, program_family, started_on, updated_at, ended_at, weeks, days_per_week, status, day_index_overrides, notes, planned_sessions(id, completed_session_id, skipped_at, week_index, day_index)",
    )
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .order("started_on", { ascending: false })
    .range(offset, offset + limit - 1);
  if (!data) return [];

  return Promise.all(
    data.map(async (d) => {
      const planned = (d.planned_sessions ?? []) as Array<{
        id: string;
        completed_session_id: string | null;
        skipped_at: string | null;
        week_index: number;
        day_index: number;
      }>;
      const totalSessions = planned.length;
      let loggedSessions = 0;
      let skippedSessions = 0;
      for (const p of planned) {
        if (p.completed_session_id) loggedSessions++;
        else if (p.skipped_at) skippedSessions++;
      }
      const stored = d.days_per_week ?? null;
      let daysPerWeek: number | null = typeof stored === "number" ? stored : null;
      if (daysPerWeek == null) {
        const distinct = new Set<number>();
        for (const p of planned) {
          if (p.week_index === 0 && typeof p.day_index === "number") {
            distinct.add(p.day_index);
          }
        }
        if (distinct.size > 0) daysPerWeek = distinct.size;
      }
      return {
        id: d.id,
        archetype: d.archetype,
        archetypeName: archetypeDisplayName(d.archetype, d.notes),
        programId: (d.program_id as string | null) ?? null,
        programFamily: (d.program_family as string | null) ?? null,
        startedOn: d.started_on,
        endedOn:
          d.status === "active"
            ? null
            : ((d.ended_at ?? d.updated_at) ?? null),
        weeks: d.weeks,
        daysPerWeek,
        status: d.status as "active" | "completed" | "archived",
        dayIndexOverrides:
          (d.day_index_overrides as RecentBlock["dayIndexOverrides"]) ?? null,
        totalSessions,
        loggedSessions,
        skippedSessions,
      };
    }),
  );
}

/**
 * One row in the Trash page list — covers both block and session
 * deletions in a single shape so the page can render a unified list.
 * `archetypeName` for blocks resolves through `archetypeDisplayName`
 * so custom blocks render their user-supplied label.
 *
 * Selected fields are intentionally minimal: enough to render the row
 * + drive the type-to-confirm token (archetype name for blocks,
 * `YYYY-MM-DD` performed_at for sessions). Recovery and permanent
 * delete actions take just the id.
 */
export type TrashedBlock = {
  kind: "block";
  id: string;
  archetype: string;
  archetypeName: string;
  startedOn: string;
  deletedAt: string;
};

export type TrashedSession = {
  kind: "session";
  id: string;
  title: string | null;
  performedAt: string;
  /** YYYY-MM-DD slice of performed_at — used as the type-to-confirm token. */
  performedOn: string;
  deletedAt: string;
};

export type TrashedItems = {
  blocks: TrashedBlock[];
  sessions: TrashedSession[];
};

/**
 * List every soft-deleted block + session belonging to the current
 * user. The only query in the app that selects `deleted_at IS NOT
 * NULL` (every other query filters the inverse). Sorted by
 * `deleted_at DESC` so the most-recent deletions surface first — that
 * matches the user's mental model (the thing I just trashed should be
 * at the top of the Trash).
 */
export async function getTrashedItems(): Promise<TrashedItems> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return { blocks: [], sessions: [] };

  const [{ data: blockRows }, { data: sessionRows }] = await Promise.all([
    supabase
      .from("training_blocks")
      .select("id, archetype, started_on, notes, deleted_at")
      .eq("user_id", user.id)
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false }),
    supabase
      .from("sessions")
      .select("id, title, performed_at, deleted_at")
      .eq("user_id", user.id)
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false }),
  ]);

  const blocks: TrashedBlock[] = (blockRows ?? []).map((b) => ({
    kind: "block" as const,
    id: b.id,
    archetype: b.archetype,
    archetypeName: archetypeDisplayName(b.archetype, b.notes),
    startedOn: b.started_on,
    deletedAt: b.deleted_at,
  }));

  const sessions: TrashedSession[] = (sessionRows ?? []).map((s) => ({
    kind: "session" as const,
    id: s.id,
    title: s.title ?? null,
    performedAt: s.performed_at,
    performedOn: String(s.performed_at).slice(0, 10),
    deletedAt: s.deleted_at,
  }));

  return { blocks, sessions };
}
