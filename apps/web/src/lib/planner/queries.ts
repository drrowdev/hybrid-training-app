/**
 * Queries for the planner UI.
 */
import { createClient } from "@/lib/supabase/server";
import type { Prescription } from "@hta/db";

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
  title: string;
  role: string;
  prescription: Prescription;
  completedSessionId: string | null;
  skippedAt: string | null;
  /** Absolute calendar date this day falls on (derived from block start + week + day). */
  date: string;
};

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return ymd(d);
}

/** Mon=0 ... Sun=6 from a JS Date. */
function isoWeekday(iso: string): number {
  const d = new Date(iso + "T00:00:00");
  return (d.getDay() + 6) % 7;
}

/** Today as YYYY-MM-DD in local time. */
export function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
      "id, block_id, week_index, day_index, title, role, prescription, completed_session_id, skipped_at",
    )
    .eq("block_id", blockId)
    .order("week_index", { ascending: true })
    .order("day_index", { ascending: true });
  if (!data) return [];
  return data.map((d) => ({
    id: d.id,
    blockId: d.block_id,
    weekIndex: d.week_index,
    dayIndex: d.day_index,
    title: d.title,
    role: d.role,
    prescription: (d.prescription as Prescription) ?? { items: [] },
    completedSessionId: d.completed_session_id,
    skippedAt: d.skipped_at,
    date: dayDate(startedOn, d.week_index, d.day_index),
  }));
}

/** Today's planned session (active block + matching date). */
export async function getTodayPlannedSession(): Promise<PlannedDay | null> {
  const block = await getActiveBlock();
  if (!block) return null;
  const all = await getPlannedDays(block.id, block.startedOn);
  const today = todayYmd();
  return all.find((d) => d.date === today) ?? null;
}

/** Next N planned sessions after today (skipping rest days and the current day). */
export async function getUpcomingPlannedSessions(limit = 3): Promise<PlannedDay[]> {
  const block = await getActiveBlock();
  if (!block) return [];
  const all = await getPlannedDays(block.id, block.startedOn);
  const today = todayYmd();
  return all
    .filter((d) => d.date > today && !d.completedSessionId && !d.skippedAt)
    .slice(0, limit);
}
