/**
 * Smart accessory ordering — pure station-clustering permutation.
 */
import { describe, it, expect } from "vitest";
import {
  stationRank,
  smartAccessoryOrder,
  applyCustomOrder,
  type AccessoryMeta,
} from "../accessory-order";

describe("stationRank", () => {
  it("orders barbell before dumbbell before cable before machine before band/bodyweight", () => {
    expect(stationRank("barbell")).toBeLessThan(stationRank("dumbbells"));
    expect(stationRank("dumbbells")).toBeLessThan(stationRank("cable-row"));
    expect(stationRank("cable-row")).toBeLessThan(stationRank("machine-row"));
    expect(stationRank("machine-row")).toBeLessThan(stationRank("band"));
    expect(stationRank("band")).toBeLessThan(stationRank("bodyweight"));
  });

  it("falls back to a mid rank for unknown/empty equipment", () => {
    expect(stationRank(null)).toBe(stationRank("something-weird"));
    expect(stationRank("")).toBe(stationRank(undefined));
  });
});

type Item = { movementId: string; label: string };

describe("smartAccessoryOrder", () => {
  const meta: Record<string, AccessoryMeta> = {
    "wrist-curl-bb": { equipment: "barbell", region: "elbow_forearm" },
    "db-row": { equipment: "dumbbells", region: "shoulder_scapular" },
    "leg-curl": { equipment: "machine-leg-curl", region: "hamstring_posterior" },
    "monster-walk": { equipment: "band", region: "hamstring_posterior" },
    "pull-up": { equipment: "bar", region: "shoulder_scapular" },
  };

  function order(ids: string[]): string[] {
    const items: Item[] = ids.map((id) => ({ movementId: id, label: id }));
    return smartAccessoryOrder(items, (i) => i.movementId, meta).map((i) => i.movementId);
  }

  it("clusters by equipment station (barbell/bar → dumbbell → machine → band)", () => {
    const result = order(["monster-walk", "leg-curl", "db-row", "wrist-curl-bb", "pull-up"]);
    // barbell + bar first, dumbbell next, machine next, band last
    expect(result.indexOf("wrist-curl-bb")).toBeLessThan(result.indexOf("db-row"));
    expect(result.indexOf("pull-up")).toBeLessThan(result.indexOf("db-row"));
    expect(result.indexOf("db-row")).toBeLessThan(result.indexOf("leg-curl"));
    expect(result.indexOf("leg-curl")).toBeLessThan(result.indexOf("monster-walk"));
  });

  it("is a stable permutation — same set, no items lost or duplicated", () => {
    const input = ["monster-walk", "leg-curl", "db-row", "wrist-curl-bb", "pull-up"];
    const result = order(input);
    expect([...result].sort()).toEqual([...input].sort());
    expect(result).toHaveLength(input.length);
  });

  it("preserves the original relative order within the same station", () => {
    const sameStation: Record<string, AccessoryMeta> = {
      a: { equipment: "dumbbells", region: "knee" },
      b: { equipment: "dumbbells", region: "knee" },
      c: { equipment: "dumbbells", region: "knee" },
    };
    const items: Item[] = [
      { movementId: "b", label: "b" },
      { movementId: "a", label: "a" },
      { movementId: "c", label: "c" },
    ];
    const result = smartAccessoryOrder(items, (i) => i.movementId, sameStation).map(
      (i) => i.movementId,
    );
    expect(result).toEqual(["b", "a", "c"]);
  });

  it("leaves an empty list untouched", () => {
    expect(smartAccessoryOrder([], (i: Item) => i.movementId, meta)).toEqual([]);
  });
});

describe("applyCustomOrder", () => {
  const items: Item[] = [
    { movementId: "a", label: "a" },
    { movementId: "b", label: "b" },
    { movementId: "c", label: "c" },
  ];
  const idOf = (i: Item) => i.movementId;

  it("returns the baseline unchanged for an empty/missing custom order", () => {
    expect(applyCustomOrder(items, idOf, null)).toBe(items);
    expect(applyCustomOrder(items, idOf, [])).toBe(items);
  });

  it("reorders to the user's saved sequence", () => {
    const result = applyCustomOrder(items, idOf, ["c", "a", "b"]).map(idOf);
    expect(result).toEqual(["c", "a", "b"]);
  });

  it("places listed items first and keeps un-listed ones in baseline order after", () => {
    // Only 'c' is in the custom order (e.g. the others were swapped/added since).
    const result = applyCustomOrder(items, idOf, ["c"]).map(idOf);
    expect(result).toEqual(["c", "a", "b"]);
  });

  it("never drops or duplicates an item", () => {
    const result = applyCustomOrder(items, idOf, ["b", "zzz-not-present"]).map(idOf);
    expect([...result].sort()).toEqual(["a", "b", "c"]);
    expect(result[0]).toBe("b");
  });
});
