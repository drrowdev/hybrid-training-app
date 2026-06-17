/**
 * Pure forward-only rewrite planner for the "Edit plan" path.
 *
 * Given the current-week boundary, a freshly materialised set of sessions, and
 * the block's existing FUTURE rows, it decides — without touching the DB — which
 * untouched future rows to delete and which new rows to insert, while preserving
 * any future row that was already started or skipped (so we never destroy logged
 * history nor collide on the (week, day, slot) unique index).
 *
 * "Forward-only" means weeks at or before `currentWeekIndex` are frozen: nothing
 * in this plan ever references them.
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
  writeWeeks: number;
  existingFuture: ExistingFutureRow[];
  newSessions: NewSessionLite[];
}): ForwardRewritePlan {
  const { currentWeekIndex, writeWeeks, existingFuture, newSessions } = args;

  const preserved = new Set<string>();
  const deleteIds: string[] = [];
  for (const r of existingFuture) {
    if (r.weekIndex <= currentWeekIndex) continue; // defensive: ignore non-future
    if (r.touched) preserved.add(key(r));
    else deleteIds.push(r.id);
  }

  const insertIndices: number[] = [];
  newSessions.forEach((s, i) => {
    if (s.weekIndex <= currentWeekIndex) return; // frozen
    if (preserved.has(key(s))) return; // keep the logged/skipped row instead
    insertIndices.push(i);
  });

  return {
    deleteIds,
    insertIndices,
    newWeeks: Math.max(writeWeeks, currentWeekIndex + 1),
  };
}
