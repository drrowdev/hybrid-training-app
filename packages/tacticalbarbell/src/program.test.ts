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
  oneRepMaxes: {
    squat: 200,
    bench: 100,
    deadlift: 250,
    press: 100,
    "overhead-press": 100,
    pullup: 50,
    "weighted-pullup": 50,
    "barbell-row": 120,
    "pendlay-row": 100,
    "rack-pull": 250,
    "power-clean": 100,
    "push-press": 100,
  },
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
    expect(inst.cluster.map((c) => c.movement)).toEqual([
      "bench",
      "squat",
      "weighted-pullup",
    ]);
    expect(inst.useTrainingMax).toBe(false);
    expect(inst.useTemplateDefaults).toBe(true);
  });

  it("Operator honours its 3-lift cap even if more lifts are supplied", () => {
    const inst = setup({ cluster: ["squat", "bench", "deadlift", "press"] });
    expect(inst.cluster).toHaveLength(3);
  });

  it("Zulu seeds the default A/B split", () => {
    const inst = setup({ templateId: "zulu" });
    expect(inst.cluster).toEqual([
      { movement: "bench", split: "A" },
      { movement: "squat", split: "A" },
      { movement: "deadlift", split: "B" },
      { movement: "weighted-pullup", kind: "weighted-bw", split: "B" },
    ]);
  });

  it("the instance round-trips through JSON (the platform persists it)", () => {
    const inst = setup({ templateId: "zulu", blocks: 2 });
    expect(JSON.parse(JSON.stringify(inst))).toEqual(inst);
  });
});

