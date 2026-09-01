/**
 * Zulu/HT engine — end-to-end through the @hta/program-core contract.
 *
 * 1RMs chosen to round cleanly at 2.5 kg across the wave.
 */
import { describe, it, expect } from "vitest";
import type { PlatformContext, LoggedSession } from "@hta/program-core";
import { itemsOfKind } from "@hta/program-core";
import { zuluHtEngine as z, type ZuluHtInstance } from "./zulu-ht";

const ctx: PlatformContext = {
  oneRepMaxes: { press: 100, squat: 200, bench: 100, deadlift: 200 },
  roundingKg: 2.5,
};

function setup(values: Record<string, unknown> = {}): ZuluHtInstance {
  return z.setup({ values }, ctx);
}

const log = (ref: string): LoggedSession => ({ ref, performedAt: "2026-06-10", sets: [] });

describe("Zulu/HT — meta + setup", () => {
  it("identifies as a Tactical Barbell mass template", () => {
    expect(z.meta.id).toBe("tactical-barbell-zulu-ht");
    expect(z.meta.family).toBe("tactical-barbell");
  });

  it("defaults to the standard 4-lift cluster and a single 3-week block", () => {
    const inst = setup();
    expect(inst.cluster).toEqual(["press", "squat", "bench", "deadlift"]);
    expect(inst.blocks).toBe(1);
  });
});

describe("Zulu/HT — timeline", () => {
  it("is 3 weeks × 4 sessions, trained Mon/Tue/Thu/Fri", () => {
    const tl = z.timeline(setup());
    expect(tl).toHaveLength(12);
    expect(tl.slice(0, 4).map((s) => s.weekday)).toEqual([0, 1, 3, 4]);
    expect(tl[0]!.ref).toBe("b0-w1-s1");
    expect(tl[0]!.label).toContain("Overhead Press / Squat");
  });
});

describe("Zulu/HT — prescribe (heavy + back-off + assistance)", () => {
  it("week 1, session 1 = heavy Press 4×5 @75% + back-off Squat 4×10 @65% + pull-ups 3–5×12", () => {
    const p = z.prescribe(setup(), "b0-w1-s1", ctx);
    expect(itemsOfKind(p, "main")[0]).toMatchObject({ name: "Overhead Press (heavy)", sets: 4, reps: 5, weightKg: 75, percentOfTm: 0.75 });
    expect(itemsOfKind(p, "supplemental")[0]).toMatchObject({ name: "Squat (back-off)", sets: 4, reps: 10, weightKg: 130, percentOfTm: 0.65 });
    // DC-K4: the source's 60% is a share of MAX CLEAN REPS, already spent to
    // produce the 12 reps. Carrying it as `percentOfTm` hands the adapter a rep
    // percentage to render as a load percentage.
    const assist = itemsOfKind(p, "assistance")[0]!;
    expect(assist).toMatchObject({ name: "Pull-Ups (Assistance A)", sets: 3, setsMax: 5, reps: 12 });
    expect(assist.percentOfTm).toBeUndefined();
    expect(assist.weightKg).toBeUndefined();
  });

  it("ramps the heavy and back-off barbell lifts with the global warm-up (40/60/80% × 5/5/3), but not bodyweight pull-ups", () => {
    const p = z.prescribe(setup(), "b0-w1-s1", ctx);
    const warmups = itemsOfKind(p, "warmup");
    // 3 ramp steps for the heavy lift + 3 for the back-off lift = 6.
    expect(warmups).toHaveLength(6);
    // Heavy = Press @75 → ramp floored at 2.5kg: 0.4→30, 0.6→45, 0.8→60.
    const pressWarmups = warmups.filter((w) => w.movementId === "press");
    expect(pressWarmups.map((w) => w.weightKg)).toEqual([30, 45, 60]);
    expect(pressWarmups.map((w) => w.reps)).toEqual([5, 5, 3]);
    // No warm-up should target the bodyweight pull-up assistance.
    expect(warmups.some((w) => w.movementId === "pullup")).toBe(false);
  });

  it("rotates lifts so each is heavy once and a back-off once across the week", () => {
    const inst = setup();
    const heavies = ["b0-w1-s1", "b0-w1-s2", "b0-w1-s3", "b0-w1-s4"].map(
      (r) => z.prescribe(inst, r, ctx).items.find((i) => i.kind === "main")!.movementId,
    );
    expect(heavies.sort()).toEqual(["bench", "deadlift", "press", "squat"]);
  });

  it("week 3 intensifies to heavy 4×3 @85% and flags the optional peaking protocol", () => {
    const p = z.prescribe(setup(), "b0-w3-s1", ctx);
    const main = p.items.find((i) => i.kind === "main")!;
    expect(main).toMatchObject({ reps: 3, weightKg: 85, percentOfTm: 0.85 });
    expect(main.note).toMatch(/peaking/i);
  });

  it("optionally loads off a derived Training Max", () => {
    const inst = setup({ useTrainingMax: true, tmPercent: 0.9 });
    // press TM = round(100×0.9)=90; wk1 heavy 75% → round(90×0.75)=67.5
    const p = z.prescribe(inst, "b0-w1-s1", ctx);
    expect(p.items.find((i) => i.kind === "main")!.weightKg).toBe(67.5);
  });
});

