/**
 * 5/3/1 ProgramEngine — end-to-end through the @hta/program-core contract.
 *
 * Proves a complete program: setup → timeline → prescribe (warm-up + main +
 * supplemental, classic vs 5's PRO vs 7th-week) → onSessionLogged (TM-test
 * verdict + AMRAP-driven TM bump). The whole 5/3/1 program is verified here
 * with NO DB and NO UI — exactly the "build + validate programs first" goal.
 */
import { describe, it, expect } from "vitest";
import type { PlatformContext, LoggedSession } from "@hta/program-core";
import { totalPrescribedSets, itemsOfKind } from "@hta/program-core";
import { wendler531Engine, type WendlerInstance } from "./program";

const ctx: PlatformContext = {
  oneRepMaxes: { squat: 165, bench: 118, deadlift: 212, press: 71 },
  roundingKg: 2.5,
};

function setup(values: Record<string, unknown> = {}): WendlerInstance {
  return wendler531Engine.setup(
    { values: { templateId: "5spro-fsl", leaderCycles: 2, anchorCycles: 1, tmPercent: 0.85, ...values } },
    ctx,
  );
}

describe("5/3/1 engine — meta + setup", () => {
  it("identifies as the 5/3/1 family", () => {
    expect(wendler531Engine.meta.id).toBe("wendler-531");
    expect(wendler531Engine.meta.family).toBe("531");
  });

  it("describeSetup asks for the template + cycle structure (not raw TMs — TMs derive from shared 1RMs)", () => {
    const keys = wendler531Engine.describeSetup().fields.map((f) => f.key);
    expect(keys).toEqual(expect.arrayContaining(["templateId", "leaderCycles", "anchorCycles", "tmPercent"]));
    expect(keys).not.toContain("squat");
  });

  it("setup derives each lift's Training Max from the shared 1RMs (TM = round(1RM × tmPercent))", () => {
    const inst = setup();
    // 165×0.85=140.25→140, 118×0.85=100.3→100, 212×0.85=180.2→180, 71×0.85=60.35→60
    expect(inst.trainingMaxes).toEqual({ squat: 140, bench: 100, deadlift: 180, press: 60 });
  });

  it("setup builds the default Leader(5s-pro)+deload+Anchor(classic)+TM-test sequence", () => {
    const inst = setup();
    expect(inst.segments.map((s) => (s.type === "phase" ? `${s.kind}:${s.mainScheme}:${s.supplemental}` : `7w:${s.mode}`))).toEqual([
      "leader:5s-pro:fsl",
      "7w:deload",
      "anchor:classic-531:fsl",
      "7w:tm-test",
    ]);
  });

  it("a BBB template seeds the leader supplemental", () => {
    const inst = setup({ templateId: "bbb-leader" });
    const leader = inst.segments[0];
    expect(leader.type === "phase" && leader.supplemental).toBe("bbb");
    expect(leader.type === "phase" && leader.mainScheme).toBe("5s-pro");
  });

  it("instance round-trips through JSON", () => {
    const inst = setup();
    expect(JSON.parse(JSON.stringify(inst))).toEqual(inst);
  });
});

describe("5/3/1 engine — timeline", () => {
  it("expands to 2 leader cycles + deload + 1 anchor cycle + TM-test, 4 lifts each", () => {
    const tl = wendler531Engine.timeline(setup());
    // leader: 2 cycles × 3 weeks × 4 lifts = 24; deload: 4; anchor: 1×3×4 = 12; tm-test: 4 → 44
    expect(tl).toHaveLength(24 + 4 + 12 + 4);
    expect(tl.filter((s) => s.kind === "deload")).toHaveLength(4);
    expect(tl.filter((s) => s.kind === "test")).toHaveLength(4);
    // indices are contiguous
    expect(tl.map((s) => s.index)).toEqual(tl.map((_, i) => i));
  });

  it("labels and tags carry the phase/week/lift", () => {
    const tl = wendler531Engine.timeline(setup());
    const first = tl[0]!;
    expect(first.label).toContain("Leader 1");
    expect(first.tags).toContain("week:1");
  });
});

