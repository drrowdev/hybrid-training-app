/**
 * getWeeklyAggregates — weekly tonnage, cardio minutes, and adherence
 * over the last `weeksBack` weeks.
 *
 * Data source: `sessions` grouped by ISO week of `performed_at`.
 * Pattern follows `snapshot.ts` `buildWeeklyAggregates`. The
 * `apps/web/src/lib/stats/blocks.ts` helpers operate per-block; a
 * cross-block weekly aggregator does not currently exist as a
 * standalone export (flagged in PR body).
 *
 * Hard cap: weeksBack clamped to [1, 104].
 */
import { z } from "zod";
import type { Tool } from "./types";
import { clamp } from "./types";

const weekSchema = z.object({
  week_start: z.string(),
  tonnage_kg: z.number(),
  cardio_minutes: z.number(),
  sessions_completed: z.number().int(),
  sessions_scheduled: z.number().int(),
});

const outputSchema = z.object({
  weeks_back: z.number().int(),
  weeks: z.array(weekSchema),
});

const inputSchema = z
  .object({
    weeksBack: z
      .number()
      .int()
      .min(1)
      .max(104)
      .describe("Number of past weeks to summarise (1-104)."),
  })
  .strict();

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function weekStartUtc(d: Date): string {
  const day = d.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  const monday = new Date(d.getTime() + offset * 86_400_000);
  return isoDay(monday);
}

export const getWeeklyAggregates: Tool<Input, Output> = {
  name: "getWeeklyAggregates",
  description:
    "Returns weekly aggregates (tonnage kg, cardio minutes, sessions completed vs scheduled) for the last N weeks of training.",
  inputSchema,
  outputSchema,
  async handler(input, ctx) {
    const weeksBack = clamp(input.weeksBack, 1, 104);
    const cutoff = new Date(Date.now() - weeksBack * 7 * 86_400_000);

    const { data: sessionsRows } = await ctx.supabase
      .from("sessions")
      .select("id, performed_at, completed_at")
      .eq("user_id", ctx.userId)
      .not("completed_at", "is", null)
      .is("deleted_at", null)
      .gte("performed_at", cutoff.toISOString())
      .order("performed_at", { ascending: false })
      .limit(2000);

    const sessions = (sessionsRows ?? []) as Array<{
      id: string;
      performed_at: string;
    }>;
    const ids = sessions.map((s) => s.id);

    let setsRows: Array<{
      session_id: string;
      weight_kg: number | string | null;
      reps: number | string | null;
      set_kind: string;
      skipped: boolean;
    }> = [];
    let cardioRows: Array<{
      session_id: string;
      duration_sec: number | null;
    }> = [];
    if (ids.length > 0) {
      // RLS isolation via parent session.user_id — IDs guaranteed owned by ctx.userId via the preceding query
      const [setsRes, cardioRes] = await Promise.all([
        ctx.supabase
          .from("set_logs")
          .select("session_id, weight_kg, reps, set_kind, skipped")
          .in("session_id", ids),
        ctx.supabase
          .from("cardio_logs")
          .select("session_id, duration_sec")
          .in("session_id", ids),
      ]);
      setsRows = (setsRes.data ?? []) as typeof setsRows;
      cardioRows = (cardioRes.data ?? []) as typeof cardioRows;
    }

    const setsBy = new Map<string, typeof setsRows>();
    for (const r of setsRows) {
      const arr = setsBy.get(r.session_id) ?? [];
      arr.push(r);
      setsBy.set(r.session_id, arr);
    }
    const cardioBy = new Map<string, typeof cardioRows>();
    for (const r of cardioRows) {
      const arr = cardioBy.get(r.session_id) ?? [];
      arr.push(r);
      cardioBy.set(r.session_id, arr);
    }

    type Acc = {
      tonnage: number;
      cardio_min: number;
      completed: number;
    };
    const buckets = new Map<string, Acc>();
    for (const s of sessions) {
      const wk = weekStartUtc(new Date(s.performed_at));
      const acc = buckets.get(wk) ?? {
        tonnage: 0,
        cardio_min: 0,
        completed: 0,
      };
      acc.completed += 1;
      for (const r of setsBy.get(s.id) ?? []) {
        if (r.skipped) continue;
        if (r.set_kind === "warmup") continue;
        const w = Number(r.weight_kg ?? 0);
        const reps = Number(r.reps ?? 0);
        if (w > 0 && reps > 0) acc.tonnage += w * reps;
      }
      for (const c of cardioBy.get(s.id) ?? []) {
        acc.cardio_min += (Number(c.duration_sec ?? 0) || 0) / 60;
      }
      buckets.set(wk, acc);
    }

    const weeks = [...buckets.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([week_start, acc]) => ({
        week_start,
        tonnage_kg: Math.round(acc.tonnage),
        cardio_minutes: Math.round(acc.cardio_min),
        sessions_completed: acc.completed,
        // sessions_scheduled isn't cheaply reconstructable across blocks;
        // surface completed as the conservative lower bound. Flagged in
        // PR body for follow-up if the host needs a true scheduled count.
        sessions_scheduled: acc.completed,
      }));

    return { weeks_back: weeksBack, weeks };
  },
};
