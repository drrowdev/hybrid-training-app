/**
 * Tactical Barbell ProgramEngine — end-to-end through the @hta/program-core
 * contract. Proves a complete TB program (setup → timeline → prescribe →
 * onSessionLogged) with NO DB and NO UI.
 *
 * 1RMs chosen to round cleanly at 2.5 kg across the TB wave (70/75/80/85/90/95%).
 */
import { describe, it, expect } from "vitest";
import type { PlatformContext, LoggedSession } from "@hta/program-core";
import { totalPrescribedSets, itemsOfKind } from "@hta/program-core";
import { tacticalBarbellEngine as tb, type TbInstance } from "./program";

const ctx: PlatformContext = {
  oneRepMaxes: { squat: 200, bench: 100, deadlift: 250, press: 100, pullup: 50 },
  roundingKg: 2.5,
};

function setup(values: Record<string, unknown> = {}): TbInstance {
  return tb.setup({ values }, ctx);
}

describe("TB engine — meta + setup", () => {
  it("identifies as the Tactical Barbell family", () => {
    expect(tb.meta.id).toBe("tactical-barbell");
    expect(tb.meta.family).toBe("tactical-barbell");
  });

  it("defaults to Operator with a 3-lift cluster and a single 6-week block", () => {
    const inst = setup();
    expect(inst.templateId).toBe("operator");
    expect(inst.blockWeeks).toBe(6);
    expect(inst.blocks).toBe(1);
    expect(inst.cluster.map((c) => c.movement)).toEqual(["squat", "bench", "deadlift"]);
    expect(inst.useTrainingMax).toBe(false);
  });

  it("Operator honours its 3-lift cap even if more lifts are supplied", () => {
    const inst = setup({ cluster: ["squat", "bench", "deadlift", "press"] });
    expect(inst.cluster).toHaveLength(3);
  });

  it("Zulu seeds the default A/B split", () => {
    const inst = setup({ templateId: "zulu" });
    expect(inst.cluster).toEqual([
      { movement: "squat", split: "A" },
      { movement: "press", split: "A" },
      { movement: "bench", split: "B" },
      { movement: "deadlift", split: "B" },
    ]);
  });

  it("the instance round-trips through JSON (the platform persists it)", () => {
    const inst = setup({ templateId: "zulu", blocks: 2 });
    expect(JSON.parse(JSON.stringify(inst))).toEqual(inst);
  });
});

describe("TB engine — timeline", () => {
  it("Operator: 1 block × 6 weeks × 3 sessions = 18 planned sessions", () => {
    const tl = tb.timeline(setup());
    expect(tl).toHaveLength(18);
    expect(tl[0]!.ref).toBe("b0-w1-s1");
    expect(tl[0]!.label).toContain("Operator · Block 1 · Wk 1");
    expect(tl.every((s) => s.kind === "training")).toBe(true);
  });

  it("Zulu: 6 weeks × 4 sessions, tagged by split", () => {
    const tl = tb.timeline(setup({ templateId: "zulu" }));
    expect(tl).toHaveLength(24);
    const wk1 = tl.filter((s) => s.tags?.includes("week:1"));
    expect(wk1.map((s) => s.ref)).toEqual(["b0-w1-p1a", "b0-w1-p1b", "b0-w1-p2a", "b0-w1-p2b"]);
    expect(wk1[0]!.tags).toEqual(expect.arrayContaining(["split:A", "wave:one"]));
    expect(wk1[2]!.tags).toEqual(expect.arrayContaining(["split:A", "wave:two"]));
  });

  it("multiple blocks chain consecutively", () => {
    const tl = tb.timeline(setup({ blocks: 2 }));
    expect(tl).toHaveLength(36);
    expect(tl[18]!.ref).toBe("b1-w1-s1");
  });
});

