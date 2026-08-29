/**
 * Where the focus logger goes after a save.
 *
 * Extracted from `FocusStripLogger` because the decision was inline in a
 * component the test suite cannot drive (no jsdom, no RTL, by choice), so the
 * bugs in it were invisible: an early exit off a 3–5 set movement, and a
 * circuit member the lifter could not leave after skipping its remaining sets.
 *
 * The one rule the callers must honour is that `covered` is EVERY slot now
 * accounted for — the whole point of the circuit bug was a caller reporting one
 * slot when it had written several.
 */

import {
  movementGroupKey,
  type MovementGroup,
} from "./movement-grouping";
import {
  firstOpenCircuitMovementId,
  firstOpenOptionalCircuitMovementId,
  type LinkedCircuitInfo,
} from "./linked-circuit";

function requiredIndices(group: MovementGroup): number[] {
  return group.itemIndices.filter((_, slot) => !group.items[slot]?.optional);
}

function optionalIndices(group: MovementGroup): number[] {
  return group.itemIndices.filter((_, slot) => group.items[slot]?.optional);
}

/**
 * Does this movement still have work the lifter has not turned down?
 *
 * Optional sets count. A 3–5 set prescription is not over at three, and
 * treating it as over is the app choosing the lifter's volume; declining is
 * the "End movement" button, which is what `declined` records.
 */
export function hasOpenWork(
  group: MovementGroup,
  covered: ReadonlySet<number>,
  declined: ReadonlySet<string>,
): boolean {
  if (requiredIndices(group).some((index) => !covered.has(index))) return true;
  if (declined.has(movementGroupKey(group))) return false;
  return optionalIndices(group).some((index) => !covered.has(index));
}

/**
 * The next movement to put in front of the lifter, or null to stay put.
 *
 * Searches forward from the active movement and wraps, so a set logged out of
 * order does not strand the sets before it.
 */
export function nextOpenMovement(
  groups: readonly MovementGroup[],
  activeKey: string,
  covered: ReadonlySet<number>,
  declined: ReadonlySet<string>,
): string | null {
  const start = groups.findIndex((group) => movementGroupKey(group) === activeKey);
  for (let offset = 1; offset <= groups.length; offset += 1) {
    const candidate = groups[(start + offset) % groups.length];
    if (!candidate) continue;
    if (hasOpenWork(candidate, covered, declined)) {
      return movementGroupKey(candidate);
    }
  }
  return null;
}

/**
 * Where to go once a save has covered `covered`.
 *
 * Returns null to stay on the current movement — which is the answer whenever
 * it still has open work, so finishing the required sets of a 3–5 no longer
 * walks the lifter out of it.
 *
 * A circuit keeps its round-major rotation, and only once the rotation has
 * nothing left does the ordinary forward search run. Both consult the same
 * `covered` set, so a caller that under-reports what it wrote can strand the
 * lifter on a movement whose lookup keeps pointing back at itself.
 */
export function nextMovementAfterSave({
  groups,
  activeKey,
  covered,
  declined,
  circuitId,
  circuits,
}: {
  groups: readonly MovementGroup[];
  activeKey: string;
  covered: ReadonlySet<number>;
  declined: ReadonlySet<string>;
  circuitId: string | null;
  circuits: ReadonlyMap<string, LinkedCircuitInfo>;
}): string | null {
  if (circuitId) {
    const next =
      firstOpenCircuitMovementId(circuitId, groups, circuits, covered) ??
      // The required rounds are done, but a 3–5 set superset still alternates
      // through its optional sets.
      firstOpenOptionalCircuitMovementId(
        circuitId,
        groups,
        circuits,
        covered,
        declined,
      );
    if (next && next !== activeKey) return next;
    if (next) return null;
  }
  const active = groups.find((group) => movementGroupKey(group) === activeKey);
  if (active && hasOpenWork(active, covered, declined)) return null;
  return nextOpenMovement(groups, activeKey, covered, declined);
}
