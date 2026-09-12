import { describe, expect, it } from "vitest";
import { estimateCriticalSwimSpeed, type SwimSetup } from "@hta/domain";
import { applySwimProposal, generateSwimPlan, type SwimPlan, type SwimSlotOutcome } from "./swimming";

const setup: SwimSetup = {
  goal: "endurance", experience: "recreational",
  course: { numerator: 25, denominator: 1, unit: "m" },
  knownStrokes: ["freestyle"], equipment: [], recentComfortableLengths: 40,
  sessionBudgetMinutes: 45,
};
const assessment = estimateCriticalSwimSpeed({
  course: setup.course, stroke: "freestyle", equipment: [], protocol: "css_200_400",
  observedOn: "2026-09-01", verified: true, version: "swim-css-1",
  trials: [
    { distance: 200, lengths: 8, timeMs: 200_000 },
    { distance: 400, lengths: 16, timeMs: 440_000 },
  ],
});
if (!assessment.ok) throw new Error(assessment.error.message);
const calibration = assessment.value;

function makePlan(learning = false): SwimPlan {
  const generated = generateSwimPlan({
    setup: learning ? { ...setup, recentComfortableLengths: 0, knownStrokes: [] } : setup,
    calibration: learning ? null : calibration,
    dose: { mainRepeats: 20, mainRepLengths: 4, mainRestSeconds: 30 },
    weeks: [
      { weekIndex: 0, startDateISO: "2026-09-01", slots: [
        { slotId: "past", dateISO: "2026-09-02", intent: "moderate", source: "swim_date", budgetMinutes: 20 },
      ] },
      { weekIndex: 1, startDateISO: "2026-09-07", slots: [
        { slotId: "started", dateISO: "2026-09-08", intent: "moderate", source: "swim_date", budgetMinutes: 60 },
        ...[20, 60, 90, 1].map((budgetMinutes, index) => ({
          slotId: `budget-${budgetMinutes}`, dateISO: `2026-09-${String(9 + index).padStart(2, "0")}`,
          intent: "moderate" as const, source: "cardio_slot" as const, budgetMinutes,
        })),
      ] },
    ],
  });
  if (!generated.ok) throw new Error(generated.error.message);
  return generated.value;
}

function slots(plan: SwimPlan): Map<string, SwimSlotOutcome> {
  return new Map(plan.weeks.flatMap((week) => week.slots.map((slot) => [slot.slotId, slot] as const)));
}

function accept(plan: SwimPlan): SwimPlan {
  const updated = applySwimProposal(plan, { ...plan.dose, mainRepeats: 21 }, {
    asOfISO: "2026-09-07", startedSlotIds: ["started"],
  });
  if (!updated.ok) throw new Error(updated.error.message);
  return updated.value;
}

