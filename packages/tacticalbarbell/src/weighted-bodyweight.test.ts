/**
 * Weighted bodyweight movements — a 1RM that counts BODYWEIGHT PLUS the belt.
 *
 * The `weighted-bw` lift kind was declared and documented long before anything
 * implemented it, so weighted pull-ups fell through to the barbell path: an
 * 85 kg lifter with a 110 kg system max was told to hang 77 kg off a belt at
 * 70%, and to warm up with 30 / 46 / 61 kg. These tests pin the arithmetic that
 * makes that impossible.
 */
import { describe, it, expect } from "vitest";
import type { PlatformContext } from "@hta/program-core";
import { itemsOfKind } from "@hta/program-core";
import { tacticalBarbellEngine as tb, type TbInstance } from "./program";

const BODYWEIGHT_KG = 85;

function ctxWith(overrides: Partial<PlatformContext> = {}): PlatformContext {
  return {
    oneRepMaxes: {
      bench: 100,
      squat: 200,
      // 110 kg of system load for an 85 kg lifter = a +25 kg pull-up.
      "weighted-pullup": 110,
    },
    roundingKg: 2.5,
    bodyweightKg: BODYWEIGHT_KG,
    ...overrides,
  };
}

function operator(ctx: PlatformContext): TbInstance {
  return tb.setup({ values: {} }, ctx);
}

function pullupItems(ctx: PlatformContext, ref: string) {
  const p = tb.prescribe(operator(ctx), ref, ctx);
  return {
    main: itemsOfKind(p, "main").find((i) => i.movementId === "weighted-pullup"),
    warmups: itemsOfKind(p, "warmup").filter((i) => i.movementId === "weighted-pullup"),
  };
}

describe("weighted pull-ups are prescribed off a system load", () => {
  it("puts the total minus bodyweight on the belt, not the total", () => {
    // Week 5 runs at 80%: 0.80 × 110 = 88 kg of system load.
    const { main } = pullupItems(ctxWith(), "b0-w5-s1");
    expect(main?.percentOfTm).toBe(0.8);
    expect(main?.weightKg).toBe(2.5); // 88 − 85 = 3 → nearest 2.5 kg
  });

  it("prescribes a bodyweight set when the percentage lands under bodyweight", () => {
    // Week 1 runs at 75%: 0.75 × 110 = 82.5 kg, below an 85 kg lifter.
    const { main } = pullupItems(ctxWith(), "b0-w1-s1");
    expect(main?.weightKg).toBe(0);
    expect(main?.systemLoad).toBe(true);
    // Still the template's rep scheme — this is not the max-reps `bodyweight`
    // kind, it is a loaded lift that happens to need no plates today.
    expect(main?.reps).toBe(5);
  });

  it("never prescribes a negative belt load", () => {
    const { main } = pullupItems(
      ctxWith({ oneRepMaxes: { "weighted-pullup": 90 } }),
      "b0-w1-s1",
    );
    expect(main?.weightKg).toBe(0);
  });

  it("ramps warm-ups on the system load, then converts each step to belt load", () => {
    // A stronger lifter: 160 kg of system load at 85 kg bodyweight (+75 kg).
    // 0.85 × 160 = 136 kg. The ladder's 40% / 60% steps (54.4 / 81.6 kg) are
    // under bodyweight — one plain pull-up — and only the 80% step adds plates.
    const ctx = ctxWith({ oneRepMaxes: { "weighted-pullup": 160 } });
    const { main, warmups } = pullupItems(ctx, "b0-w3-s1");
    expect(warmups.map((w) => w.weightKg)).toEqual([0, 22.5]);
    expect(warmups[0]?.reps).toBe(5);
    // Every warm-up stays below the work set.
    for (const w of warmups) expect(w.weightKg!).toBeLessThan(main!.weightKg!);
  });

  it("collapses a ramp that is entirely under bodyweight into one prep set", () => {
    // 0.85 × 110 = 93.5 kg; every ladder step lands under an 85 kg lifter.
    const { warmups } = pullupItems(ctxWith(), "b0-w3-s1");
    expect(warmups).toHaveLength(1);
    expect(warmups[0]?.weightKg).toBe(0);
  });

  it("marks the items so the app knows a 0 kg load is a prescription", () => {
    const { main, warmups } = pullupItems(ctxWith(), "b0-w3-s1");
    expect(main?.systemLoad).toBe(true);
    expect(warmups.every((w) => w.systemLoad === true)).toBe(true);
  });

  it("applies the optional training max to the system 1RM", () => {
    const ctx = ctxWith();
    const inst = { ...operator(ctx), useTrainingMax: true, tmPercent: 0.9 };
    const p = tb.prescribe(inst, "b0-w5-s1", ctx);
    const main = itemsOfKind(p, "main").find((i) => i.movementId === "weighted-pullup");
    // TM = 110 × 0.9 = 99 kg of system load; 80% of that = 79.2, under 85 kg.
    expect(main?.weightKg).toBe(0);
  });

  it("leaves the load unresolved rather than guessing when bodyweight is unknown", () => {
    const ctx = ctxWith();
    delete (ctx as { bodyweightKg?: number }).bodyweightKg;
    const { main, warmups } = pullupItems(ctx, "b0-w5-s1");
    expect(main?.weightKg).toBeUndefined();
    expect(main?.percentOfTm).toBe(0.8);
    expect(warmups).toHaveLength(0);
  });

  it("leaves barbell lifts on the straight percentage", () => {
    const ctx = ctxWith();
    const p = tb.prescribe(operator(ctx), "b0-w5-s1", ctx);
    const squat = itemsOfKind(p, "main").find((i) => i.movementId === "squat");
    expect(squat?.weightKg).toBe(160); // 0.8 × 200, bodyweight irrelevant
    expect(squat?.systemLoad).toBeUndefined();
  });
});
