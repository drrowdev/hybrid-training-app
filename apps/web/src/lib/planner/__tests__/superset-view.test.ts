/**
 * ADR 0026 P4 — read-time superset pairing wrapper (`applySupersetPairing`).
 *
 * The pairing MECHANICS are covered by antagonist-pairs.test.ts; these tests
 * pin the read-seam contract:
 *   - OFF is the identity (same reference) -> byte-identical legacy path.
 *   - ON regroups the SAME survivor set (no add/drop) via the resolver.
 *   - unresolved / unclassifiable movements stay solo.
 */
import { describe, expect, it } from "vitest";
import type { Muscle, Prescription, PrescriptionItem } from "@hta/db";
import {
  applySupersetPairing,
  resolverFromMap,
  type MovementMuscleResolver,
} from "../superset-view";
import { SUPERSET_GROUP_KEY } from "../antagonist-pairs";

function acc(movementId: string, sets = 3): PrescriptionItem {
  return { movementId, kind: "accessory", sets } as PrescriptionItem;
}

function rx(items: PrescriptionItem[]): Prescription {
  return { items } as Prescription;
}

const muscles = new Map<string, Muscle[]>([
  ["curl", ["biceps"]],
  ["pushdown", ["triceps"]],
  ["raise", ["side_delts"]], // no antagonist -> stays solo
]);
const resolve: MovementMuscleResolver = resolverFromMap(muscles);

describe("applySupersetPairing", () => {
  it("returns the input reference unchanged when disabled", () => {
    const p = rx([acc("curl"), acc("pushdown")]);
    expect(applySupersetPairing(p, false, resolve)).toBe(p);
  });

  it("returns the input unchanged when there are no items", () => {
    const p = rx([]);
    expect(applySupersetPairing(p, true, resolve)).toBe(p);
  });

  it("pairs reciprocal antagonists without changing the item set", () => {
    const p = rx([acc("curl"), acc("pushdown")]);
    const out = applySupersetPairing(p, true, resolve);
    // Same movements, same count — only meta + order may change.
    expect(out.items.map((i) => i.movementId).sort()).toEqual([
      "curl",
      "pushdown",
    ]);
    const groups = out.items.map(
      (i) => (i.meta as Record<string, unknown> | undefined)?.[SUPERSET_GROUP_KEY],
    );
    expect(groups[0]).toBeTruthy();
    expect(groups[0]).toBe(groups[1]); // both members share one group id
  });

  it("leaves an accessory with no antagonist solo", () => {
    const p = rx([acc("curl"), acc("raise")]);
    const out = applySupersetPairing(p, true, resolve);
    expect(out.items).toHaveLength(2);
    for (const it of out.items) {
      expect(
        (it.meta as Record<string, unknown> | undefined)?.[SUPERSET_GROUP_KEY],
      ).toBeUndefined();
    }
  });

  it("leaves unresolved movement ids solo (resolver returns empty)", () => {
    const p = rx([acc("curl"), acc("unknown-id")]);
    const out = applySupersetPairing(p, true, resolve);
    for (const it of out.items) {
      expect(
        (it.meta as Record<string, unknown> | undefined)?.[SUPERSET_GROUP_KEY],
      ).toBeUndefined();
    }
  });
});