describe("DC-SW3/DC-SW5 resolved slot budgets", () => {
  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, -1])(
    "rejects an invalid explicit budget (%s) for workouts and learning guidance",
    (budgetMinutes) => {
      for (const recentComfortableLengths of [0, 8]) {
        const result = generateSwimPlan({
          setup: { ...setup, recentComfortableLengths },
          calibration: null,
          weeks: [{
            weekIndex: 0, startDateISO: "2026-09-07",
            slots: [{
              slotId: "invalid", dateISO: "2026-09-09",
              intent: "moderate", source: "swim_date", budgetMinutes,
            }],
          }],
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe("setup_invalid");
          expect(result.error.details?.slotId).toBe("invalid");
        }
      }
    },
  );

  it("requires time for swimming when turnarounds alone exhaust an uncalibrated slot", () => {
    const generate = (budgetMinutes: number) => generateSwimPlan({
      setup,
      calibration: null,
      weeks: [{
        weekIndex: 0, startDateISO: "2026-09-07",
        slots: [{
          slotId: "short", dateISO: "2026-09-09",
          intent: "moderate", source: "swim_date", budgetMinutes,
        }],
      }],
    });
    const result = generate(1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const outcome = result.value.weeks[0]!.slots[0]!;
    expect(outcome.kind).toBe("conflict");
    if (outcome.kind !== "conflict") return;
    expect(outcome.conflict.code).toBe("budget_impossible");
    const minimumMinutes = outcome.conflict.details?.minimumMinutes;
    expect(minimumMinutes).toBeGreaterThan(1);
    if (typeof minimumMinutes !== "number") throw new Error("Expected a minimum budget");
    const retried = generate(minimumMinutes);
    expect(retried.ok).toBe(true);
    if (!retried.ok) return;
    const workout = retried.value.weeks[0]!.slots[0]!;
    expect(workout.kind).toBe("workout");
    if (workout.kind !== "workout") return;
    expect(workout.issued.estimatedMs).toBeNull();
    expect(workout.issued.budget.accountedMs).toBeLessThan(minimumMinutes * 60_000);
    expect(workout.issued.sections.map((section) => section.kind)).toEqual([
      "warmup", "main", "cooldown",
    ]);
  });

  it("still accepts an exact time-budget fit when every item has a verified pace", () => {
    const generate = (budgetMinutes: number) => generateSwimPlan({
      setup,
      calibration,
      weeks: [{
        weekIndex: 0, startDateISO: "2026-09-07",
        slots: [{
          slotId: "timed", dateISO: "2026-09-09",
          intent: "moderate", source: "swim_date", budgetMinutes,
        }],
      }],
    });
    const generous = generate(90);
    if (!generous.ok) throw new Error(generous.error.message);
    const before = generous.value.weeks[0]!.slots[0]!;
    if (before.kind !== "workout" || before.issued.estimatedMs === null) {
      throw new Error("Expected a fully timed workout");
    }
    const exact = generate(before.issued.estimatedMs / 60_000);
    expect(exact.ok).toBe(true);
    if (!exact.ok) return;
    const after = exact.value.weeks[0]!.slots[0]!;
    expect(after.kind).toBe("workout");
    if (after.kind !== "workout") return;
    expect(after.issued.sections).toEqual(before.issued.sections);
    expect(after.issued.budget.accountedMs).toBe(after.issued.budget.minutes * 60_000);
  });

  it("retains 20/60/90-minute caps and an impossible slot when accepting a new dose", () => {
    const plan = makePlan();
    const before = slots(plan);
    const after = slots(accept(plan));
    for (const minutes of [20, 60, 90]) {
      const original = before.get(`budget-${minutes}`)!;
      const reissued = after.get(`budget-${minutes}`)!;
      expect(original.budgetMinutes).toBe(minutes);
      expect(reissued.budgetMinutes).toBe(minutes);
      if (original.kind !== "workout" || reissued.kind !== "workout") throw new Error("Expected a workout");
      expect(reissued.issued.budget.minutes).toBe(minutes);
      expect(reissued.issued.budget.accountedMs).toBeLessThanOrEqual(minutes * 60_000);
      expect(reissued.original).toBe(original.original);
    }
    expect(before.get("budget-1")).toMatchObject({ kind: "conflict", budgetMinutes: 1, conflict: { code: "budget_impossible" } });
    expect(after.get("budget-1")).toEqual(before.get("budget-1"));
    expect(after.get("past")).toBe(before.get("past"));
    expect(after.get("started")).toBe(before.get("started"));
    const short = after.get("budget-20")!;
    const long = after.get("budget-90")!;
    if (short.kind !== "workout" || long.kind !== "workout") throw new Error("Expected workouts");
    expect(short.issued.totalLengths).toBeLessThan(long.issued.totalLengths);
  });

  it("keeps each guidance slot's resolved budget through reissue", () => {
    const updated = slots(accept(makePlan(true)));
    for (const minutes of [20, 60, 90, 1]) {
      expect(updated.get(`budget-${minutes}`)).toMatchObject({
        kind: "guidance", budgetMinutes: minutes, guidance: { minutes },
      });
    }
  });

  it("recovers legacy budgets from workouts and conflicts without inflating an impossible slot", () => {
    const original = makePlan();
    const legacy: SwimPlan = {
      ...original,
      weeks: original.weeks.map((week) => ({
        ...week,
        slots: week.slots.map((slot) => {
          const copy = { ...slot };
          delete copy.budgetMinutes;
          return copy;
        }),
      })),
    };
    const updated = slots(accept(legacy));
    for (const minutes of [20, 60, 90, 1]) expect(updated.get(`budget-${minutes}`)?.budgetMinutes).toBe(minutes);
    expect(updated.get("budget-1")).toMatchObject({ kind: "conflict", conflict: { code: "budget_impossible" } });
  });
});