describe("TB engine — timeline", () => {
  it("Operator TB3: five work weeks plus three week-6 peak sessions = 18 planned sessions", () => {
    const tl = tb.timeline(setup());
    expect(tl).toHaveLength(18);
    expect(tl[0]!.ref).toBe("b0-w1-s1");
    expect(tl[0]!.label).toContain("Operator · Block 1 · Wk 1");
    expect(tl.filter((s) => s.kind === "test").map((s) => s.ref)).toEqual([
      "b0-w6-peak-squat",
      "b0-w6-peak-bench",
      "b0-w6-peak-deadlift",
    ]);
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

  it("Activation materialises 69 sessions with explicit test and deload roles", () => {
    const tl = tb.timeline(setup({ templateId: "activation" }));
    expect(tl).toHaveLength(69);
    expect(tl.filter((session) => session.tags?.includes("week:5"))).toHaveLength(1);
    expect(tl.filter((session) => session.tags?.includes("week:15"))).toHaveLength(3);
    expect(tl.filter((session) => session.tags?.includes("week:15")).every((session) => session.kind === "deload")).toBe(true);
    expect(tl.filter((session) => session.tags?.includes("week:22"))).toHaveLength(2);
    expect(tl.at(-1)?.ref).toBe("b0-w25-operator-test");
  });
});

describe("TB engine — prescribe (% of the shared 1RM)", () => {
  it("Operator week 1 = required 3 of up to 5 × 5 @ 75%", () => {
    const inst = setup();
    const p = tb.prescribe(inst, "b0-w1-s1", ctx);
    const mains = itemsOfKind(p, "main");
    expect(mains.map((i) => [i.name, i.weightKg, i.sets, i.repsLabel, i.percentOfTm])).toEqual([
      ["Bench Press", 75, 3, "5", 0.75],
      ["Squat", 150, 3, "5", 0.75],
      ["Weighted Pull-up", 37.5, 3, "5", 0.75],
    ]);
    expect(mains).toHaveLength(3);
    expect(mains.every((item) => item.setsMax === 5)).toBe(true);
    // Each lift carries a 3-set warm-up ramp ahead of its work sets.
    expect(itemsOfKind(p, "warmup")).toHaveLength(9);
    expect(totalPrescribedSets(p)).toBe(18); // 9 warm-up + 9 required working
  });

  it("Operator week 3 intensifies to 3–5×3 @ 85%", () => {
    const p = tb.prescribe(setup(), "b0-w3-s1", ctx);
    expect(itemsOfKind(p, "main").map((i) => [i.weightKg, i.reps, i.percentOfTm])).toEqual([
      [85, 3, 0.85],
      [170, 3, 0.85],
      [42.5, 3, 0.85],
    ]);
  });

  it("Operator week 6 peaks one named lift at 100% while support lifts stay at 80%", () => {
    const p = tb.prescribe(setup(), "b0-w6-peak-squat", ctx);
    expect(itemsOfKind(p, "main").map((item) => [item.name, item.percentOfTm, item.sets, item.reps])).toEqual([
      ["Squat", 1, 1, 1],
      ["Bench Press", 0.8, 3, 5],
      ["Weighted Pull-up", 0.8, 3, 5],
    ]);
  });

  it("Zulu Pass 1 opens at 70% and Pass 2 at 75%, both for 5–8 reps", () => {
    const inst = setup({ templateId: "zulu" });
    const pass1 = tb.prescribe(inst, "b0-w1-p1a", ctx);
    const pass2 = tb.prescribe(inst, "b0-w1-p2a", ctx);
    expect(itemsOfKind(pass1, "main").map((i) => [i.name, i.weightKg, i.percentOfTm])).toEqual([
      ["Bench Press", 70, 0.7],
      ["Squat", 140, 0.7],
    ]);
    expect(itemsOfKind(pass2, "main").map((i) => [i.name, i.weightKg, i.percentOfTm])).toEqual([
      ["Bench Press", 75, 0.75],
      ["Squat", 150, 0.75],
    ]);
    expect(itemsOfKind(pass1, "main").every((item) => item.repsLabel === "5–8")).toBe(true);
  });

  it("a split session only prescribes that split's lifts", () => {
    const inst = setup({ templateId: "zulu" });
    const bDay = tb.prescribe(inst, "b0-w1-p1b", ctx);
    expect(itemsOfKind(bDay, "main").map((i) => i.name)).toEqual([
      "Deadlift",
      "Weighted Pull-up",
    ]);
    expect(itemsOfKind(bDay, "supplemental").map((i) => i.name)).toEqual([
      "Barbell Row",
      "Back Extension",
    ]);
  });

  it("optionally loads off a derived Training Max instead of the raw 1RM", () => {
    const inst = setup({ useTrainingMax: true, tmPercent: 0.9 });
    // squat TM = round(200×0.9)=180; TB3 week1 75% → 135 kg.
    const p = tb.prescribe(inst, "b0-w1-s1", ctx);
    expect(itemsOfKind(p, "main").find((item) => item.name === "Squat")).toMatchObject({
      name: "Squat",
      weightKg: 135,
    });
  });

  it("preserves fixed TB3 work when a 1RM is still missing", () => {
    const inst = setup();
    const partial: PlatformContext = { oneRepMaxes: { squat: 200, bench: 100 }, roundingKg: 2.5 };
    const partialMains = itemsOfKind(tb.prescribe(inst, "b0-w1-s1", partial), "main");
    expect(partialMains.map((i) => i.name)).toEqual([
      "Bench Press",
      "Squat",
      "Weighted Pull-up",
    ]);
    expect(partialMains.find((item) => item.name === "Weighted Pull-up")?.weightKg).toBeUndefined();
    const none: PlatformContext = { oneRepMaxes: {}, roundingKg: 2.5 };
    expect(itemsOfKind(tb.prescribe(inst, "b0-w1-s1", none), "main")).toHaveLength(3);
  });

  it("never marks a working set as AMRAP (TB is strictly submaximal)", () => {
    const p = tb.prescribe(setup(), "b0-w2-s1", ctx);
    expect(p.items.every((i) => !i.isAmrap)).toBe(true);
    expect(itemsOfKind(p, "main").every((i) => /submaximal/.test(i.note ?? ""))).toBe(true);
  });

  it("Zulu I/A prescribes a 3–5 set range and a heavier week-4 than Standard", () => {
    const ia = setup({ templateId: "zulu-ia" });
    const std = setup({ templateId: "zulu" });
    // Week 4 split A (squat/press): I/A = 75%, Standard Pass-1 = 70%.
    const iaW4 = tb.prescribe(ia, "b0-w4-p1a", ctx);
    const stdW4 = tb.prescribe(std, "b0-w4-p1a", ctx);
    expect(itemsOfKind(iaW4, "main").map((i) => i.percentOfTm)).toEqual([0.75, 0.75]);
    expect(itemsOfKind(stdW4, "main").map((i) => i.percentOfTm)).toEqual([0.7, 0.7]);
    // Squat week 4: I/A round(200×0.75)=150 vs Standard 140.
    expect(itemsOfKind(iaW4, "main")[0]).toMatchObject({ name: "Squat", weightKg: 150 });
    expect(itemsOfKind(stdW4, "main").find((item) => item.name === "Squat")).toMatchObject({
      name: "Squat",
      weightKg: 140,
    });
    // The prescribed floor is 3 sets, surfaced as an autoregulated 3–5 range.
    expect(itemsOfKind(iaW4, "main").every((i) => i.sets === 3)).toBe(true);
    expect(itemsOfKind(iaW4, "main").every((i) => /3–5 sets/.test(i.note ?? ""))).toBe(true);
  });

  it("Zulu I/A peaks at 1–2 reps @ 95% in week 6", () => {
    const p = tb.prescribe(setup({ templateId: "zulu-ia" }), "b0-w6-p1a", ctx);
    expect(itemsOfKind(p, "main")[0]).toMatchObject({ name: "Squat", repsLabel: "1–2", percentOfTm: 0.95, weightKg: 190 });
  });

  it("Activation Base is an unanchored circuit with a separate ab finisher", () => {
    const p = tb.prescribe(setup({ templateId: "activation" }), "b0-w1-base-1", ctx);
    expect(p.items.map((item) => [item.name, item.sets, item.reps, item.weightKg])).toEqual([
      ["Push-up", 3, 10, undefined],
      ["Goblet Squat", 3, 10, undefined],
      ["Inverted Row", 3, 10, undefined],
      ["Ab Triad", 3, 5, undefined],
    ]);
  });

  it("Activation preserves future percentage work before its test-week maxes exist", () => {
    const empty: PlatformContext = { oneRepMaxes: {}, roundingKg: 2.5 };
    const p = tb.prescribe(setup({ templateId: "activation" }), "b0-w6-armor-a1", empty);
    expect(itemsOfKind(p, "main").map((item) => [item.name, item.percentOfTm, item.weightKg])).toEqual([
      ["Squat", 0.7, undefined],
      ["Rack Pull", 0.7, undefined],
    ]);
    expect(p.items.find((item) => item.name === "Back Extension")).toBeDefined();
    expect(p.items.find((item) => item.name === "Ab Triad")).toBeDefined();
  });

  it("Activation Armor applies second-pass, pull taper and supplemental prescriptions", () => {
    const inst = setup({ templateId: "activation" });
    const a2 = itemsOfKind(tb.prescribe(inst, "b0-w6-armor-a2", ctx), "main");
    expect(a2.find((item) => item.name === "Squat")).toMatchObject({
      percentOfTm: 0.75,
      sets: 3,
      reps: 8,
    });
    expect(a2.find((item) => item.name === "Deadlift")).toMatchObject({
      percentOfTm: 0.75,
      sets: 3,
    });
    const b1 = tb.prescribe(inst, "b0-w7-armor-b1", ctx);
    expect(itemsOfKind(b1, "supplemental").map((item) => [item.name, item.sets, item.setsMax, item.repsLabel, item.percentOfTm])).toEqual([
      ["Weighted Pull-up", 3, 5, "8–10", 0.7],
      ["Overhead Press", 3, 5, "8–10", 0.7],
    ]);
    expect(itemsOfKind(tb.prescribe(inst, "b0-w8-armor-a2", ctx), "main")
      .find((item) => item.name === "Deadlift")?.sets).toBe(1);
  });

  it("Activation Operator Black uses optional sets and preserves the deadlift 1–3 range", () => {
    const inst = setup({ templateId: "activation" });
    const d1 = itemsOfKind(tb.prescribe(inst, "b0-w16-operator-d1", ctx), "main");
    expect(d1.find((item) => item.name === "Squat")).toMatchObject({
      percentOfTm: 0.8,
      sets: 3,
      setsMax: 5,
      reps: 5,
    });
    const d3 = itemsOfKind(tb.prescribe(inst, "b0-w16-operator-d3", ctx), "main");
    expect(d3.find((item) => item.name === "Deadlift")).toMatchObject({
      sets: 1,
      setsMax: 3,
    });
  });

  it("Activation peaks and Vertex apply movement-specific work", () => {
    const inst = setup({ templateId: "activation" });
    const peak = tb.prescribe(inst, "b0-w14-peak-squat", ctx);
    expect(itemsOfKind(peak, "main").map((item) => [item.name, item.percentOfTm, item.sets, item.reps])).toEqual([
      ["Squat", 1, 1, 1],
      ["Barbell Row", 0.75, 3, 5],
    ]);
    const vertex = tb.prescribe(inst, "b0-w22-breacher-d1", ctx);
    expect(itemsOfKind(vertex, "main").map((item) => [item.name, item.percentOfTm, item.sets, item.reps])).toEqual([
      ["Power Clean", 0.65, 3, 3],
      ["Squat", 0.85, 3, 1],
      ["Bench Press", 0.85, 3, 1],
    ]);
    expect(vertex.items.filter((item) => item.name === "Jump Squat" || item.name === "Plyometric Push-up")
      .map((item) => [item.name, item.sets, item.reps, item.weightKg])).toEqual([
      ["Jump Squat", 3, 5, undefined],
      ["Plyometric Push-up", 3, 5, undefined],
    ]);
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
    const { recommendations, instance } = tb.onSessionLogged(
      setup(),
      log("b0-w6-peak-deadlift"),
      ctx,
    );
    expect(recommendations.map((r) => r.kind)).toEqual(["tm-test"]);
    // TB never auto-applies anything; strength state is untouched.
    expect(ctx.oneRepMaxes.squat).toBe(200);
    expect(instance.cluster).toHaveLength(3);
  });

  it("a block end with more blocks remaining also recommends the next block", () => {
    const { recommendations } = tb.onSessionLogged(
      setup({ blocks: 4 }),
      log("b0-w6-peak-deadlift"),
      ctx,
    );
    expect(recommendations.map((r) => r.kind)).toEqual(["tm-test", "next-block"]);
  });

  it("surfaces a CNS deload at the ~24-week boundary", () => {
    const { recommendations } = tb.onSessionLogged(
      setup({ blocks: 4 }),
      log("b3-w6-peak-deadlift"),
      ctx,
    );
    expect(recommendations.map((r) => r.kind)).toEqual(["tm-test", "deload"]);
  });

  it("recognises Activation's week-25 retest as its block end", () => {
    const { recommendations } = tb.onSessionLogged(
      setup({ templateId: "activation" }),
      log("b0-w25-operator-test"),
      ctx,
    );
    expect(recommendations.map((recommendation) => recommendation.kind)).toEqual(["tm-test"]);
  });
});

describe("TB engine — segments (start points)", () => {
  it("emits one block boundary per scheduled block at block-week multiples", () => {
    const segs = tb.segments!(setup({ blocks: 3 }));
    expect(segs).toEqual([
      { startWeekIndex: 0, label: "Block 1", kind: "block" },
      { startWeekIndex: 6, label: "Block 2", kind: "block" },
      { startWeekIndex: 12, label: "Block 3", kind: "block" },
    ]);
  });

  it("a 12-week Grey Man block spaces boundaries by its longer wave", () => {
    const segs = tb.segments!(setup({ templateId: "grey-man", blocks: 2 }));
    expect(segs.map((s) => s.startWeekIndex)).toEqual([0, 12]);
  });

  it("Activation exposes each phase and test boundary", () => {
    const segs = tb.segments!(setup({ templateId: "activation" }));
    expect(segs).toHaveLength(10);
    expect(segs[0]).toEqual({ startWeekIndex: 0, label: "Base", kind: "phase" });
    expect(segs.at(-1)).toEqual({ startWeekIndex: 24, label: "Final retest", kind: "test" });
  });
});
