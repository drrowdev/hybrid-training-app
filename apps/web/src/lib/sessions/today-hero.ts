import type { PlannedSlot } from "@/lib/planner/slot";

/**
 * Pure predicate for the Today hero's "Session logged ✓ — rest and
 * recover" state.
 *
 * The day is only "fully logged" when at least one session was completed
 * today AND every PLANNED session for today is settled (completed or skipped). We check
 * per-session completion rather than comparing counts: an extra standalone
 * activity — e.g. an easy run logged on a day that also has a
 * prescribed session — must NOT mask a still-pending planned session.
 * Counting it would hide the planned card the user still needs to act on.
 *
 * Rest day (no planned sessions) + a logged activity → fully logged, so the
 * hero shows the friendly "rest and recover" copy rather than a blank state.
 */
export function isTodayFullyLogged(input: {
  completedTodayCount: number;
  plannedToday: ReadonlyArray<{
    completedAt: string | null;
    skippedAt?: string | null;
  }>;
}): boolean {
  const hasCompletedPlannedSession = input.plannedToday.some(
    (planned) => planned.completedAt != null,
  );
  return (
    input.completedTodayCount > 0 &&
    (input.plannedToday.length === 0 ||
      hasCompletedPlannedSession) &&
    input.plannedToday.every(
      (planned) =>
        planned.completedAt != null ||
        planned.skippedAt != null,
    )
  );
}

export function actionablePlannedSessions<
  T extends {
    completedAt: string | null;
    skippedAt: string | null;
  },
>(plannedToday: readonly T[]): T[] {
  return plannedToday.filter(
    (planned) =>
      planned.completedAt == null &&
      planned.skippedAt == null,
  );
}

const PAIRED_SLOT_ORDER: Record<PlannedSlot, number> = {
  am: 0,
  pm: 1,
  single: 2,
};

const STANDALONE_SLOT_ORDER: Record<PlannedSlot, number> = {
  single: 0,
  am: 1,
  pm: 2,
};

/**
 * Keep genuine two-a-days in AM → PM order. For mixed same-day rows, lead
 * with the real single session and place storage-only adjunct slots after it.
 */
export function orderPlannedSessionsForToday<
  T extends {
    completedAt: string | null;
    slot: PlannedSlot;
  },
>(sessions: readonly T[], isTwoADay: boolean): T[] {
  const slotOrder = isTwoADay
    ? PAIRED_SLOT_ORDER
    : STANDALONE_SLOT_ORDER;
  return [...sessions].sort((a, b) => {
    const completionOrder =
      Number(a.completedAt != null) - Number(b.completedAt != null);
    if (completionOrder !== 0) return completionOrder;
    return slotOrder[a.slot] - slotOrder[b.slot];
  });
}
