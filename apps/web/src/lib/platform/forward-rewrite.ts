/**
 * Pure forward-only rewrite planner for the "Edit plan" path.
 *
 * Given today's (week, day) boundary, a freshly materialised set of sessions,
 * and the block's existing rows from the current week onward, it decides —
 * without touching the DB — which untouched upcoming rows to delete and which
 * new rows to insert. Every row through today plus any later row already started
 * or skipped is preserved.
 *
 * "Forward-only" means calendar slots at or before today's day are frozen.
 */

export interface ExistingFutureRow {
  id: string;
  weekIndex: number;
  dayIndex: number;
  slot: string;
  /** True when the row was started (completed_session_id) or skipped. */
  touched: boolean;
}

export interface NewSessionLite {
  weekIndex: number;
  dayIndex: number;
  slot: string;
}

export interface ForwardRewritePlan {
  /** Ids of untouched future rows to delete. */
  deleteIds: string[];
  /** Indices into the input `newSessions` to insert (future + not preserved). */
  insertIndices: number[];
  /** The block's new total week count. */
  newWeeks: number;
}

function key(r: { weekIndex: number; dayIndex: number; slot: string }): string {
  return `${r.weekIndex}-${r.dayIndex}-${r.slot}`;
}

export function planForwardOnlyRewrite(args: {
  currentWeekIndex: number;
  currentDayIndex: number;
  writeWeeks: number;
  existingFuture: ExistingFutureRow[];
  newSessions: NewSessionLite[];
}): ForwardRewritePlan {
  const {
    currentWeekIndex,
    currentDayIndex,
    writeWeeks,
    existingFuture,
    newSessions,
  } = args;
  const isFrozen = (row: { weekIndex: number; dayIndex: number }) =>
    row.weekIndex < currentWeekIndex ||
    (row.weekIndex === currentWeekIndex &&
      row.dayIndex <= currentDayIndex);

  const preserved = new Set<string>();
  const deleteIds: string[] = [];
  for (const r of existingFuture) {
    if (isFrozen(r)) continue;
    if (r.touched) preserved.add(key(r));
    else deleteIds.push(r.id);
  }

  const insertIndices: number[] = [];
  newSessions.forEach((s, i) => {
    if (isFrozen(s)) return;
    if (preserved.has(key(s))) return; // keep the logged/skipped row instead
    insertIndices.push(i);
  });

  return {
    deleteIds,
    insertIndices,
    newWeeks: Math.max(writeWeeks, currentWeekIndex + 1),
  };
}
