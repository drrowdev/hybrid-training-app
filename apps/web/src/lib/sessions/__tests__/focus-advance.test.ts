/**
 * Where the focus logger goes after a save.
 *
 * Every case here is a way the logger left the lifter somewhere they did not
 * ask to be — or would not let them leave at all.
 */
import { describe, expect, it } from "vitest";
import type { PrescriptionItem } from "@hta/db";
import type { MovementGroup } from "../movement-grouping";
import { buildLinkedCircuitByMovementId } from "../linked-circuit";
import {
  hasOpenWork,
  nextMovementAfterSave,
  nextOpenMovement,
  resolveInitialActiveKey,
} from "../focus-advance";

const CIRCUIT = { id: "link-1", name: "Superset", size: 2, rounds: 3 };

function group(opts: {
  movementId: string;
  startIndex: number;
  required: number;
  optional?: number;
  /** Circuit position; omit for solo work. */
  position?: number;
}): MovementGroup {
  const { movementId, startIndex, required, optional = 0, position } = opts;
  const items: PrescriptionItem[] = [];
  for (let i = 0; i < required; i += 1) {
    items.push({
      movementId,
      kind: "main",
      sets: 1,
      reps: 5,
      ...(position != null
        ? { circuit: { ...CIRCUIT, position, round: i } }
        : {}),
    } as unknown as PrescriptionItem);
  }
  for (let i = 0; i < optional; i += 1) {
    items.push({
      movementId,
      kind: "main",
      sets: 1,
      reps: 5,
      optional: true,
    } as unknown as PrescriptionItem);
  }
  return {
    movementId,
    movementName: movementId,
    movementSlug: movementId,
    itemIndices: items.map((_, i) => startIndex + i),
    items,
    slotBuckets: {
      warmup: [],
      working: items.map((_, i) => i),
      accessory: [],
    },
  };
}

const none = new Set<string>();

describe("hasOpenWork", () => {
  const ranged = group({ movementId: "row", startIndex: 0, required: 3, optional: 2 });

  it("counts the optional sets of a 3–5 prescription", () => {
    expect(hasOpenWork(ranged, new Set([0, 1, 2]), none)).toBe(true);
  });

  it("is satisfied once every set is covered", () => {
    expect(hasOpenWork(ranged, new Set([0, 1, 2, 3, 4]), none)).toBe(false);
  });

  it("is satisfied once the lifter has declined the optional sets", () => {
    // "End movement" is how you leave early, and it has to actually let you.
    expect(hasOpenWork(ranged, new Set([0, 1, 2]), new Set(["row"]))).toBe(false);
  });

  it("ignores a decline while required work is still open", () => {
    expect(hasOpenWork(ranged, new Set([0]), new Set(["row"]))).toBe(true);
  });
});

describe("nextMovementAfterSave — solo work", () => {
  const row = group({ movementId: "row", startIndex: 0, required: 3, optional: 2 });
  const curl = group({ movementId: "curl", startIndex: 5, required: 2 });
  const groups = [row, curl];
  const after = (covered: number[], declined = none) =>
    nextMovementAfterSave({
      groups,
      activeKey: "row",
      covered: new Set(covered),
      declined,
      circuitId: null,
      circuits: new Map(),
    });

  it("stays put when the required sets are done but optional ones are not", () => {
    // Reported as: the cursor moves on when I finish the 3rd of 5.
    expect(after([0, 1, 2])).toBeNull();
  });

  it("moves on once every set is covered", () => {
    expect(after([0, 1, 2, 3, 4])).toBe("curl");
  });

  it("moves on when the lifter has declined the optional sets", () => {
    expect(after([0, 1, 2], new Set(["row"]))).toBe("curl");
  });

  it("stays put while an earlier set is still open", () => {
    // A set logged out of order must not strand the ones before it.
    expect(after([1, 2, 3, 4])).toBeNull();
  });

  it("has nowhere to go when the whole session is covered", () => {
    expect(after([0, 1, 2, 3, 4, 5, 6])).toBeNull();
  });
});

