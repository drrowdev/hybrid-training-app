/**
 * Where a program-advised recovery week goes.
 *
 * A user-initiated recovery week lands after the week the lifter is in today.
 * A program-advised one lands after the week the program pointed at — TB3's
 * "deload after Peak Week" means after THAT peak week, not after whichever week
 * the user happens to open the prompt in. Someone who logs their last peak
 * session on a Sunday and taps the prompt the following Thursday must still get
 * the recovery week directly after the peak week.
 *
 * The anchor is resolved from live rows rather than arithmetic on the engine's
 * own week numbers, because an earlier inserted recovery week has already
 * shifted everything after it.
 */

/** A planned session, reduced to the two things anchoring cares about. */
export type AnchorRow = { weekIndex: number; programRef: string };

export type BoundaryAnchor = {
  /** The recovery week is inserted immediately after this 0-based week index. */
  afterWeek: number;
  /** True when every session the boundary names is in that same week. */
  contiguous: boolean;
};

/**
 * The week to insert after, given the sessions a boundary names.
 *
 * Returns null when none of them exist in the plan — a boundary we cannot see
 * is one we must not guess at, since guessing means inserting a light week in
 * the middle of someone's hard block.
 */
export function resolveBoundaryAnchor(
  refs: readonly string[],
  rows: readonly AnchorRow[],
): BoundaryAnchor | null {
  const wanted = new Set(refs);
  const weeks = rows.filter((r) => wanted.has(r.programRef)).map((r) => r.weekIndex);
  if (weeks.length === 0) return null;
  return {
    afterWeek: Math.max(...weeks),
    contiguous: Math.min(...weeks) === Math.max(...weeks),
  };
}
