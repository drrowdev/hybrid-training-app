/**
 * Item-level circuit navigation — the properties the movement-group model could
 * not express, and which user-authored links depend on.
 */
import { describe, expect, it } from "vitest";
import type { PrescriptionItem } from "@hta/db";
import type { MovementGroup } from "../movement-grouping";
import {
  buildLinkedCircuitByMovementId,
  circuitRoundFor,
  circuitSuppressesRest,
  firstOpenCircuitMovementId,
  firstOpenMovementId,
  isCircuitItemIndex,
  nextOpenItemIndex,
  participatingItemIndices,
  soloItemIndices,
} from "../linked-circuit";

const CIRCUIT = { id: "link-1", name: "Superset", size: 2, rounds: 3 };
/** Circuit info as membership resolves it — per member, so `position` is real. */
const at = (position: number) => ({ ...CIRCUIT, position });

/**
 * A main lift as the adapter really materialises it: warm-up ramp first, then
 * one loggable item per working set, with the circuit stamped only on the sets
 * that take part in the rotation.
 */
function mainLiftGroup(opts: {
  movementId: string;
  position: number;
  startIndex: number;
  warmups: number;
  working: number;
  /** Working sets that participate; defaults to all of them. */
  participating?: number;
  optionalTail?: number;
}): MovementGroup {
  const {
    movementId,
    position,
    startIndex,
    warmups,
    working,
    participating = working,
    optionalTail = 0,
  } = opts;
  const items: PrescriptionItem[] = [];
  for (let i = 0; i < warmups; i += 1) {
    items.push({ movementId, kind: "warmup", sets: 1, reps: 5 });
  }
  for (let i = 0; i < working; i += 1) {
    items.push({
      movementId,
      kind: "main",
      sets: 1,
      reps: 5,
      ...(i < participating
        ? { circuit: { ...CIRCUIT, position, round: i } }
        : {}),
    });
  }
  for (let i = 0; i < optionalTail; i += 1) {
    items.push({ movementId, kind: "main", sets: 1, reps: 5, optional: true });
  }
  const itemIndices = items.map((_, i) => startIndex + i);
  return {
    movementId,
    movementName: movementId,
    movementSlug: movementId,
    itemIndices,
    items,
    slotBuckets: {
      warmup: items.flatMap((it, i) => (it.kind === "warmup" ? [i] : [])),
      working: items.flatMap((it, i) => (it.kind === "warmup" ? [] : [i])),
      accessory: [],
    },
  };
}

describe("circuit membership on anchored main lifts", () => {
  // Previously `circuitInfo` read `items[0]`, which on an anchored main lift is
  // a WARM-UP carrying no circuit metadata — so linking main lifts silently did
  // nothing at all.
  const squat = mainLiftGroup({
    movementId: "squat",
    position: 0,
    startIndex: 0,
    warmups: 2,
    working: 3,
  });
  const bench = mainLiftGroup({
    movementId: "bench",
    position: 1,
    startIndex: 5,
    warmups: 2,
    working: 3,
  });
  const groups = [squat, bench];

  it("detects the circuit even though items[0] is a warm-up", () => {
    const membership = buildLinkedCircuitByMovementId(groups);
    expect([...membership.keys()]).toEqual(["squat", "bench"]);
  });

  it("excludes warm-ups from the rotation", () => {
    expect(participatingItemIndices(squat, at(0))).toEqual([2, 3, 4]);
    expect(soloItemIndices(squat, at(0))).toEqual([0, 1]);
    expect(isCircuitItemIndex(squat, at(0), 0)).toBe(false);
    expect(isCircuitItemIndex(squat, at(0), 2)).toBe(true);
  });

  it("counts rounds from working sets only, not the warm-up ramp", () => {
    // Both warm-ups logged — still round 1, no circuit progress.
    expect(circuitRoundFor(squat, at(0), new Set([0, 1]))).toBe(1);
    expect(circuitRoundFor(squat, at(0), new Set([0, 1, 2]))).toBe(2);
  });

  it("alternates round-major across the two lifts", () => {
    const m = buildLinkedCircuitByMovementId(groups);
    const open = (covered: number[]) =>
      firstOpenCircuitMovementId("link-1", groups, m, new Set(covered));
    expect(open([0, 1])).toBe("squat");
    expect(open([0, 1, 2])).toBe("bench");
    expect(open([0, 1, 2, 7])).toBe("squat");
    expect(open([0, 1, 2, 3, 7])).toBe("bench");
    expect(open([2, 3, 4, 7, 8, 9])).toBeNull();
  });

  it("suppresses rest only mid-round, and never on a warm-up", () => {
    // Squat is position 0 of 2 — another station follows, so no rest.
    expect(circuitSuppressesRest(squat, at(0), 2)).toBe(true);
    // ...but its warm-ups rest normally.
    expect(circuitSuppressesRest(squat, at(0), 0)).toBe(false);
    // Bench closes the round, so it rests.
    expect(circuitSuppressesRest(bench, at(1), 7)).toBe(false);
  });

  it("offers the warm-up before the rotation", () => {
    const m = buildLinkedCircuitByMovementId(groups);
    // Nothing logged: squat is next, and its own cursor lands on the warm-up.
    expect(firstOpenMovementId(groups, m, new Set())).toBe("squat");
    expect(nextOpenItemIndex(squat, new Set())).toBe(0);
    // Warm-ups done -> first rotation set.
    expect(nextOpenItemIndex(squat, new Set([0, 1]))).toBe(2);
  });
});

