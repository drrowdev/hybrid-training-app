import { describe, expect, it } from "vitest";
import type { Prescription, PrescriptionItem } from "@hta/db";
import { resolveTargetLoadKg } from "@hta/domain";
import { prepareAuthoredWarmups, type AuthoredWarmupMovement } from "../authored-warmups";
import { roundWarmupLoadKg } from "../warmups";

const meta = { authoredPartId: "bench", authoredMovementId: "bench",
  programLoadBasis: { version: 1, kind: "one-rm", percent: 100, roundingKg: null },
  authoredLoadRoundingKg: 2.5, restSeconds: 150 };
const main: PrescriptionItem = { movementId: "bench", movementSlug: "bench-press-flat",
  movementName: "Bench press", kind: "main", sets: 1, reps: 5, percentTm: 75, meta };
const movement: AuthoredWarmupMovement = { id: "bench", slug: "bench-press-flat", equipment: "barbell",
  oneRmKg: 100, tmKg: 90, loadOptions: { barWeightKg: 20, availablePlateWeightsKg: [1.25] } };
const plan: Prescription = { items: [main, { ...main, optional: true }], programRef: "authored:upper:0" };

describe("DC-A1/DC-R6 authored main-lift warm-up issuance", () => {
  it("adds the configured ramp to an existing saved definition without changing working sets", () => {
    const result = prepareAuthoredWarmups(plan, [movement], null, 87);
    expect(result.items.map((item) => item.kind)).toEqual(["warmup", "warmup", "warmup", "main", "main"]);
    expect(result.items.slice(0, 3).map((item) => [item.percentTm, item.reps])).toEqual([[30, 5], [45, 5], [60, 3]]);
    expect(result.items.slice(3)).toEqual(plan.items);
    expect(result.items[0]?.meta).not.toHaveProperty("authoredLoadRoundingKg");
    expect(result.items[0]?.meta).not.toHaveProperty("restSeconds");
    expect(plan.items).toHaveLength(2);
    expect(prepareAuthoredWarmups(result, [movement], { setCount: 0, percentLadder: [], repLadder: [] }, 87)).toBe(result);
  });
  it("uses the live 1RM and the same bar/plate lattice as logger, fill and snapshots", () => {
    const result = prepareAuthoredWarmups(plan, [movement], null, 87);
    const roundKg = (kg: number) => roundWarmupLoadKg(kg, { barWeightKg: 15, availablePlateWeightsKg: [5] });
    expect(resolveTargetLoadKg(result.items[0], { tmKg: 10, oneRmKg: 100, roundKg })).toBe(35);
    expect(resolveTargetLoadKg(result.items[0], { tmKg: 10, oneRmKg: 150, roundKg })).toBe(45);
    expect(resolveTargetLoadKg(result.items[0], { tmKg: 10, oneRmKg: 20, roundKg })).toBe(15);
    expect(resolveTargetLoadKg(result.items[3], { tmKg: 10, oneRmKg: 102.5, roundKg })).toBe(77.5);
  });
  it("DC-K4 honours disabled and custom warm-ups, including an anchor-based ladder", () => {
    expect(prepareAuthoredWarmups(plan, [movement], { setCount: 0, percentLadder: [], repLadder: [] }, 87).items).toEqual(plan.items);
    const result = prepareAuthoredWarmups(plan, [movement], { setCount: 2, percentLadder: [35, 65], repLadder: [8, 2], anchor: "training_max" }, 87);
    expect(result.items.slice(0, 2).map((item) => [item.percentTm, item.reps])).toEqual([[35, 8], [65, 2]]);
    expect(result.items[0]?.meta).not.toHaveProperty("programLoadBasis");
    expect(resolveTargetLoadKg(result.items[0], { tmKg: 90, oneRmKg: 100, roundKg: roundWarmupLoadKg })).toBe(32.5);
    expect(resolveTargetLoadKg(result.items[0], { tmKg: 80, oneRmKg: 100, roundKg: roundWarmupLoadKg })).toBe(27.5);
  });
  it("does not invent maxes or ramps for unloaded, band, rehab, accessory or circuit work", () => {
    const kinds = ["accessory", "tendon"] as const;
    for (const item of [
      ...kinds.map((kind) => ({ ...main, kind })),
      { ...main, meta: { ...meta, rehab: true } },
      { ...main, circuit: { id: "c", name: "Circuit", position: 0, size: 2, rounds: 3, round: 0 } },
      { ...main, percentTm: undefined, targetWeightKg: 0 },
    ]) expect(prepareAuthoredWarmups({ items: [item] }, [movement], null, 87).items).toEqual([item]);
    for (const m of [{ ...movement, oneRmKg: null }, { ...movement, equipment: "band" },
      { ...movement, equipment: "bodyweight" }]) {
      expect(prepareAuthoredWarmups(plan, [m], null, 87).items).toEqual(plan.items);
    }
  });
  it("subtracts bodyweight once and collapses identical system-load warm-ups", () => {
    const item = { ...main, percentTm: 90, movementSlug: "weighted-pull-up" };
    const m = { ...movement, slug: "weighted-pull-up", equipment: "bodyweight", oneRmKg: 132, loadOptions: {} };
    const result = prepareAuthoredWarmups({ items: [item] }, [m], null, 87);
    const warmups = result.items.filter((entry) => entry.kind === "warmup");
    expect(warmups).toHaveLength(2);
    expect(warmups.map((entry) => resolveTargetLoadKg(entry, {
      oneRmKg: 132, bodyweightKg: 87, isSystemLoad: true, roundKg: roundWarmupLoadKg,
    }))).toEqual([0, 7.5]);
    expect(prepareAuthoredWarmups({ items: [item] }, [m], null, null).items).toEqual([item]);
  });
  it("retains explicit kg work without a fake 1RM", () => {
    const item = { ...main, percentTm: undefined, targetWeightKg: 80 };
    const result = prepareAuthoredWarmups({ items: [item] }, [{ ...movement, oneRmKg: null, tmKg: null }], null, 87);
    expect(result.items.slice(0, 3).map((entry) => entry.targetWeightKg)).toEqual([32, 48, 64]);
    expect(result.items.slice(0, 3).every((entry) => entry.percentTm === undefined)).toBe(true);
    expect(result.items[3]).toBe(item);
  });
});
