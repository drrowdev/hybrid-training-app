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
  });

  it("turns a bodyweight-only set into max clean reps, not the loaded rep scheme", () => {
    // TB3 does not run the loaded scheme at bodyweight — with nothing left to
    // add, the set is repped out, so a light week still drives the pull-up.
    const { main } = pullupItems(ctxWith(), "b0-w1-s1");
    expect(main?.isAmrap).toBe(true);
    // The loaded prescription's rep CEILING goes with the load it belonged to.
    expect(main?.repsMax).toBeUndefined();
    // The loaded "stop short of failure" cue would contradict an open set.
    expect(main?.note ?? "").not.toMatch(/short of failure/i);
  });

  it("leaves a loaded set on the template's rep scheme", () => {
    const { main } = pullupItems(ctxWith(), "b0-w5-s1");
    expect(main?.weightKg).toBeGreaterThan(0);
    expect(main?.isAmrap).toBeUndefined();
    expect(main?.reps).toBe(5);
  });

  it("never prescribes a negative belt load", () => {
    const { main } = pullupItems(
      ctxWith({ oneRepMaxes: { "weighted-pullup": 90 } }),
      "b0-w1-s1",
    );
    expect(main?.weightKg).toBe(0);
    expect(main?.isAmrap).toBe(true);
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

describe("the belt-loaded kind survives however the cluster was stored", () => {
  // The reported bug. `kind` used to be carried ALONGSIDE the movement, so a
  // cluster that reached the engine untagged — stored as bare movement strings,
  // or saved before the kind existed — fell through to the barbell path and put
  // the whole bodyweight-inclusive total on the belt. An 118 kg max at 85%
  // became a 100 kg working set warmed up at +40 / +60 / +80 kg.
  const ctx = ctxWith({ oneRepMaxes: { bench: 100, squat: 200, "weighted-pullup": 118 } });

  function ownClusterInstance(cluster: unknown) {
    return tb.setup(
      { values: { templateId: "operator", useTemplateDefaults: false, cluster } },
      ctx,
    );
  }

  it("derives it for a cluster stored as bare movement strings", () => {
    const inst = ownClusterInstance(["bench", "squat", "weighted-pullup"]);
    expect(inst.cluster.find((c) => c.movement === "weighted-pullup")?.kind).toBe(
      "weighted-bw",
    );
  });

  it("derives it for an entry object that carries no kind", () => {
    const inst = ownClusterInstance([
      { movement: "bench" },
      { movement: "squat" },
      { movement: "weighted-pullup" },
    ]);
    expect(inst.cluster.find((c) => c.movement === "weighted-pullup")?.kind).toBe(
      "weighted-bw",
    );
  });

  it("never ramps an untagged weighted pull-up on the raw total", () => {
    const inst = ownClusterInstance(["bench", "squat", "weighted-pullup"]);
    const p = tb.prescribe(inst, "b0-w5-s1", ctx);
    const pullup = (kind: "warmup" | "main") =>
      itemsOfKind(p, kind).filter((i) => i.movementId === "weighted-pullup");

    // 0.85 × 118 = 100.3 kg of SYSTEM load. The belt takes what is left after
    // an 85 kg lifter, and the whole ramp sits under bodyweight.
    expect(pullup("main")[0]?.weightKg).toBe(15);
    expect(pullup("main")[0]?.systemLoad).toBe(true);
    expect(pullup("warmup").map((w) => w.weightKg)).toEqual([0]);
    // The numbers from the report must not be reachable.
    for (const item of [...pullup("warmup"), ...pullup("main")]) {
      expect(item.weightKg).toBeLessThan(ctx.bodyweightKg!);
    }
  });

  it("does not re-kind a movement the lifter explicitly tagged otherwise", () => {
    const inst = ownClusterInstance([
      { movement: "weighted-pullup", kind: "unanchored" },
    ]);
    expect(inst.cluster[0]?.kind).toBe("unanchored");
  });

  it("leaves a movement that is not belt-loaded untagged", () => {
    const inst = ownClusterInstance(["squat"]);
    expect(inst.cluster[0]?.kind).toBeUndefined();
  });
});