describe("5/3/1 engine — prescribe", () => {
  it("a Leader week-1 squat day is 5's PRO main (no AMRAP) + FSL supplemental + warm-ups", () => {
    const inst = setup();
    const tl = wendler531Engine.timeline(inst);
    const squatW1 = tl.find((s) => s.tags?.includes("lift:squat") && s.tags?.includes("week:1") && s.tags?.includes("phase:leader"))!;
    const p = wendler531Engine.prescribe(inst, squatW1.ref, ctx);
    // warm-ups present
    expect(itemsOfKind(p, "warmup").length).toBeGreaterThan(0);
    // 5's PRO → main sets, all reps 5, NONE amrap
    const main = itemsOfKind(p, "main");
    expect(main.length).toBeGreaterThan(0);
    expect(main.every((m) => m.reps === 5)).toBe(true);
    expect(itemsOfKind(p, "amrap")).toHaveLength(0);
    // top main set = round(0.85 × 140) at 2.5 kg
    expect(main.some((m) => m.weightKg === roundTo(140 * 0.85))).toBe(true);
    // FSL supplemental @ 65% (week 1), collapsed to one item with 5 sets
    const supp = itemsOfKind(p, "supplemental");
    expect(supp).toHaveLength(1);
    expect(supp[0]).toMatchObject({ sets: 5, reps: 5, weightKg: roundTo(140 * 0.65) });
  });

  it("an Anchor week-3 squat day is classic 5/3/1 with a 1+ AMRAP top set", () => {
    const inst = setup();
    const tl = wendler531Engine.timeline(inst);
    const squatW3 = tl.find((s) => s.tags?.includes("lift:squat") && s.tags?.includes("week:3") && s.tags?.includes("phase:anchor"))!;
    const p = wendler531Engine.prescribe(inst, squatW3.ref, ctx);
    const amrap = itemsOfKind(p, "amrap");
    expect(amrap).toHaveLength(1);
    expect(amrap[0]).toMatchObject({ reps: 1, isAmrap: true, weightKg: roundTo(140 * 0.95) });
  });

  it("a 7th-week TM-test squat day works up to the TM with no supplemental", () => {
    const inst = setup();
    const tl = wendler531Engine.timeline(inst);
    const test = tl.find((s) => s.kind === "test" && s.tags?.includes("lift:squat"))!;
    const p = wendler531Engine.prescribe(inst, test.ref, ctx);
    expect(itemsOfKind(p, "supplemental")).toHaveLength(0);
    // last main set is the TM (100% × 140 = 140) with a 3–5 label
    const main = itemsOfKind(p, "main");
    const tmSet = main[main.length - 1]!;
    expect(tmSet.weightKg).toBe(140);
    expect(tmSet.repsLabel).toBe("3–5");
  });

  it("prescribe is empty when the instance has no TM for that lift (1RM was missing at setup)", () => {
    const noPressCtx: PlatformContext = {
      oneRepMaxes: { squat: 165, bench: 118, deadlift: 212 },
      roundingKg: 2.5,
    };
    const inst = wendler531Engine.setup(
      { values: { templateId: "5spro-fsl", leaderCycles: 2, anchorCycles: 1, tmPercent: 0.85 } },
      noPressCtx,
    );
    expect(inst.trainingMaxes.press).toBeUndefined();
    const tl = wendler531Engine.timeline(inst);
    const ref = tl.find((s) => s.tags?.includes("lift:press"))!.ref;
    expect(wendler531Engine.prescribe(inst, ref, noPressCtx).items).toEqual([]);
  });
});

describe("5/3/1 engine — onSessionLogged (program-owned recommendations)", () => {
  const inst = setup();
  const tl = wendler531Engine.timeline(inst);

  it("a strong Anchor AMRAP surfaces a TM-bump (never auto-applies)", () => {
    const squatW3 = tl.find((s) => s.tags?.includes("lift:squat") && s.tags?.includes("week:3") && s.tags?.includes("phase:anchor"))!;
    const log: LoggedSession = {
      ref: squatW3.ref,
      performedAt: "2026-02-01",
      sets: [{ movement: "squat", weightKg: 133, reps: 9, isAmrap: true }],
    };
    const { recommendations } = wendler531Engine.onSessionLogged(inst, log, ctx);
    expect(recommendations[0]?.kind).toBe("tm-bump");
    expect(inst.trainingMaxes.squat).toBe(140); // instance TM unchanged — surfaced, not applied
    expect(ctx.oneRepMaxes.squat).toBe(165); // shared 1RM untouched
  });

  it("a 7th-week TM test below 3 reps recommends lowering the TM", () => {
    const test = tl.find((s) => s.kind === "test" && s.tags?.includes("lift:squat"))!;
    const log: LoggedSession = {
      ref: test.ref,
      performedAt: "2026-03-01",
      sets: [{ movement: "squat", weightKg: 140, reps: 2 }],
    };
    const { recommendations } = wendler531Engine.onSessionLogged(inst, log, ctx);
    expect(recommendations[0]?.kind).toBe("tm-reset");
  });

  it("a 7th-week TM test at 5+ reps validates + allows a bump", () => {
    const test = tl.find((s) => s.kind === "test" && s.tags?.includes("lift:bench"))!;
    const log: LoggedSession = {
      ref: test.ref,
      performedAt: "2026-03-01",
      sets: [{ movement: "bench", weightKg: 100, reps: 5 }],
    };
    const { recommendations } = wendler531Engine.onSessionLogged(inst, log, ctx);
    expect(recommendations[0]?.kind).toBe("tm-bump");
  });

  it("a modest top set produces no recommendation", () => {
    const squatW1 = tl.find((s) => s.tags?.includes("lift:squat") && s.tags?.includes("week:1") && s.tags?.includes("phase:leader"))!;
    const log: LoggedSession = {
      ref: squatW1.ref,
      performedAt: "2026-02-01",
      sets: [{ movement: "squat", weightKg: 119, reps: 5 }],
    };
    expect(wendler531Engine.onSessionLogged(inst, log, ctx).recommendations).toEqual([]);
  });
});

function roundTo(kg: number, inc = 2.5): number {
  return Math.round(kg / inc) * inc;
}

// sanity: a prescription always has a positive set count
describe("prescription is well-formed", () => {
  it("totalPrescribedSets > 0 for a normal training day", () => {
    const inst = setup();
    const ref = wendler531Engine.timeline(inst)[0]!.ref;
    expect(totalPrescribedSets(wendler531Engine.prescribe(inst, ref, ctx))).toBeGreaterThan(0);
  });
});
