/**
 * Rest-timer behaviour inside a linked superset.
 *
 * The promise a superset makes is "you rest ONCE per round". So the timer must
 * stay silent after every station except the last one in the round — and must
 * still fire normally for the warm-up ramp and for any set that falls outside
 * the rotation.
 *
 * These exercise `circuitSuppressesRest` against realistic adapter-expanded
 * groups. `MovementFocusView` calls it with the index it is ACTUALLY saving
 * (its own cursor, which the user can pin), which is why the logger passes a
 * predicate rather than a precomputed boolean.
 */
import { describe, expect, it } from "vitest";
import type { PrescriptionItem } from "@hta/db";
import type { MovementGroup } from "../movement-grouping";
import {
  buildLinkedCircuitByMovementId,
  circuitSuppressesRest,
} from "../linked-circuit";

const LINK = { id: "link-1", name: "Superset", size: 2, rounds: 3 };

/** A lift as the adapter materialises it: warm-up ramp, then one item per set. */
function lift(opts: {
  movementId: string;
  position: number;
  startIndex: number;
  warmups: number;
  working: number;
  rotating?: number;
}): MovementGroup {
  const { movementId, position, startIndex, warmups, working } = opts;
  const rotating = opts.rotating ?? working;
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
      ...(i < rotating ? { circuit: { ...LINK, position, round: i } } : {}),
    });
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

describe("rest timer inside a linked superset", () => {
  // Squat (A1) 2 warm-ups + 3 working; bench (A2) 2 warm-ups + 3 working.
  const squat = lift({
    movementId: "squat",
    position: 0,
    startIndex: 0,
    warmups: 2,
    working: 3,
  });
  const bench = lift({
    movementId: "bench",
    position: 1,
    startIndex: 5,
    warmups: 2,
    working: 3,
  });
  const membership = buildLinkedCircuitByMovementId([squat, bench]);
  const squatLink = membership.get("squat");
  const benchLink = membership.get("bench");

  it("links both lifts", () => {
    expect(squatLink).toBeDefined();
    expect(benchLink).toBeDefined();
  });

  it("does NOT start the timer after the first station's set", () => {
    // Squat is A1 of 2 — bench follows in the same round, so no rest.
    for (const index of [2, 3, 4]) {
      expect(circuitSuppressesRest(squat, squatLink, index)).toBe(true);
    }
  });

  it("DOES start the timer after the last station closes the round", () => {
    for (const index of [7, 8, 9]) {
      expect(circuitSuppressesRest(bench, benchLink, index)).toBe(false);
    }
  });

  it("still rests through the warm-up ramp of a linked lift", () => {
    expect(circuitSuppressesRest(squat, squatLink, 0)).toBe(false);
    expect(circuitSuppressesRest(squat, squatLink, 1)).toBe(false);
    expect(circuitSuppressesRest(bench, benchLink, 5)).toBe(false);
  });

  it("rests normally on a set past the round count", () => {
    // Squat runs 5 working sets but the group only rotates 3.
    const long = lift({
      movementId: "squat",
      position: 0,
      startIndex: 0,
      warmups: 0,
      working: 5,
      rotating: 3,
    });
    const partner = lift({
      movementId: "curl",
      position: 1,
      startIndex: 5,
      warmups: 0,
      working: 3,
    });
    const m = buildLinkedCircuitByMovementId([long, partner]);
    const info = m.get("squat");
    expect(circuitSuppressesRest(long, info, 2)).toBe(true); // last rotation set
    expect(circuitSuppressesRest(long, info, 3)).toBe(false); // solo tail
    expect(circuitSuppressesRest(long, info, 4)).toBe(false);
  });

  it("rests after every station of a tri-set except the third", () => {
    const tri = { id: "link-1", name: "Tri-set", size: 3, rounds: 2 };
    const make = (movementId: string, position: number, startIndex: number) => {
      const items: PrescriptionItem[] = [0, 1].map((round) => ({
        movementId,
        kind: "accessory" as const,
        sets: 1,
        reps: 10,
        circuit: { ...tri, position, round },
      }));
      return {
        movementId,
        movementName: movementId,
        movementSlug: movementId,
        itemIndices: items.map((_, i) => startIndex + i),
        items,
        slotBuckets: { warmup: [], working: [], accessory: [0, 1] },
      } as MovementGroup;
    };
    const groups = [make("a", 0, 0), make("b", 1, 2), make("c", 2, 4)];
    const m = buildLinkedCircuitByMovementId(groups);
    expect(circuitSuppressesRest(groups[0]!, m.get("a"), 0)).toBe(true);
    expect(circuitSuppressesRest(groups[1]!, m.get("b"), 2)).toBe(true);
    expect(circuitSuppressesRest(groups[2]!, m.get("c"), 4)).toBe(false);
  });

  it("rests normally when the movement is not linked at all", () => {
    const solo = lift({
      movementId: "row",
      position: 0,
      startIndex: 0,
      warmups: 1,
      working: 3,
      rotating: 0,
    });
    expect(circuitSuppressesRest(solo, undefined, 1)).toBe(false);
    expect(circuitSuppressesRest(solo, undefined, 2)).toBe(false);
  });
});
