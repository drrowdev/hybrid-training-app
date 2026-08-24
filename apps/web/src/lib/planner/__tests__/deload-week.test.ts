/**
 * Pure recovery-week builder tests (ADR 0049, loading superseded).
 *
 * The recovery week's CONTENT belongs to the program: 5/3/1 cuts the weight and
 * keeps the reps, Tactical Barbell keeps the weight and cuts the reps, Green
 * rests. These pin that each gets its own, and that the mirrored week is
 * genuinely eased rather than copied across.
 */
import { describe, it, expect } from "vitest";
import type { Prescription, PrescriptionItem } from "@hta/db";
import { TB_RECOVERY_WEEK } from "@hta/tacticalbarbell";
import { WENDLER_RECOVERY_WEEK } from "@hta/wendler";
import { GREEN_RECOVERY_WEEK } from "@hta/green";
import { buildDeloadPrescription, buildDeloadWeek } from "../deload-week";
import {
  clampRecoveryPercent,
  isOutsideRecommended,
  recoveryPercentScale,
  recoveryWeekPolicyFor,
  GENERIC_RECOVERY_WEEK,
} from "../recovery-week-policy";

function presc(items: PrescriptionItem[]): Prescription {
  return { items } as Prescription;
}

const mainsOf = (p: Prescription) => p.items.filter((i) => i.kind === "main");

describe("each program brings its own recovery week", () => {
  const source = presc([
    { movementId: "sq", kind: "main", percentTm: 85, reps: 5, isAmrap: true },
  ]);

  it("Tactical Barbell keeps the weight moderate and cuts the reps", () => {
    // TB3: "Approx 3 sets x 3-5 65-70%RM per session."
    const mains = mainsOf(buildDeloadPrescription(source, TB_RECOVERY_WEEK));
    expect(mains).toHaveLength(3);
    expect(mains.map((m) => m.percentTm)).toEqual([65, 65, 65]);
    expect(mains.every((m) => m.reps === 3)).toBe(true);
    expect(mains.every((m) => m.repRange?.max === 5)).toBe(true);
    expect(mains.every((m) => m.isAmrap === false)).toBe(true);
  });

  it("5/3/1 cuts the weight hard and keeps the reps", () => {
    const mains = mainsOf(buildDeloadPrescription(source, WENDLER_RECOVERY_WEEK));
    expect(mains.map((m) => m.percentTm)).toEqual([40, 50, 60]);
    expect(mains.every((m) => m.reps === 5)).toBe(true);
  });

  it("Green Protocol rests, matching its own scheduled deload", () => {
    const out = buildDeloadPrescription(source, GREEN_RECOVERY_WEEK);
    expect(mainsOf(out)).toHaveLength(0);
  });

  it("maps a block to its program, and anything unknown to the generic week", () => {
    expect(recoveryWeekPolicyFor("tactical-barbell")).toBe(TB_RECOVERY_WEEK);
    expect(recoveryWeekPolicyFor("wendler-531")).toBe(WENDLER_RECOVERY_WEEK);
    expect(recoveryWeekPolicyFor("green-protocol")).toBe(GREEN_RECOVERY_WEEK);
    expect(recoveryWeekPolicyFor("hybrid")).toBe(GENERIC_RECOVERY_WEEK);
    expect(recoveryWeekPolicyFor(null)).toBe(GENERIC_RECOVERY_WEEK);
  });
});

describe("the percentage means what the program says it means", () => {
  it("scales a true-max percentage up on a block run off a training max", () => {
    // The logger multiplies 1RM x tm_percent x prescribed %. Unscaled, a "65 %"
    // TB recovery week on a 90 % training max lands at 58 % of the real max.
    const scale = recoveryPercentScale(TB_RECOVERY_WEEK, {
      useTrainingMax: true,
      tmPercent: 0.9,
    });
    const mains = mainsOf(
      buildDeloadPrescription(
        presc([{ movementId: "sq", kind: "main", percentTm: 85, reps: 5 }]),
        TB_RECOVERY_WEEK,
        scale,
      ),
    );
    expect(mains[0]!.percentTm).toBe(72);
    // 1RM x 0.90 x 0.72 ≈ 0.65 of the true max.
    expect(0.9 * (mains[0]!.percentTm! / 100)).toBeCloseTo(0.65, 2);
  });

  it("leaves a training-max percentage alone — 5/3/1 states its own basis", () => {
    expect(
      recoveryPercentScale(WENDLER_RECOVERY_WEEK, {
        useTrainingMax: true,
        tmPercent: 0.85,
      }),
    ).toBe(1);
  });

  it("does not scale a block that already loads off the true max", () => {
    expect(recoveryPercentScale(TB_RECOVERY_WEEK, { useTrainingMax: false })).toBe(1);
    expect(recoveryPercentScale(TB_RECOVERY_WEEK, null)).toBe(1);
  });
});

