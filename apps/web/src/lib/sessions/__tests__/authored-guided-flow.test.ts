import { describe, expect, it } from "vitest";
import { authoredFixture, authoredFixturePrescription } from "@/app/dev/logger-preview/authored-fixture";
import { groupPrescriptionByMovement, movementGroupKey } from "../movement-grouping";
import { buildLinkedCircuitByMovementId, firstOpenMovementId, nextOpenItemIndex } from "../linked-circuit";
import { nextMovementAfterSave } from "../focus-advance";

describe("DC-R3/DC-R6 authored hybrid guided order", () => {
  it("traverses every slot exactly once across all six days and both weeks", () => {
    for (const week of [0, 1]) for (const day of authoredFixture.workouts.keys()) {
      const plan = authoredFixturePrescription(day, week);
      const groups = groupPrescriptionByMovement(plan, true);
      const circuits = buildLinkedCircuitByMovementId(groups);
      const covered = new Set<number>();
      let key = firstOpenMovementId(groups, circuits, covered);
      const visited: number[] = [];
      while (visited.length < plan.items.length) {
        const group = groups.find((entry) => movementGroupKey(entry) === key)!;
        const index = group.itemIndices.find((itemIndex) => !covered.has(itemIndex));
        expect(index, `week ${week}, day ${day}, movement ${key}`).toBeDefined();
        expect(covered.has(index!)).toBe(false);
        visited.push(index!); covered.add(index!);
        key = nextMovementAfterSave({ groups, activeKey: key, covered, declined: new Set(), circuitId: circuits.get(key)?.id ?? null, circuits }) ?? key;
      }
      expect(new Set(visited).size).toBe(plan.items.length);
      expect(nextMovementAfterSave({ groups, activeKey: key, covered, declined: new Set(), circuitId: null, circuits })).toBeNull();
    }
  });
  it("keeps repeated run/station occurrences distinct and preserves their authored order", () => {
    const plan = authoredFixturePrescription();
    const groups = groupPrescriptionByMovement(plan, true);
    const pairs = groups.filter((group) => String(group.items[0]?.meta?.authoredPartId).startsWith("pairs:"));
    expect(pairs).toHaveLength(8);
    expect(new Set(pairs.map(movementGroupKey)).size).toBe(8);
    expect(pairs.map((group) => group.movementName)).toEqual(["Running", "Cable Row", "Running", "Cable Row", "Running", "Cable Row", "Running", "Cable Row"]);
    expect(pairs.every((group) => group.itemIndices.length === 1)).toBe(true);
  });
  it("ordinary circuits alternate stations without multiplying the prescribed rounds", () => {
    const plan = authoredFixturePrescription(2);
    const groups = groupPrescriptionByMovement(plan, true).filter((group) => group.items.some((item) => item.circuit));
    const circuits = buildLinkedCircuitByMovementId(groups);
    const covered = new Set<number>();
    let key = firstOpenMovementId(groups, circuits, covered);
    const names: string[] = [];
    for (let i = 0; i < 4; i++) {
      const group = groups.find((entry) => movementGroupKey(entry) === key)!;
      names.push(group.movementName);
      covered.add(nextOpenItemIndex(group, covered)!);
      key = nextMovementAfterSave({ groups, activeKey: key, covered, declined: new Set(), circuitId: circuits.get(key)!.id, circuits }) ?? key;
    }
    expect(names).toEqual(["Cable Row", "Band External Rotation", "Cable Row", "Band External Rotation"]);
  });
});
