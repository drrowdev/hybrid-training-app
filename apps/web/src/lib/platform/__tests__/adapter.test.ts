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
    // ADR 0047 PR A: assistance INTENT items carry no movementId, so the adapter
    // skips them gracefully (the platform resolver lands in a later PR). The only
    // skipped items are the three assistance category slots.
    expect(skipped).toHaveLength(3);
    expect(skipped.every((s) => s.kind === "assistance" && s.reason === "item has no movement key")).toBe(true);
    // Every emitted item resolved to the user's squat movement + a valid app kind.
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

  it("resolves 5/3/1 assistance INTENT to accessory items when a resolver is supplied (ADR 0047)", () => {
    const inst = wendler531Engine.setup(
      { values: { templateId: "5spro-fsl", leaderCycles: 2, anchorCycles: 1, tmPercent: 0.85 } },
      ctx,
    );
    const tl = wendler531Engine.timeline(inst);
    const sq = tl.find((s) => s.tags?.includes("lift:squat") && s.tags?.includes("phase:anchor"))!;
    const p = wendler531Engine.prescribe(inst, sq.ref, ctx);

    // Stub resolver: echo the category back as a concrete movement.
    const resolveAssist = (category: string, slotIndex: number) => ({
      movementId: `m-${category}-${slotIndex}`,
      slug: `${category}-${slotIndex}`,
      displayName: `${category} #${slotIndex}`,
    });
    const { prescription, skipped } = adaptSessionPrescription(p, resolve, resolveAssist);

    // No assistance is skipped now; three accessory items were produced.
    expect(skipped).toEqual([]);
    const accessories = prescription.items.filter((i) => i.kind === "accessory");
    expect(accessories).toHaveLength(3);
    expect(accessories.map((a) => a.movementId)).toEqual([
      "m-push-0",
      "m-pull-1",
      "m-single_leg_or_core-2",
    ]);
    // Standard volume → 3 sets, 10 reps, "10–15" range carried in notes.
    expect(accessories.every((a) => a.sets === 3 && a.reps === 10)).toBe(true);
    expect(accessories.every((a) => a.notes === "10\u201315")).toBe(true);
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
    // Operator wk1 prescribes 3 sets/lift plus a warm-up ramp; each working set
    // is its own loggable item, so the three cluster lifts each expand to a
    // warm-up ramp + 3 work-set items.
    const slugs = prescription.items.map((i) => i.movementSlug);
    expect(new Set(slugs)).toEqual(
      new Set(["back-squat-high-bar", "bench-press-flat", "conventional-deadlift"]),
    );
    const mains = prescription.items.filter((i) => i.kind === "main");
    expect(mains).toHaveLength(9); // 3 lifts × 3 work sets
    expect(mains.every((i) => i.sets === 1)).toBe(true);
    expect(mains[0]!.notes).toMatch(/submaximal/i);
    // Each lift carries a warm-up ramp ahead of its work sets.
    expect(prescription.items.some((i) => i.kind === "warmup")).toBe(true);
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
    // pullup has no resolved movement → assistance item is skipped. The main
    // (4×5) and supplemental→back_off (4×10) each expand to one item per set.
    expect(prescription.items.map((i) => i.kind)).toEqual([
      "main",
      "main",
      "main",
      "main",
      "back_off",
      "back_off",
      "back_off",
      "back_off",
    ]);
    expect(prescription.items[4]).toMatchObject({ movementId: "m-squat", percentTm: 65, sets: 1, reps: 10 });
  });

  it("maps conditioning/cardio → a display-only cardio_external item; still reports unresolved strength", () => {
    const { prescription, skipped } = adaptSessionPrescription(
      {
        items: [
          { kind: "main", name: "Squat", movementId: "squat", sets: 1, reps: 5, percentOfTm: 0.8 },
          { kind: "cardio", name: "Long Run", movementId: "long-run", durationSec: 2700, note: "Z2 — conversational." },
          { kind: "main", name: "Mystery", movementId: "bicep-curl", sets: 1, reps: 5 },
        ],
      },
      resolve,
    );
    // squat resolves; cardio becomes a cardio_external display item; the
    // unresolved strength main is the only skip.
    expect(prescription.items.map((i) => i.kind)).toEqual(["main", "cardio_external"]);
    const cardio = prescription.items[1]!;
    expect(cardio.movementId).toBe("");
    expect(cardio.movementName).toBe("Long Run");
    expect(cardio.durationMin).toBe(45);
    expect(cardio.notes).toMatch(/conversational/i);
    expect(cardio.protocolNote).toMatch(/Strava|external/i);
    expect(skipped.map((s) => s.reason)).toEqual(["no anchored movement for key 'bicep-curl'"]);
  });

  it("maps a Green Protocol conditioning day to cardio_external items", () => {
    const { prescription, skipped } = adaptSessionPrescription(
      {
        items: [
          { kind: "conditioning", name: "Long Slow Distance", movementId: "lss", durationSec: 3000, note: "Aerobic base — 50 min easy." },
        ],
      },
      resolve,
    );
    expect(skipped).toEqual([]);
    expect(prescription.items).toHaveLength(1);
    expect(prescription.items[0]).toMatchObject({
      kind: "cardio_external",
      movementId: "",
      movementName: "Long Slow Distance",
      durationMin: 50,
    });
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