describe("the lifter can set the percentage", () => {
  it("builds at whatever percentage it is given", () => {
    const mains = mainsOf(
      buildDeloadPrescription(
        presc([{ movementId: "sq", kind: "main", percentTm: 85, reps: 5 }]),
        { ...TB_RECOVERY_WEEK, topPercent: 70 },
      ),
    );
    expect(mains.map((m) => m.percentTm)).toEqual([70, 70, 70]);
  });

  it("keeps a ramp's shape when its top moves", () => {
    const mains = mainsOf(
      buildDeloadPrescription(
        presc([{ movementId: "sq", kind: "main", percentTm: 85, reps: 5 }]),
        { ...WENDLER_RECOVERY_WEEK, topPercent: 50 },
      ),
    );
    expect(mains.map((m) => m.percentTm)).toEqual([30, 40, 50]);
  });

  it("holds the percentage to something loggable", () => {
    expect(clampRecoveryPercent(5)).toBe(30);
    expect(clampRecoveryPercent(200)).toBe(85);
    expect(clampRecoveryPercent(67.4)).toBe(67);
  });

  it("flags a choice outside what the program advises, without refusing it", () => {
    expect(isOutsideRecommended(TB_RECOVERY_WEEK, 65)).toBe(false);
    expect(isOutsideRecommended(TB_RECOVERY_WEEK, 70)).toBe(false);
    expect(isOutsideRecommended(TB_RECOVERY_WEEK, 80)).toBe(true);
    expect(isOutsideRecommended(TB_RECOVERY_WEEK, 40)).toBe(true);
  });
});

