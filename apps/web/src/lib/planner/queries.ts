/**
 * Queries for the planner UI.
 */
import { createClient } from "@/lib/supabase/server";
import type { Prescription, SessionSlot } from "@hta/db";
import {
  addDaysToYmd,
  isoWeekdayYmd,
  todayYmd as todayYmdImpl,
  ymdInTimezone as ymdInTimezoneImpl,
} from "@/lib/dates";

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
  completedSessionId: string | null;
  skippedAt: string | null;
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
    } = await supabase.auth.getUser();
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
    .select("id, archetype, started_on, weeks, status, notes")
    .eq("status", "active")
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
  };
}

export async function getPlannedDays(blockId: string, startedOn: string): Promise<PlannedDay[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("planned_sessions")
    .select(
      "id, block_id, week_index, day_index, slot, planned_at, title, role, prescription, completed_session_id, skipped_at",
    )
    .eq("block_id", blockId)
    .order("week_index", { ascending: true })
    .order("day_index", { ascending: true })
    .order("slot", { ascending: true });
  if (!data) return [];
  return data.map((d) => ({
    id: d.id,
    blockId: d.block_id,
    weekIndex: d.week_index,
    dayIndex: d.day_index,
    slot: (d.slot as SessionSlot) ?? "single",
    plannedAt: d.planned_at ?? null,
    title: d.title,
    role: d.role,
    prescription: (d.prescription as Prescription) ?? { items: [] },
    completedSessionId: d.completed_session_id,
    skippedAt: d.skipped_at,
    date: dayDate(startedOn, d.week_index, d.day_index),
  }));
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
 */
export type RecentBlock = {
  id: string;
  archetype: string;
  startedOn: string;
  daysPerWeek: number | null;
  status: "active" | "completed" | "archived";
  dayIndexOverrides: { days: number[]; twoADay: boolean } | null;
};

export async function getRecentBlocks(limit = 3): Promise<RecentBlock[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { data } = await supabase
    .from("training_blocks")
    .select("id, archetype, started_on, days_per_week, status, day_index_overrides")
    .eq("user_id", user.id)
    .order("started_on", { ascending: false })
    .limit(limit);
  if (!data) return [];
  return data.map((d) => ({
    id: d.id,
    archetype: d.archetype,
    startedOn: d.started_on,
    daysPerWeek: d.days_per_week ?? null,
    status: d.status as "active" | "completed" | "archived",
    dayIndexOverrides:
      (d.day_index_overrides as { days: number[]; twoADay: boolean } | null) ?? null,
  }));
}
