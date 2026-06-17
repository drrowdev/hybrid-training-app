/**
 * getActiveBlock — the program the user is following, current week index,
 * and prescribed sessions for the next two weeks.
 *
 * Data source: `training_blocks WHERE status='active'` + `planned_sessions`
 * for the next 14 days. Capped at 14 prescribed sessions. The block's
 * `program_id` is resolved to a user-facing program label (name + summary);
 * `archetype` is retained for legacy archetype blocks and internal modality.
 */
import { z } from "zod";
import type { Tool } from "./types";
import { resolveProgramLabel } from "./program-label";

const plannedSchema = z.object({
  date: z.string(),
  week_index: z.number().int(),
  day_index: z.number().int(),
  title: z.string(),
  role: z.string(),
  status: z.enum(["pending", "completed", "skipped"]),
});

const programSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    summary: z.string(),
  })
  .nullable();

const outputSchema = z.object({
  program: programSchema,
  program_family: z.string().nullable(),
  archetype: z.string().nullable(),
  started_on: z.string().nullable(),
  weeks_total: z.number().int().nullable(),
  current_week_index: z.number().int().nullable(),
  prescribed_next_two_weeks: z.array(plannedSchema),
});

const inputSchema = z.object({}).strict();

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

const MAX_PRESCRIBED = 14;

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(yyyymmdd: string, days: number): string {
  const d = new Date(`${yyyymmdd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDay(d);
}

function isoWeekday(yyyymmdd: string): number {
  const d = new Date(`${yyyymmdd}T00:00:00.000Z`);
  const day = d.getUTCDay();
  return day === 0 ? 6 : day - 1;
}

export const getActiveBlock: Tool<Input, Output> = {
  name: "getActiveBlock",
  description:
    "Returns the user's currently active training block — the PROGRAM they are following (by name, e.g. 5/3/1, Tactical Barbell, Green Protocol, HYROX, or Hybrid) plus a one-line summary, total weeks, current week index, and prescribed sessions for the next two weeks (capped at 14). `program` is null for legacy archetype blocks; `archetype` is the internal modality and stays meaningful for those.",
  inputSchema,
  outputSchema,
  async handler(_input, ctx) {
    const { data: block } = await ctx.supabase
      .from("training_blocks")
      .select("id, program_id, program_family, archetype, started_on, weeks, notes")
      .eq("user_id", ctx.userId)
      .eq("status", "active")
      .is("deleted_at", null)
      .order("started_on", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!block) {
      return {
        program: null,
        program_family: null,
        archetype: null,
        started_on: null,
        weeks_total: null,
        current_week_index: null,
        prescribed_next_two_weeks: [],
      };
    }

    const startedOn = block.started_on as string;
    const startWeekday = isoWeekday(startedOn);
    const blockMonday = addDays(startedOn, -startWeekday);
    const today = isoDay(new Date());
    const dayDiff = Math.floor(
      (Date.UTC(
        Number(today.slice(0, 4)),
        Number(today.slice(5, 7)) - 1,
        Number(today.slice(8, 10)),
      ) -
        Date.UTC(
          Number(blockMonday.slice(0, 4)),
          Number(blockMonday.slice(5, 7)) - 1,
          Number(blockMonday.slice(8, 10)),
        )) /
        86_400_000,
    );
    const currentWeekIndex = Math.max(
      0,
      Math.min(((block.weeks as number) ?? 1) - 1, Math.floor(dayDiff / 7)),
    );

    const { data: planned } = await ctx.supabase
      .from("planned_sessions")
      .select(
        "week_index, day_index, title, role, completed_session_id, skipped_at",
      )
      .eq("block_id", block.id as string)
      .gte("week_index", currentWeekIndex)
      .lte("week_index", currentWeekIndex + 1)
      .order("week_index", { ascending: true })
      .order("day_index", { ascending: true })
      .limit(MAX_PRESCRIBED);

    const prescribed = ((planned ?? []) as Array<{
      week_index: number;
      day_index: number;
      title: string | null;
      role: string | null;
      completed_session_id: string | null;
      skipped_at: string | null;
    }>)
      .slice(0, MAX_PRESCRIBED)
      .map((p) => ({
        date: addDays(blockMonday, p.week_index * 7 + p.day_index),
        week_index: p.week_index,
        day_index: p.day_index,
        title: p.title ?? "",
        role: p.role ?? "",
        status: (p.completed_session_id
          ? "completed"
          : p.skipped_at
            ? "skipped"
            : "pending") as "pending" | "completed" | "skipped",
      }));

    return {
      program: resolveProgramLabel(block.program_id as string | null),
      program_family: (block.program_family as string | null) ?? null,
      archetype: (block.archetype as string | null) ?? null,
      started_on: startedOn,
      weeks_total: (block.weeks as number | null) ?? null,
      current_week_index: currentWeekIndex,
      prescribed_next_two_weeks: prescribed,
    };
  },
};