describe("Zulu/HT — onSessionLogged", () => {
  it("recommends a retest at the end of a 3-week block", () => {
    const { recommendations } = z.onSessionLogged(setup(), log("b0-w3-s4"), ctx);
    expect(recommendations.map((r) => r.kind)).toEqual(["tm-test"]);
  });

  it("mid-block sessions surface nothing", () => {
    const { recommendations } = z.onSessionLogged(setup(), log("b0-w2-s1"), ctx);
    expect(recommendations).toEqual([]);
  });
});

describe("Zulu/HT — a belt-loaded lift in the cluster", () => {
  // Zulu/HT's cluster is a list of bare movement keys — there is no per-lift
  // kind to carry — so a weighted pull-up substituted into a slot used to ramp
  // on its bodyweight-inclusive max and hand the lifter the whole total.
  const bwCtx: PlatformContext = {
    oneRepMaxes: { press: 100, squat: 200, "weighted-pullup": 118, deadlift: 200 },
    roundingKg: 2.5,
    bodyweightKg: 82,
  };
  const withPullup = () =>
    z.setup({ values: { cluster: ["press", "squat", "weighted-pullup", "deadlift"] } }, bwCtx);

  function pullupItems(ref: string) {
    const p = z.prescribe(withPullup(), ref, bwCtx);
    return {
      warmups: itemsOfKind(p, "warmup").filter((i) => i.movementId === "weighted-pullup"),
      working: [...itemsOfKind(p, "main"), ...itemsOfKind(p, "supplemental")].filter(
        (i) => i.movementId === "weighted-pullup",
      ),
    };
  }

  it("takes bodyweight off the total wherever the lift lands in the week", () => {
    // s4 trains it heavy, s2 as the back-off — both are belt loads, and no
    // prescribed weight may reach the lifter's own bodyweight.
    for (const ref of ["b0-w1-s2", "b0-w1-s4"]) {
      const { warmups, working } = pullupItems(ref);
      expect(working.length).toBeGreaterThan(0);
      expect(working.every((i) => i.systemLoad === true)).toBe(true);
      for (const item of [...warmups, ...working]) {
        expect(item.weightKg!).toBeLessThan(bwCtx.bodyweightKg!);
      }
    }
  });

  it("reps out a set that has nothing left to add", () => {
    // The back-off runs at 65%: 0.65 × 118 = 76.7 kg, under an 82 kg lifter.
    const { working } = pullupItems("b0-w1-s2");
    expect(working[0]?.weightKg).toBe(0);
    expect(working[0]?.isAmrap).toBe(true);
  });

  it("leaves the load unresolved rather than guessing with no bodyweight on file", () => {
    const noBw: PlatformContext = { ...bwCtx };
    delete (noBw as { bodyweightKg?: number }).bodyweightKg;
    const p = z.prescribe(
      z.setup({ values: { cluster: ["press", "squat", "weighted-pullup", "deadlift"] } }, noBw),
      "b0-w1-s4",
      noBw,
    );
    const main = itemsOfKind(p, "main").find((i) => i.movementId === "weighted-pullup");
    expect(main?.weightKg).toBeUndefined();
    expect(main?.percentOfTm).toBe(0.75);
    expect(
      itemsOfKind(p, "warmup").filter((i) => i.movementId === "weighted-pullup"),
    ).toHaveLength(0);
  });

  it("leaves the barbell lifts in the same session untouched", () => {
    // s4 pairs the heavy weighted pull-up with a deadlift back-off.
    const p = z.prescribe(withPullup(), "b0-w1-s4", bwCtx);
    const deadlift = itemsOfKind(p, "supplemental").find((i) => i.movementId === "deadlift");
    expect(deadlift?.weightKg).toBe(130); // 0.65 × 200
    expect(deadlift?.systemLoad).toBeUndefined();
  });
});

describe("Zulu/HT — a belt-loaded lift keeps its required cue", () => {
  const bwCtx: PlatformContext = {
    // Low enough that the week-3 heavy set still lands under bodyweight, so the
    // peaking cue and the bodyweight instruction have to coexist.
    oneRepMaxes: { press: 100, squat: 200, "weighted-pullup": 95, deadlift: 200 },
    roundingKg: 2.5,
    bodyweightKg: 82,
  };
  const inst = () =>
    z.setup({ values: { cluster: ["press", "squat", "weighted-pullup", "deadlift"] } }, bwCtx);

  it("states the bodyweight set alongside the week-3 peaking cue", () => {
    const p = z.prescribe(inst(), "b0-w3-s4", bwCtx);
    const main = itemsOfKind(p, "main").find((i) => i.movementId === "weighted-pullup");
    expect(main?.weightKg).toBe(0);
    expect(main?.isAmrap).toBe(true);
    // Neither instruction may silently replace the other.
    expect(main?.note).toContain("max clean reps");
    expect(main?.note).toContain("Peaking");
  });

  it("states the missing bodyweight alongside the peaking cue", () => {
    const noBw: PlatformContext = { ...bwCtx };
    delete (noBw as { bodyweightKg?: number }).bodyweightKg;
    const p = z.prescribe(
      z.setup({ values: { cluster: ["press", "squat", "weighted-pullup", "deadlift"] } }, noBw),
      "b0-w3-s4",
      noBw,
    );
    const main = itemsOfKind(p, "main").find((i) => i.movementId === "weighted-pullup");
    expect(main?.note).toContain("bodyweight");
    expect(main?.note).toContain("Peaking");
  });
});
