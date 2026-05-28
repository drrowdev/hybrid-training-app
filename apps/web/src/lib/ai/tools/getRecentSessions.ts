/**
 * getRecentSessions — per-day strength and cardio sessions at daily
 * detail for the last `daysBack` days.
 *
 * Data source: `sessions` ⨝ `set_logs` ⨝ `cardio_logs` filtered by
 * `performed_at >= now() - daysBack days`. Patterns follow
 * `apps/web/src/lib/ai/snapshot.ts` last-90-days aggregation (no
 * separate helper currently exists for the catalogue shape; flagged
 * in PR body under "Decisions made under ambiguity").
 *
 * Hard caps: daysBack clamped to [1, 90]; max 200 sessions returned.
 */
import { z } from "zod";
import type { Tool } from "./types";
import { clamp } from "./types";

const sessionSchema = z.object({
  date: z.string(),
  kind: z.enum(["strength", "cardio", "mixed"]),
  duration_min: z.number().nullable(),
  effective_stress_load: z.number(),
  top_signals: z.array(z.string()),
});

const outputSchema = z.object({
  days_back: z.number().int(),
  sessions: z.array(sessionSchema),
});

const inputSchema = z
  .object({
    daysBack: z
      .number()
      .int()
      .min(1)
      .max(90)
      .describe("Number of past days to include (1-90)."),
  })
  .strict();

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

const MAX_SESSIONS = 200;

type SetLogRow = {
  session_id: string;
  weight_kg: number | string | null;
  reps: number | string | null;
  set_kind: string;
  movement: { display_name: string } | { display_name: string }[] | null;
};
type CardioRow = {
  session_id: string;
  modality: string | null;
  duration_sec: number | null;
  distance_km: number | string | null;
};

function movementName(
  m: SetLogRow["movement"] | undefined,
): string | null {
  if (!m) return null;
  if (Array.isArray(m)) return m[0]?.display_name ?? null;
  return m.display_name ?? null;
}

function groupBy<T, K>(rows: T[], keyOf: (t: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const r of rows) {
    const k = keyOf(r);
    const arr = m.get(k);
    if (arr) arr.push(r);
    else m.set(k, [r]);
  }
  return m;
}

export const getRecentSessions: Tool<Input, Output> = {
  name: "getRecentSessions",
  description:
    "Returns logged training sessions over the last N days with per-day detail (duration, effective stress load, and short signal strings).",
  inputSchema,
  outputSchema,
  async handler(input, ctx) {
    const daysBack = clamp(input.daysBack, 1, 90);
    const cutoff = new Date(Date.now() - daysBack * 86_400_000);

    const { data: sessionsRows } = await ctx.supabase
      .from("sessions")
      .select("id, performed_at, duration_min, session_rpe, completed_at")
      .eq("user_id", ctx.userId)
      .not("completed_at", "is", null)
      .is("deleted_at", null)
      .gte("performed_at", cutoff.toISOString())
      .order("performed_at", { ascending: false })
      .limit(MAX_SESSIONS);

    const sessions = (sessionsRows ?? []) as Array<{
      id: string;
      performed_at: string;
      duration_min: number | null;
      session_rpe: number | string | null;
    }>;
    const ids = sessions.map((s) => s.id);

    if (ids.length === 0) {
      return { days_back: daysBack, sessions: [] };
    }

    const [setsRes, cardioRes] = await Promise.all([
      ctx.supabase
        .from("set_logs")
        .select(
          "session_id, weight_kg, reps, set_kind, movement:movements(display_name)",
        )
        .in("session_id", ids)
        .eq("skipped", false),
      ctx.supabase
        .from("cardio_logs")
        .select("session_id, modality, duration_sec, distance_km")
        .in("session_id", ids),
    ]);

    const setsBy = groupBy(
      (setsRes.data ?? []) as SetLogRow[],
      (r) => r.session_id,
    );
    const cardioBy = groupBy(
      (cardioRes.data ?? []) as CardioRow[],
      (r) => r.session_id,
    );

    const out = sessions.map((s) => {
      const sets = setsBy.get(s.id) ?? [];
      const cardios = cardioBy.get(s.id) ?? [];
      const kind: "strength" | "cardio" | "mixed" =
        sets.length > 0 && cardios.length > 0
          ? "mixed"
          : sets.length > 0
            ? "strength"
            : "cardio";

      const signals: string[] = [];
      if (sets.length > 0) {
        const heaviest = sets
          .filter((r) => r.set_kind === "main")
          .reduce<{ w: number; reps: number; name: string } | null>(
            (acc, r) => {
              const w = Number(r.weight_kg ?? 0);
              const reps = Number(r.reps ?? 0);
              if (!acc || w > acc.w) {
                return { w, reps, name: movementName(r.movement) ?? "lift" };
              }
              return acc;
            },
            null,
          );
        if (heaviest && heaviest.w > 0) {
          signals.push(
            `${heaviest.name} ${heaviest.w}kg x ${heaviest.reps}`,
          );
        }
      }
      if (cardios.length > 0) {
        const c = cardios[0]!;
        const minutes = Math.round((Number(c.duration_sec) || 0) / 60);
        const km = c.distance_km != null ? Number(c.distance_km) : null;
        const parts: string[] = [];
        if (c.modality) parts.push(String(c.modality));
        if (minutes > 0) parts.push(`${minutes}min`);
        if (km != null && km > 0) parts.push(`${km.toFixed(1)}km`);
        if (parts.length > 0) signals.push(parts.join(" "));
      }

      return {
        date: String(s.performed_at).slice(0, 10),
        kind,
        duration_min: (s.duration_min as number | null) ?? null,
        effective_stress_load: Number(s.session_rpe ?? 0),
        top_signals: signals,
      };
    });

    return { days_back: daysBack, sessions: out };
  },
};
