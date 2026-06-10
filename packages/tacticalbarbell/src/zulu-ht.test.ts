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
  it("week 1, session 1 = heavy Press 4×5 @75% + back-off Squat 4×10 @65% + pull-ups 3×12 @60%", () => {
    const p = z.prescribe(setup(), "b0-w1-s1", ctx);
    expect(p.items).toHaveLength(3);
    expect(itemsOfKind(p, "main")[0]).toMatchObject({ name: "Overhead Press (heavy)", sets: 4, reps: 5, weightKg: 75, percentOfTm: 0.75 });
    expect(itemsOfKind(p, "supplemental")[0]).toMatchObject({ name: "Squat (back-off)", sets: 4, reps: 10, weightKg: 130, percentOfTm: 0.65 });
    expect(itemsOfKind(p, "assistance")[0]).toMatchObject({ name: "Pull-Ups (Assistance A)", sets: 3, reps: 12, percentOfTm: 0.6 });
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