describe("TB engine — prescribe (% of the shared 1RM)", () => {
  it("Operator week 1 = 3×5 @ 70% across the cluster", () => {
    const inst = setup();
    const p = tb.prescribe(inst, "b0-w1-s1", ctx);
    expect(p.items.map((i) => [i.name, i.weightKg, i.sets, i.repsLabel, i.percentOfTm])).toEqual([
      ["Squat", 140, 3, "5", 0.7],
      ["Bench Press", 70, 3, "5", 0.7],
      ["Deadlift", 175, 3, "5", 0.7],
    ]);
    expect(itemsOfKind(p, "main")).toHaveLength(3);
    expect(totalPrescribedSets(p)).toBe(9);
  });

  it("Operator week 3 intensifies to 3×3 @ 90%", () => {
    const p = tb.prescribe(setup(), "b0-w3-s1", ctx);
    expect(p.items.map((i) => [i.weightKg, i.reps, i.percentOfTm])).toEqual([
      [180, 3, 0.9],
      [90, 3, 0.9],
      [225, 3, 0.9],
    ]);
  });

  it("Operator week 6 peaks at 1–2 reps @ 95%", () => {
    const p = tb.prescribe(setup(), "b0-w6-s1", ctx);
    expect(p.items[0]).toMatchObject({ name: "Squat", weightKg: 190, repsLabel: "1–2", percentOfTm: 0.95 });
  });

  it("Zulu Pass 1 opens at 70% and Pass 2 at 75% for the same week-1 lift", () => {
    const inst = setup({ templateId: "zulu" });
    const pass1 = tb.prescribe(inst, "b0-w1-p1a", ctx); // split A: squat, press
    const pass2 = tb.prescribe(inst, "b0-w1-p2a", ctx);
    expect(pass1.items.map((i) => [i.name, i.weightKg, i.percentOfTm])).toEqual([
      ["Squat", 140, 0.7],
      ["Overhead Press", 70, 0.7],
    ]);
    expect(pass2.items.map((i) => [i.name, i.weightKg, i.percentOfTm])).toEqual([
      ["Squat", 150, 0.75],
      ["Overhead Press", 75, 0.75],
    ]);
  });

  it("a split session only prescribes that split's lifts", () => {
    const inst = setup({ templateId: "zulu" });
    const bDay = tb.prescribe(inst, "b0-w1-p1b", ctx); // split B: bench, deadlift
    expect(bDay.items.map((i) => i.name)).toEqual(["Bench Press", "Deadlift"]);
  });

  it("optionally loads off a derived Training Max instead of the raw 1RM", () => {
    const inst = setup({ useTrainingMax: true, tmPercent: 0.9 });
    // squat TM = round(200×0.9)=180; week1 70% → round(180×0.7)=126→125 @2.5kg
    const p = tb.prescribe(inst, "b0-w1-s1", ctx);
    expect(p.items[0]).toMatchObject({ name: "Squat", weightKg: 125 });
  });

  it("skips a lift with no 1RM (and yields no items when none are known)", () => {
    const inst = setup();
    const partial: PlatformContext = { oneRepMaxes: { squat: 200, bench: 100 }, roundingKg: 2.5 };
    expect(tb.prescribe(inst, "b0-w1-s1", partial).items.map((i) => i.name)).toEqual(["Squat", "Bench Press"]);
    const none: PlatformContext = { oneRepMaxes: {}, roundingKg: 2.5 };
    expect(tb.prescribe(inst, "b0-w1-s1", none).items).toEqual([]);
  });

  it("never marks a working set as AMRAP (TB is strictly submaximal)", () => {
    const p = tb.prescribe(setup(), "b0-w2-s1", ctx);
    expect(p.items.every((i) => !i.isAmrap)).toBe(true);
    expect(p.items.every((i) => /submaximal/.test(i.note ?? ""))).toBe(true);
  });
});

describe("TB engine — onSessionLogged (program-owned recommendations)", () => {
  const log = (ref: string): LoggedSession => ({
    ref,
    performedAt: "2026-06-10",
    sets: [{ movement: "squat", weightKg: 180, reps: 3 }],
  });

  it("mid-block sessions surface no recommendations", () => {
    const { recommendations } = tb.onSessionLogged(setup(), log("b0-w3-s1"), ctx);
    expect(recommendations).toEqual([]);
  });

  it("the final session of a block recommends a 1RM retest", () => {
    const { recommendations, instance } = tb.onSessionLogged(setup(), log("b0-w6-s3"), ctx);
    expect(recommendations.map((r) => r.kind)).toEqual(["tm-test"]);
    // TB never auto-applies anything; strength state is untouched.
    expect(ctx.oneRepMaxes.squat).toBe(200);
    expect(instance.cluster).toHaveLength(3);
  });

  it("a block end with more blocks remaining also recommends the next block", () => {
    const { recommendations } = tb.onSessionLogged(setup({ blocks: 4 }), log("b0-w6-s3"), ctx);
    expect(recommendations.map((r) => r.kind)).toEqual(["tm-test", "next-block"]);
  });

  it("surfaces a CNS deload at the ~24-week boundary", () => {
    const { recommendations } = tb.onSessionLogged(setup({ blocks: 4 }), log("b3-w6-s3"), ctx);
    expect(recommendations.map((r) => r.kind)).toEqual(["tm-test", "deload"]);
  });
});