describe("nextMovementAfterSave — a linked superset", () => {
  // Two stations, three rounds, alternating A1 → A2 → A1 → A2 …
  const a1 = group({ movementId: "press", startIndex: 0, required: 3, position: 0 });
  const a2 = group({ movementId: "pull", startIndex: 3, required: 3, position: 1 });
  const curl = group({ movementId: "curl", startIndex: 6, required: 1 });
  const groups = [a1, a2, curl];
  const circuits = buildLinkedCircuitByMovementId(groups);
  const after = (activeKey: string, covered: number[]) =>
    nextMovementAfterSave({
      groups,
      activeKey,
      covered: new Set(covered),
      declined: none,
      circuitId: CIRCUIT.id,
      circuits,
    });

  it("alternates stations round by round", () => {
    expect(after("press", [0])).toBe("pull");
    expect(after("pull", [0, 3])).toBe("press");
  });

  it("leaves the circuit once every round is covered", () => {
    expect(after("pull", [0, 1, 2, 3, 4, 5])).toBe("curl");
  });

  it("keeps the rotation going when a station is skipped mid-circuit", () => {
    // Skipping the rest of the FIRST station does not leave the circuit: the
    // partner still owes its rounds, so the lifter is handed over to it.
    expect(after("press", [0, 1, 2])).toBe("pull");
  });

  it("lets the lifter out after skipping the last open station", () => {
    // The bug: "skip remaining sets" wrote every open slot but reported only
    // the cursor's, so the round-major lookup still saw the rounds it had just
    // skipped as open, pointed back at this same station, and the lifter was
    // parked on a movement with nothing left to do.
    //
    // Standing on A2 with A1 done and round 0 behind them, skipping the rest
    // covers rounds 1 and 2.
    expect(after("pull", [0, 1, 2, 3, 4, 5])).toBe("curl");
  });

  it("would strand the lifter if a caller under-reported what it wrote", () => {
    // The same skip, reporting only the cursor slot — the shape of the bug.
    // Round 1 still shows A2 as open, so the lookup points back at the station
    // the lifter is already on and nothing moves. Null is "stay here", which
    // on a movement with nothing left to do is the trap.
    //
    // Guards the contract rather than the arithmetic: if this ever starts
    // returning "curl", under-reporting has stopped mattering and the test
    // above would be passing for the wrong reason.
    expect(after("pull", [0, 1, 2, 3])).toBeNull();
  });
});

describe("nextOpenMovement", () => {
  const a = group({ movementId: "a", startIndex: 0, required: 1 });
  const b = group({ movementId: "b", startIndex: 1, required: 1 });
  const c = group({ movementId: "c", startIndex: 2, required: 1 });
  const groups = [a, b, c];

  it("searches forward from the active movement", () => {
    expect(nextOpenMovement(groups, "a", new Set([0]), none)).toBe("b");
  });

  it("wraps to pick up work left behind", () => {
    expect(nextOpenMovement(groups, "c", new Set([1, 2]), none)).toBe("a");
  });

  it("returns null when nothing is open", () => {
    expect(nextOpenMovement(groups, "a", new Set([0, 1, 2]), none)).toBeNull();
  });
});

describe("resolveInitialActiveKey (defect #3)", () => {
  const a = group({ movementId: "a", startIndex: 0, required: 3 });
  const b = group({ movementId: "b", startIndex: 3, required: 3 });
  const groups = [a, b];

  it("uses the resumed movement when it still exists in the current groups", () => {
    // Movement A mounting first and ignoring B's resume draft is exactly the
    // defect: the lifter was mid-set on B, and the strip must reopen there,
    // not on A (the first-open fallback).
    expect(resolveInitialActiveKey(groups, "a", "b")).toBe("b");
  });

  it("falls back to firstOpenId when there is no resume state", () => {
    expect(resolveInitialActiveKey(groups, "a", null)).toBe("a");
    expect(resolveInitialActiveKey(groups, "a", undefined)).toBe("a");
  });

  it("falls back to firstOpenId when the resumed key is stale/foreign (e.g. removed by a swap)", () => {
    expect(resolveInitialActiveKey(groups, "a", "removed-by-swap")).toBe("a");
  });

  it("resuming the already-first-open movement is a no-op", () => {
    expect(resolveInitialActiveKey(groups, "a", "a")).toBe("a");
  });
});
