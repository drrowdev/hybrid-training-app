/**
 * Green Protocol ProgramEngine — end-to-end through @hta/program-core, proving
 * the concurrent program (strength delegated to Tactical Barbell + a conditioning
 * layer) with NO DB and NO UI.
 *
 * 1RMs chosen to round cleanly at 2.5 kg across the TB wave.
 */
import { describe, it, expect } from "vitest";
import type { PlatformContext, LoggedSession } from "@hta/program-core";
import { itemsOfKind } from "@hta/program-core";
import { greenProtocolEngine as gp, type GreenInstance } from "./program";

const ctx: PlatformContext = {
  oneRepMaxes: { squat: 200, bench: 100, deadlift: 250, press: 100 },
  roundingKg: 2.5,
};

function setup(values: Record<string, unknown> = {}): GreenInstance {
  return gp.setup({ values }, ctx);
}

const log = (ref: string): LoggedSession => ({ ref, performedAt: "2026-06-10", sets: [] });

describe("Green engine — meta + setup", () => {
  it("identifies as the Green Protocol family", () => {
    expect(gp.meta.id).toBe("green-protocol");
    expect(gp.meta.family).toBe("tactical-barbell-green");
  });

  it("defaults to Hybrid and seeds embedded TB instances for Operator + Fighter", () => {
    const inst = setup();
    expect(inst.phaseId).toBe("hybrid");
    expect(Object.keys(inst.strength).sort()).toEqual(["fighter", "operator"]);
    expect(inst.strength.operator!.cluster.map((c) => c.movement)).toEqual(["squat", "bench", "deadlift"]);
  });

  it("Hybrid/Op only seeds an Operator instance (no Fighter half)", () => {
    const inst = setup({ phaseId: "hybrid-op" });
    expect(Object.keys(inst.strength)).toEqual(["operator"]);
  });

  it("the instance round-trips through JSON (embedded TB instances included)", () => {
    const inst = setup({ phaseId: "hybrid-op", blocks: 2 });
    expect(JSON.parse(JSON.stringify(inst))).toEqual(inst);
  });
});

describe("Green engine — timeline", () => {
  it("Hybrid: 6 OP weeks (6 sessions) + deload + 6 FT weeks (6 sessions) + deload = 74 entries", () => {
    const tl = gp.timeline(setup());
    expect(tl).toHaveLength(74);
    expect(tl[0]!.ref).toBe("gp-b0-w1-d0");
    // strength + conditioning days are tagged by modality
    expect(tl[0]!.tags).toEqual(expect.arrayContaining(["modality:strength", "session:OP"]));
  });

  it("deload weeks contribute a single deload entry", () => {
    const tl = gp.timeline(setup());
    const deloads = tl.filter((s) => s.kind === "deload");
    expect(deloads).toHaveLength(2);
    expect(deloads[0]!.ref).toBe("gp-b0-w7-d0");
  });

  it("Hybrid/Op is 6 training weeks + a deload", () => {
    const tl = gp.timeline(setup({ phaseId: "hybrid-op" }));
    expect(tl).toHaveLength(6 * 6 + 1);
  });
});

describe("Green engine — prescribe delegates strength to Tactical Barbell", () => {
  it("Hybrid wk1 Operator day = TB Operator wk1 (3×5 @70%)", () => {
    const p = gp.prescribe(setup(), "gp-b0-w1-d0", ctx);
    expect(p.items.map((i) => [i.name, i.weightKg, i.percentOfTm])).toEqual([
      ["Squat", 140, 0.7],
      ["Bench Press", 70, 0.7],
      ["Deadlift", 175, 0.7],
    ]);
  });

  it("Hybrid wk2 Operator day advances the TB wave to 80%", () => {
    const p = gp.prescribe(setup(), "gp-b0-w2-d0", ctx);
    expect(p.items.map((i) => i.weightKg)).toEqual([160, 80, 200]);
  });

  it("the Fighter half maps to TB Fighter week 1 (75%) even though it starts at GP week 8", () => {
    const p = gp.prescribe(setup(), "gp-b0-w8-d0", ctx);
    expect(p.items.map((i) => [i.name, i.weightKg, i.percentOfTm])).toEqual([
      ["Squat", 150, 0.75],
      ["Bench Press", 75, 0.75],
      ["Deadlift", 187.5, 0.75],
    ]);
  });

  it("three Operator days in a week map to TB sessions s1/s2/s3 (same % in Operator)", () => {
    const inst = setup();
    const d0 = gp.prescribe(inst, "gp-b0-w1-d0", ctx).items[0];
    const d4 = gp.prescribe(inst, "gp-b0-w1-d4", ctx).items[0];
    expect(d0).toMatchObject({ name: "Squat", weightKg: 140 });
    expect(d4).toMatchObject({ name: "Squat", weightKg: 140 });
  });
});

describe("Green engine — prescribe conditioning", () => {
  it("an LSS day yields a cardio item with a duration target", () => {
    const p = gp.prescribe(setup(), "gp-b0-w1-d3", ctx);
    expect(itemsOfKind(p, "cardio")).toHaveLength(1);
    expect(p.items[0]).toMatchObject({ name: "Low Intensity Steady State Run", durationSec: 1800 });
    expect(p.items[0]!.note).toContain("30–60 min");
  });

  it("a Long Run day yields a cardio item (no fixed target → autoregulated)", () => {
    const p = gp.prescribe(setup(), "gp-b0-w1-d5", ctx);
    expect(p.items[0]).toMatchObject({ kind: "cardio", name: "Long Run" });
    expect(p.items[0]!.durationSec).toBeUndefined();
  });

  it("a deload day yields a recovery note", () => {
    const p = gp.prescribe(setup(), "gp-b0-w7-d0", ctx);
    expect(p.items[0]).toMatchObject({ kind: "note", name: "Deload" });
  });
});

describe("Green engine — onSessionLogged (recommendations)", () => {
  it("logging the last training day before a deload surfaces a deload-ahead rec", () => {
    const { recommendations } = gp.onSessionLogged(setup(), log("gp-b0-w6-d5"), ctx);
    expect(recommendations.map((r) => r.kind)).toContain("deload");
  });

  it("a mid-week session surfaces nothing", () => {
    const { recommendations } = gp.onSessionLogged(setup(), log("gp-b0-w2-d0"), ctx);
    expect(recommendations).toEqual([]);
  });

  it("finishing the phase recommends continuing the baseline or taking a detour", () => {
    const { recommendations } = gp.onSessionLogged(setup(), log("gp-b0-w14-d0"), ctx);
    expect(recommendations.map((r) => r.kind)).toEqual(["next-block"]);
    expect(recommendations[0]!.detail).toMatch(/baseline|detour/i);
  });
});