describe("the mirrored week is eased, not copied", () => {
  it("warms up to the recovery week's top set, not the week it mirrored", () => {
    // Mirroring a TB peak week, whose own warm-ups run heavier than the whole
    // recovery session.
    const out = buildDeloadPrescription(
      presc([
        { movementId: "sq", kind: "warmup", percentTm: 80, reps: 3 },
        { movementId: "sq", kind: "main", percentTm: 100, reps: 1 },
      ]),
      TB_RECOVERY_WEEK,
    );
    const warmups = out.items.filter((i) => i.kind === "warmup");
    const top = Math.max(...mainsOf(out).map((m) => m.percentTm ?? 0));

    expect(warmups.length).toBeGreaterThan(0);
    expect(warmups.every((w) => (w.percentTm ?? 0) < top)).toBe(true);
  });

  it("shortens a long easy session instead of passing it through", () => {
    const out = buildDeloadPrescription(
      presc([{ movementId: "z2", kind: "cardio_z2", durationMin: 90 }]),
      TB_RECOVERY_WEEK,
    );
    expect(out.items[0]!.durationMin).toBe(30);
  });

  it("leaves an easy session already inside the cap alone", () => {
    const out = buildDeloadPrescription(
      presc([{ movementId: "z2", kind: "cardio_z2", durationMin: 20 }]),
      TB_RECOVERY_WEEK,
    );
    expect(out.items[0]!.durationMin).toBe(20);
  });

  it("turns hard cardio into a short easy session", () => {
    const out = buildDeloadPrescription(
      presc([
        { movementId: "vo2", kind: "cardio_vo2", durationMin: 40, protocolNote: "4x4" },
      ]),
      TB_RECOVERY_WEEK,
    );
    expect(out.items[0]).toMatchObject({
      kind: "cardio_z2",
      hrCap: "conversational",
    });
    expect(out.items[0]!.durationMin).toBeLessThanOrEqual(30);
  });

  it("eases a bodyweight main's volume, since it has no percentage to ease", () => {
    const out = buildDeloadPrescription(
      presc([{ movementId: "pu", kind: "main", sets: 5, reps: 10, isAmrap: true }]),
      TB_RECOVERY_WEEK,
    );
    const mains = mainsOf(out);
    expect(mains).toHaveLength(1);
    expect(mains[0]!.isAmrap).toBe(false);
    expect(mains[0]!.sets).toBe(1);
    expect(mains[0]!.reps).toBeLessThan(10);
  });

  it("drops accessories, back-off, tendon and power work", () => {
    const out = buildDeloadPrescription(
      presc([
        { movementId: "sq", kind: "main", percentTm: 85, reps: 5 },
        { movementId: "ac1", kind: "accessory", reps: 12 },
        { movementId: "ac2", kind: "back_off", percentTm: 65, reps: 8 },
        { movementId: "ac3", kind: "tendon", reps: 20 },
        { movementId: "ac4", kind: "power_potentiation", reps: 3 },
      ]),
      TB_RECOVERY_WEEK,
    );
    expect(
      out.items.some((i) =>
        ["accessory", "back_off", "tendon", "power_potentiation"].includes(i.kind),
      ),
    ).toBe(false);
  });

  it("eases every lift of a cluster session, not just the first", () => {
    const out = buildDeloadPrescription(
      presc([
        { movementId: "sq", kind: "main", percentTm: 80, reps: 5 },
        { movementId: "bn", kind: "main", percentTm: 80, reps: 5 },
      ]),
      TB_RECOVERY_WEEK,
    );
    const byMovement = new Map<string, number>();
    for (const m of mainsOf(out)) {
      byMovement.set(m.movementId, (byMovement.get(m.movementId) ?? 0) + 1);
    }
    expect(byMovement.get("sq")).toBe(3);
    expect(byMovement.get("bn")).toBe(3);
  });

  it("collapses several working sets of one lift into the policy's sets", () => {
    const out = buildDeloadPrescription(
      presc([
        { movementId: "sq", kind: "main", percentTm: 75, reps: 5 },
        { movementId: "sq", kind: "main", percentTm: 85, reps: 5 },
        { movementId: "sq", kind: "main", percentTm: 95, reps: 3, isAmrap: true },
      ]),
      TB_RECOVERY_WEEK,
    );
    expect(mainsOf(out)).toHaveLength(3);
  });

  it("produces an off-program prescription (no programRef / markers carried)", () => {
    const source = {
      items: [{ movementId: "sq", kind: "main", percentTm: 85, reps: 5 }],
      programRef: { engineId: "wendler-531", ref: "b0-w1-s1" },
      deloadSkipped: true,
    } as unknown as Prescription;
    const out = buildDeloadPrescription(source, TB_RECOVERY_WEEK);
    expect((out as Record<string, unknown>).programRef).toBeUndefined();
    expect((out as Record<string, unknown>).deloadSkipped).toBeUndefined();
  });
});

describe("buildDeloadWeek", () => {
  it("maps each source session to a recovery session, in day order, omitting empties", () => {
    const week = buildDeloadWeek(
      [
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
          // Accessory-only day → empty once eased → omitted (becomes rest).
          dayIndex: 4,
          slot: "single",
          title: "Pump day",
          sessionModality: null,
          prescription: presc([{ movementId: "ac", kind: "accessory", reps: 15 }]),
        },
      ],
      TB_RECOVERY_WEEK,
    );
    expect(week.map((s) => s.dayIndex)).toEqual([0, 2]);
    expect(week[0]!.title).toBe("Recovery · Bench day");
  });

  it("leaves a rest-only program's strength days as rest", () => {
    const week = buildDeloadWeek(
      [
        {
          dayIndex: 0,
          slot: "single",
          title: "Squat day",
          sessionModality: null,
          prescription: presc([{ movementId: "sq", kind: "main", percentTm: 85, reps: 5 }]),
        },
      ],
      GREEN_RECOVERY_WEEK,
    );
    expect(week).toHaveLength(0);
  });

  it("skips sessions with a null prescription", () => {
    const week = buildDeloadWeek(
      [
        { dayIndex: 0, slot: "single", title: null, sessionModality: null, prescription: null },
      ],
      TB_RECOVERY_WEEK,
    );
    expect(week).toHaveLength(0);
  });
});
