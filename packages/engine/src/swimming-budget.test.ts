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
