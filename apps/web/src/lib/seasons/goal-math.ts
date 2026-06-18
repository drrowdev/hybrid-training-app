/**
 * Season goal back-calculation (ADR 0051 Phase 1) — pure, client-safe date math.
 *
 * Kept SEPARATE from `season-logic.ts` on purpose: the roadmap is a client
 * component, and `season-logic` pulls a value import from `@hta/db` (the Drizzle
 * schema → Postgres driver), which must never enter the client bundle. These
 * helpers depend on nothing but their string inputs.
 */

type BlockStatusLite = "planned" | "active" | "done" | "skipped";

/** Fallback per-block length (weeks) when a block carries no `plannedWeeks`
 *  estimate yet — only used for the goal-runway comparison. CP-1 heuristic. */
export const DEFAULT_BLOCK_WEEKS = 4;

/**
 * Whole weeks from `todayYmd` to `targetYmd` (both YYYY-MM-DD), rounded up.
 * Returns null when there's no target or it's already past. Mirrors the
 * `wholeWeeksBetween` mechanism used for HYROX (ADR 0050).
 */
export function weeksUntil(todayYmd: string, targetYmd: string | null): number | null {
  if (!targetYmd) return null;
  const start = Date.parse(`${todayYmd}T00:00:00Z`);
  const end = Date.parse(`${targetYmd}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  const days = Math.round((end - start) / 86_400_000);
  return Math.max(1, Math.ceil(days / 7));
}

/**
 * Estimated weeks the remaining (not-done) blocks will consume — the active
 * block plus every planned one, using each block's `plannedWeeks` or the
 * default fallback. Drives the goal-runway "do the blocks fit?" check.
 */
export function remainingPlannedWeeks(
  blocks: Array<{ status: BlockStatusLite; plannedWeeks: number | null }>,
): number {
  return blocks
    .filter((b) => b.status === "planned" || b.status === "active")
    .reduce((sum, b) => sum + (b.plannedWeeks ?? DEFAULT_BLOCK_WEEKS), 0);
}

/**
 * Compare the remaining block runway to the weeks left until the goal.
 * 'over' = the planned blocks need more weeks than remain (tighten the plan);
 * 'tight' = within one block-length; 'ok' = comfortable; null = no goal date.
 */
export function goalRunwayStatus(
  weeksToGoal: number | null,
  remainingWeeks: number,
): "ok" | "tight" | "over" | null {
  if (weeksToGoal == null) return null;
  if (remainingWeeks > weeksToGoal) return "over";
  if (weeksToGoal - remainingWeeks <= DEFAULT_BLOCK_WEEKS) return "tight";
  return "ok";
}