describe("unequal set counts", () => {
  // Squat runs five working sets, the curl three. `rounds = min(...)`, so the
  // last two squat sets fall OUT of the rotation and run solo. The old model
  // never offered them yet still demanded them for completion, so the Finish
  // bar could never arm.
  const squat = mainLiftGroup({
    movementId: "squat",
    position: 0,
    startIndex: 0,
    warmups: 0,
    working: 5,
    participating: 3,
  });
  const curl = mainLiftGroup({
    movementId: "curl",
    position: 1,
    startIndex: 5,
    warmups: 0,
    working: 3,
  });
  const groups = [squat, curl];

  it("links despite the mismatch, keeping only `rounds` sets in rotation", () => {
    const m = buildLinkedCircuitByMovementId(groups);
    expect(m.size).toBe(2);
    expect(participatingItemIndices(squat, at(0))).toEqual([0, 1, 2]);
    expect(soloItemIndices(squat, at(0))).toEqual([3, 4]);
  });

  it("offers the leftover sets once the rounds are done", () => {
    const m = buildLinkedCircuitByMovementId(groups);
    const allRounds = new Set([0, 1, 2, 5, 6, 7]);
    expect(firstOpenCircuitMovementId("link-1", groups, m, allRounds)).toBeNull();
    // The two trailing squat sets are still open and MUST be reachable.
    expect(firstOpenMovementId(groups, m, allRounds)).toBe("squat");
    expect(nextOpenItemIndex(squat, allRounds)).toBe(3);
  });

  it("rests normally on a leftover set even though the movement is linked", () => {
    expect(circuitSuppressesRest(squat, at(0), 3)).toBe(false);
  });

  it("reaches full completion, so the finish bar can arm", () => {
    const m = buildLinkedCircuitByMovementId(groups);
    const everything = new Set([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(firstOpenCircuitMovementId("link-1", groups, m, everything)).toBeNull();
    // No group reports open work; the fallback is the first group, not a loop.
    const stillOpen = groups.some((g) =>
      soloItemIndices(g, m.get(g.movementId)).some(
        (i) => !everything.has(i),
      ),
    );
    expect(stillOpen).toBe(false);
  });
});

describe("incomplete circuits", () => {
  it("does not link when a member is missing", () => {
    const solo = mainLiftGroup({
      movementId: "squat",
      position: 0,
      startIndex: 0,
      warmups: 1,
      working: 3,
    });
    expect(buildLinkedCircuitByMovementId([solo]).size).toBe(0);
  });

  it("does not link when a member lacks enough participating sets", () => {
    const squat = mainLiftGroup({
      movementId: "squat",
      position: 0,
      startIndex: 0,
      warmups: 0,
      working: 3,
    });
    const short = mainLiftGroup({
      movementId: "curl",
      position: 1,
      startIndex: 3,
      warmups: 0,
      working: 2,
      participating: 2,
    });
    expect(buildLinkedCircuitByMovementId([squat, short]).size).toBe(0);
  });

  it("treats an unlinked group's required slots as ordinary solo work", () => {
    const solo = mainLiftGroup({
      movementId: "squat",
      position: 0,
      startIndex: 0,
      warmups: 1,
      working: 2,
      optionalTail: 1,
    });
    // Optional sets are never required work.
    expect(soloItemIndices(solo, undefined)).toEqual([0, 1, 2]);
    expect(nextOpenItemIndex(solo, new Set([0]))).toBe(1);
  });
});
