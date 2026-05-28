/**
 * getPrTimeline — best-weight personal records, optionally filtered to
 * one movement.
 *
 * Data source: `set_logs` joined to `sessions` and `movements`. There
 * is no dedicated `pr_events` table today (the ADR-mentioned table
 * does not exist in the current schema — flagged in PR body); we
 * derive PRs from the same heaviest-set query used by `snapshot.ts`.
 *
 * Hard cap: ≤ 500 most recent PR-eligible sets scanned, capped at 250
 * returned records (a deliberate tightening from ADR's "≤ 500 most
 * recent PRs" — keeps payload size predictable; see PR body).
 */
import { z } from "zod";
import type { Tool } from "./types";

const prSchema = z.object({
  date: z.string(),
  movement: z.string(),
  kind: z.literal("weight"),
  value: z.number(),
  unit: z.literal("kg"),
  reps: z.number().int(),
});

const outputSchema = z.object({
  prs: z.array(prSchema),
});

const inputSchema = z
  .object({
    movement: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .optional()
      .describe(
        "Optional movement display-name substring filter (case-insensitive).",
      ),
  })
  .strict();

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

const SCAN_LIMIT = 500;
const RETURN_LIMIT = 250;

type Row = {
  weight_kg: number | string;
  reps: number | string;
  session:
    | { performed_at: string; user_id: string; deleted_at: string | null }
    | Array<{
        performed_at: string;
        user_id: string;
        deleted_at: string | null;
      }>
    | null;
  movement:
    | { display_name: string }
    | Array<{ display_name: string }>
    | null;
};

function extractDate(s: Row["session"]): string | null {
  if (!s) return null;
  if (Array.isArray(s)) return s[0]?.performed_at ?? null;
  return s.performed_at;
}

function extractMovementName(m: Row["movement"]): string | null {
  if (!m) return null;
  if (Array.isArray(m)) return m[0]?.display_name ?? null;
  return m.display_name ?? null;
}

export const getPrTimeline: Tool<Input, Output> = {
  name: "getPrTimeline",
  description:
    "Returns best-weight personal records across the user's logged sets, optionally filtered to a movement by display-name substring.",
  inputSchema,
  outputSchema,
  async handler(input, ctx) {
    const { data } = await ctx.supabase
      .from("set_logs")
      .select(
        "weight_kg, reps, session:sessions!inner(user_id, performed_at, deleted_at), movement:movements(display_name)",
      )
      .eq("session.user_id", ctx.userId)
      .is("session.deleted_at", null)
      .eq("skipped", false)
      .neq("set_kind", "warmup")
      .not("weight_kg", "is", null)
      .not("reps", "is", null)
      .gt("reps", 0)
      .order("weight_kg", { ascending: false })
      .limit(SCAN_LIMIT);

    const rows = ((data ?? []) as Row[]).filter((r) => extractDate(r.session));

    const needle = input.movement?.toLowerCase().trim() ?? null;
    const seen = new Set<string>();
    const out: z.infer<typeof prSchema>[] = [];
    for (const r of rows) {
      const name = extractMovementName(r.movement);
      if (!name) continue;
      if (needle && !name.toLowerCase().includes(needle)) continue;
      if (seen.has(name)) continue;
      seen.add(name);
      const date = extractDate(r.session)!;
      out.push({
        date: String(date).slice(0, 10),
        movement: name,
        kind: "weight",
        value: Number(r.weight_kg),
        unit: "kg",
        reps: Number(r.reps),
      });
      if (out.length >= RETURN_LIMIT) break;
    }

    return { prs: out };
  },
};
