/**
 * Pure deload-week builder tests (ADR 0049).
 */
import { describe, it, expect } from "vitest";
import type { Prescription, PrescriptionItem } from "@hta/db";
import {
  buildDeloadPrescription,
  buildDeloadWeek,
  DELOAD_MAIN_RAMP,
} from "../deload-week";

function presc(items: PrescriptionItem[]): Prescription {
  return { items } as Prescription;
}

describe("buildDeloadPrescription", () => {
  it("turns a single %TM main into the 40/50/60 x5 ramp, no AMRAP", () => {
    const out = buildDeloadPrescription(
      presc([
        { movementId: "sq", kind: "main", percentTm: 85, reps: 5, isAmrap: true },
      ]),
    );
    const mains = out.items.filter((i) => i.kind === "main");
    expect(mains.map((m) => m.percentTm)).toEqual([...DELOAD_MAIN_RAMP]);
    expect(mains.every((m) => m.reps === 5)).toBe(true);
    expect(mains.every((m) => m.isAmrap === false)).toBe(true);
    expect(mains.every((m) => m.movementId === "sq")).toBe(true);
  });

  it("collapses multiple working sets of one main into a single deload ramp", () => {
    const out = buildDeloadPrescription(
      presc([
        { movementId: "sq", kind: "main", percentTm: 75, reps: 5 },
        { movementId: "sq", kind: "main", percentTm: 85, reps: 5 },
        { movementId: "sq", kind: "main", percentTm: 95, reps: 3, isAmrap: true },
      ]),
    );
    expect(out.items.filter((i) => i.kind === "main")).toHaveLength(3);
  });

  it("deloads EACH main of a TB-style cluster (two main movements)", () => {
    const out = buildDeloadPrescription(
      presc([
        { movementId: "sq", kind: "main", percentTm: 80, reps: 5 },
        { movementId: "bn", kind: "main", percentTm: 80, reps: 5 },
      ]),
    );
    const byMovement = new Map<string, number>();
    for (const m of out.items.filter((i) => i.kind === "main")) {
      byMovement.set(m.movementId, (byMovement.get(m.movementId) ?? 0) + 1);
    }
    expect(byMovement.get("sq")).toBe(3);
    expect(byMovement.get("bn")).toBe(3);
  });

  it("keeps warm-ups and drops accessories / back-off / tendon / power", () => {
    const out = buildDeloadPrescription(
      presc([
        { movementId: "sq", kind: "warmup", targetWeightKg: 40, reps: 5 },
        { movementId: "sq", kind: "main", percentTm: 85, reps: 5 },
        { movementId: "ac1", kind: "accessory", reps: 12 },
        { movementId: "ac2", kind: "back_off", percentTm: 65, reps: 8 },
        { movementId: "ac3", kind: "tendon", reps: 20 },
        { movementId: "ac4", kind: "power_potentiation", reps: 3 },
      ]),
    );
    expect(out.items.some((i) => i.kind === "warmup")).toBe(true);
    expect(
      out.items.some((i) =>
        ["accessory", "back_off", "tendon", "power_potentiation"].includes(i.kind),
      ),
    ).toBe(false);
  });

  it("keeps easy cardio and converts hard cardio to a short easy Z2", () => {
    const out = buildDeloadPrescription(
      presc([
        { movementId: "z2", kind: "cardio_z2", durationMin: 45 },
        { movementId: "vo2", kind: "cardio_vo2", durationMin: 40, protocolNote: "4x4" },
      ]),
    );
    const cardio = out.items.filter((i) => i.kind.startsWith("cardio"));
    expect(cardio.every((c) => c.kind === "cardio_z2")).toBe(true);
    const converted = cardio.find((c) => c.movementId === "vo2");
    expect(converted?.durationMin).toBeLessThanOrEqual(30);
    expect(converted?.hrCap).toBe("conversational");
    // The already-easy Z2 passes through untouched.
    expect(cardio.find((c) => c.movementId === "z2")?.durationMin).toBe(45);
  });

  it("produces an off-program prescription (no programRef / markers carried)", () => {
    const source = {
      items: [{ movementId: "sq", kind: "main", percentTm: 85, reps: 5 }],
      programRef: { engineId: "wendler-531", ref: "b0-w1-s1" },
      deloadSkipped: true,
    } as unknown as Prescription;
    const out = buildDeloadPrescription(source);
    expect((out as Record<string, unknown>).programRef).toBeUndefined();
    expect((out as Record<string, unknown>).deloadSkipped).toBeUndefined();
  });

  it("carries a bodyweight main (no %TM) through, never AMRAP", () => {
    const out = buildDeloadPrescription(
      presc([{ movementId: "pu", kind: "main", reps: 8, isAmrap: true }]),
    );
    const mains = out.items.filter((i) => i.kind === "main");
    expect(mains).toHaveLength(1);
    expect(mains[0]!.isAmrap).toBe(false);
    expect(mains[0]!.movementId).toBe("pu");
  });
});

describe("buildDeloadWeek", () => {
  it("maps each source session to a deload session, in day order, omitting empties", () => {
    const week = buildDeloadWeek([
      {
        dayIndex: 2,
        slot: "single",
        title: "Squat day",
        sessionModality: null,
        prescription: presc([{ movementId: "sq", kind: "main", percentTm: 85, reps: 5 }]),
      },
      {
        dayIndex: 0,
        slot: "single",
        title: "Bench day",
        sessionModality: null,
        prescription: presc([{ movementId: "bn", kind: "main", percentTm: 85, reps: 5 }]),
      },
      {
        // Accessory-only day → empty after deload → omitted (becomes rest).
        dayIndex: 4,
        slot: "single",
        title: "Pump day",
        sessionModality: null,
        prescription: presc([{ movementId: "ac", kind: "accessory", reps: 15 }]),
      },
    ]);
    expect(week.map((s) => s.dayIndex)).toEqual([0, 2]);
    expect(week[0]!.title).toBe("Deload · Bench day");
  });

  it("skips sessions with a null prescription", () => {
    const week = buildDeloadWeek([
      { dayIndex: 0, slot: "single", title: null, sessionModality: null, prescription: null },
    ]);
    expect(week).toHaveLength(0);
  });
});
