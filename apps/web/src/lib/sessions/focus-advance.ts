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
 * Which movement `FocusStripLogger` should mount on.
 *
 * Resume state records which movement the lifter was actually on. Without
 * this, the strip always opens on `firstOpenId` — mounting the FIRST open
 * movement (A) even when the lifter was mid-set on a LATER one (B) — and
 * `MovementFocusView`'s own persist effect then immediately overwrites the
 * resume snapshot with A's cursor/draft/rest timer, destroying B's before
 * the lifter can even see it restored.
 *
 * `resumeActiveKey` is expected to already have passed `readResume`'s own
 * six-hour expiry and session-id checks (it reads from storage, so it isn't
 * pure and is tested separately in `session-resume.test.ts`); this function
 * only adds the guard a resume read cannot: that the key still names a
 * movement in the CURRENT `groups` (rejecting a stale/foreign key, e.g. a
 * movement a swap has since removed from this workout).
 */
export function resolveInitialActiveKey(
  groups: readonly MovementGroup[],
  firstOpenId: string,
  resumeActiveKey: string | null | undefined,
): string {
  if (
    resumeActiveKey != null &&
    groups.some((group) => movementGroupKey(group) === resumeActiveKey)
  ) {
    return resumeActiveKey;
  }
  return firstOpenId;
}

/**
 * Guard against `MovementFocusView`'s stale-closure "late onSaved" race.
 *
 * This component instance is reused across every movement the focus strip
 * shows (never remounted on navigation), so its `handleSubmit` closes over
 * whatever `groupKey`/`onSaved` were current AT THE MOMENT the lifter tapped
 * log. If the lifter manually navigates to a different movement while that
 * write is still in flight, the stale closure's `.then()` still fires later
 * with the OLD movement's key — calling `onSaved` from that stale closure
 * would compute "next movement after the OLD one" and could yank the lifter
 * away from wherever they manually navigated to, overriding their choice.
 *
 * `submittedGroupKey` is captured when the write started; `currentGroupKey`
 * is read from a ref kept live on every render. They differ exactly when a
 * navigation happened during the request — in which case the caller must
 * skip calling `onSaved` (the write itself still landed and its data is
 * tracked independently; only the strip-advance signal is stale).
 */
export function shouldFireOnSaved(
  submittedGroupKey: string,
  currentGroupKey: string,
): boolean {
  return submittedGroupKey === currentGroupKey;
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
