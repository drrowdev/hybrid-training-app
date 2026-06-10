import { describe, it, expect } from "vitest";
import { wendler531Engine } from "@hta/wendler";
import { tacticalBarbellEngine } from "@hta/tacticalbarbell";
import type { PlatformContext } from "@hta/program-core";
import { adaptSessionPrescription, type MovementResolver } from "../adapter";

// A resolver standing in for the user's anchored variants.
const RESOLVED: Record<string, { movementId: string; slug: string; displayName: string }> = {
  squat: { movementId: "m-squat", slug: "back-squat-high-bar", displayName: "Back Squat" },
  bench: { movementId: "m-bench", slug: "bench-press-flat", displayName: "Bench Press" },
  deadlift: { movementId: "m-dead", slug: "conventional-deadlift", displayName: "Deadlift" },
  press: { movementId: "m-press", slug: "ohp-standing", displayName: "Overhead Press" },
};
const resolve: MovementResolver = (k) => RESOLVED[k];

const ctx: PlatformContext = {
  oneRepMaxes: { squat: 165, bench: 118, deadlift: 212, press: 71 },
  roundingKg: 2.5,
};

describe("adaptSessionPrescription — strength", () => {
  it("maps a 5/3/1 session into app PrescriptionItems with percentTm passed through", () => {
    const inst = wendler531Engine.setup(
      { values: { templateId: "5spro-fsl", leaderCycles: 2, anchorCycles: 1, tmPercent: 0.85 } },
      ctx,
    );
    const tl = wendler531Engine.timeline(inst);
    // An Anchor (classic 5/3/1) squat session has warmups + main %TM sets + supplemental.
    const sq = tl.find((s) => s.tags?.includes("lift:squat") && s.tags?.includes("phase:anchor"))!;
    const p = wendler531Engine.prescribe(inst, sq.ref, ctx);
    const { prescription, skipped } = adaptSessionPrescription(p, resolve);

    expect(prescription.items.length).toBeGreaterThan(0);
    expect(skipped).toEqual([]);
    // Every item resolved to the user's squat movement + a valid app kind.
    for (const it of prescription.items) {
      expect(it.movementId).toBe("m-squat");
      expect(it.movementSlug).toBe("back-squat-high-bar");
      expect(["warmup", "main", "back_off"]).toContain(it.kind);
    }
    // percentTm is an integer percent (engine fraction × 100).
    const main = prescription.items.find((i) => i.kind === "main" && i.percentTm)!;
    expect(Number.isInteger(main.percentTm)).toBe(true);
    expect(main.percentTm).toBeGreaterThan(50);
  });

  it("flags the AMRAP top set as isAmrap", () => {
    const inst = wendler531Engine.setup(
      { values: { templateId: "5spro-fsl", leaderCycles: 2, anchorCycles: 1, tmPercent: 0.85 } },
      ctx,
    );
    const tl = wendler531Engine.timeline(inst);
    const sq = tl.find((s) => s.tags?.includes("lift:squat") && s.tags?.includes("phase:anchor"))!;
    const { prescription } = adaptSessionPrescription(wendler531Engine.prescribe(inst, sq.ref, ctx), resolve);
    expect(prescription.items.some((i) => i.isAmrap)).toBe(true);
  });

  it("maps a Tactical Barbell session and carries the submaximal note", () => {
    const inst = tacticalBarbellEngine.setup({ values: { templateId: "operator" } }, ctx);
    const { prescription, skipped } = adaptSessionPrescription(
      tacticalBarbellEngine.prescribe(inst, "b0-w1-s1", ctx),
      resolve,
    );
    expect(skipped).toEqual([]);
    expect(prescription.items.map((i) => i.movementSlug)).toEqual([
      "back-squat-high-bar",
      "bench-press-flat",
      "conventional-deadlift",
    ]);
    expect(prescription.items.every((i) => i.kind === "main")).toBe(true);
    expect(prescription.items[0]!.notes).toMatch(/submaximal/i);
  });

  it("maps supplemental → back_off and assistance → accessory (Zulu/HT shape)", () => {
    // Hand-built program-core prescription covering the non-main strength kinds.
    const { prescription } = adaptSessionPrescription(
      {
        items: [
          { kind: "main", name: "Overhead Press (heavy)", movementId: "press", sets: 4, reps: 5, percentOfTm: 0.75 },
          { kind: "supplemental", name: "Squat (back-off)", movementId: "squat", sets: 4, reps: 10, percentOfTm: 0.65 },
          { kind: "assistance", name: "Pull-Ups", movementId: "pullup", sets: 3, reps: 12 },
        ],
      },
      resolve,
    );
    // pullup has no resolved movement → assistance item is skipped, others map.
    expect(prescription.items.map((i) => i.kind)).toEqual(["main", "back_off"]);
    expect(prescription.items[1]).toMatchObject({ movementId: "m-squat", percentTm: 65, sets: 4, reps: 10 });
  });

  it("reports unresolved movements and unsupported (cardio) kinds in `skipped`", () => {
    const { prescription, skipped } = adaptSessionPrescription(
      {
        items: [
          { kind: "main", name: "Squat", movementId: "squat", sets: 1, reps: 5, percentOfTm: 0.8 },
          { kind: "cardio", name: "Long Run", movementId: "long-run", distanceM: 8000 },
          { kind: "main", name: "Mystery", movementId: "bicep-curl", sets: 1, reps: 5 },
        ],
      },
      resolve,
    );
    expect(prescription.items).toHaveLength(1);
    expect(skipped.map((s) => s.reason)).toEqual([
      "unsupported kind 'cardio'",
      "no anchored movement for key 'bicep-curl'",
    ]);
  });

  it("folds a standalone note into the preceding item", () => {
    const { prescription } = adaptSessionPrescription(
      {
        items: [
          { kind: "main", name: "Squat", movementId: "squat", sets: 1, reps: 5, percentOfTm: 0.8 },
          { kind: "note", name: "Tactical Barbell", note: "Submaximal — never to failure." },
        ],
      },
      resolve,
    );
    expect(prescription.items).toHaveLength(1);
    expect(prescription.items[0]!.notes).toMatch(/never to failure/i);
  });
});
