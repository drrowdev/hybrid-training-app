/**
 * Block-state classifier for the /app/plan hero. Pure / no I/O so it
 * stays unit-testable in isolation.
 *
 * Discriminates the five hero modes that the page renders:
 *   - 'no-block'         — user has no active block at all
 *   - 'future'           — active block whose startedOn is after today
 *   - 'completed'        — active block whose planned sessions are all
 *                          completed or skipped
 *   - 'no-session-today' — active block, nothing scheduled for today
 *                          but at least one future session remains
 *   - 'active'           — active block with ≥1 actionable session today
 *
 * Consumers pass the same `UpNextSelection` they already feed to
 * `UpNextHero`, plus the block's `startedOn` and the raw planned-day
 * list so we can spot the "all done/skipped" case without re-walking
 * the prescription items.
 */
import type { UpNextSelection } from "./up-next";

export type BlockStateKind =
  | "no-block"
  | "future"
  | "completed"
  | "no-session-today"
  | "active";

export type BlockState =
  | { kind: "no-block" }
  | { kind: "future"; startsOn: string; daysUntil: number }
  | { kind: "completed" }
  | { kind: "no-session-today"; nextDate: string | null }
  | { kind: "active" };

export type BlockStateInput = {
  /** Active block, or null when the user has none. */
  block: { startedOn: string } | null;
  /** Today in YYYY-MM-DD, in the user's timezone. */
  today: string;
  /** Raw planned rows — only the lifecycle flags matter here. */
  planned: ReadonlyArray<{
    date: string;
    completedSessionId: string | null;
    skippedAt: string | null;
  }>;
  /** Same selection the hero card reads. */
  upNext: UpNextSelection;
};

/**
 * Day diff between two YYYY-MM-DD strings, computed in UTC so DST
 * shifts in the user's local timezone don't bleed in.
 */
function daysBetweenYmd(fromYmd: string, toYmd: string): number {
  const [fy, fm, fd] = fromYmd.split("-").map(Number);
  const [ty, tm, td] = toYmd.split("-").map(Number);
  const fromMs = Date.UTC(fy!, (fm ?? 1) - 1, fd!);
  const toMs = Date.UTC(ty!, (tm ?? 1) - 1, td!);
  return Math.round((toMs - fromMs) / 86_400_000);
}

export function selectBlockState(input: BlockStateInput): BlockState {
  if (!input.block) return { kind: "no-block" };

  if (input.block.startedOn > input.today) {
    return {
      kind: "future",
      startsOn: input.block.startedOn,
      daysUntil: daysBetweenYmd(input.today, input.block.startedOn),
    };
  }

  if (input.upNext.today.length > 0) {
    return { kind: "active" };
  }

  // No actionable session today. Decide between 'completed' and
  // 'no-session-today' by asking the raw planned list whether any
  // future row is still open (not completed and not skipped). We use
  // the raw list rather than `upNext.nextDate` so the classifier can't
  // be fooled by a future row that the selector happens to drop.
  const hasOpenFuture = input.planned.some(
    (p) => p.date > input.today && !p.completedSessionId && !p.skippedAt,
  );
  if (!hasOpenFuture) return { kind: "completed" };
  return { kind: "no-session-today", nextDate: input.upNext.nextDate };
}
