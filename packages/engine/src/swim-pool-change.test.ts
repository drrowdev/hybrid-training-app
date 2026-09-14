import { describe, expect, it } from "vitest";
import { estimateCriticalSwimSpeed, poolCourse, type SwimWorkout, type SwimSetup } from "@hta/domain";
import { applyAcceptedBenchmark, applySwimProposal, changeSwimWorkoutPool, generateSwimPlan, swimPlanWeekLengths } from "./swimming";

const long = poolCourse(50, 1, "m"), short = poolCourse(25, 1, "m");
const estimate = estimateCriticalSwimSpeed({
  course: long, protocol: "css_200_400", stroke: "freestyle", equipment: [], verified: true,
  observedOn: "2026-09-01", version: "swim-css-1",
  trials: [{ distance: 200, lengths: 4, timeMs: 200_000 }, { distance: 400, lengths: 8, timeMs: 420_000 }],
});
if (!estimate.ok) throw new Error("Invalid synthetic assessment");
const calibration = estimate.value;
const setup: SwimSetup = {
  course: long, goal: "endurance", experience: "recreational", knownStrokes: ["freestyle"],
  equipment: [], recentComfortableLengths: 8, sessionBudgetMinutes: 60,
};
function fixture() {
  const result = generateSwimPlan({
    setup, calibration, weeks: [{ weekIndex: 0, startDateISO: "2026-09-07", slots: [
      { slotId: "a", dateISO: "2026-09-08", intent: "moderate", source: "swim_date" },
      { slotId: "b", dateISO: "2026-09-10", intent: "moderate", source: "swim_date" },
    ] }],
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}
function convert(workout: SwimWorkout) {
  const result = changeSwimWorkoutPool(workout, short, calibration);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

describe("DC-SW1/DC-SW2/DC-SW5 pool-specific issued work", () => {
  it("changes lengths, not distances, repeats, effort, rest or original input", () => {
    const slot = fixture().weeks[0]!.slots[0]!;
    if (slot.kind !== "workout") throw new Error("Expected workout");
    const original = structuredClone(slot.issued);
    const changed = convert(slot.issued);
    expect(changed.totalLengths).toBe(original.totalLengths * 2);
    for (const [index, section] of changed.sections.entries()) {
      expect(section.rounds).toBe(original.sections[index]!.rounds);
      section.items.forEach((item, itemIndex) => {
        const before = original.sections[index]!.items[itemIndex]!;
        const { targetMsPerRepeat: _target, ...prescribed } = before;
        expect(item).toEqual({ ...prescribed, lengths: before.lengths * 2 });
      });
    }
    expect(slot.issued).toEqual(original);
    expect(changed.snapshot.calibration).toBeNull();
    expect(changed.snapshot.protocol).toBeNull();
    expect(changed.snapshot.versions.assessment).toBeNull();
    expect(changed.estimatedMs).toBeNull();
    expect(changed.sections.flatMap((section) => section.items).every((item) => item.targetMsPerRepeat === undefined)).toBe(true);
    expect(changed.budget.accountedMs).toBe(changed.sections.reduce((sum, section) =>
      sum + section.rounds * section.items.reduce((subtotal, item) => subtotal + (item.restSeconds ?? 0) * 1000 * (item.repeats - 1) + 20_000, 0), 0));
  });
  it("restores supported targets when returning to the assessment's own pool", () => {
    const slot = fixture().weeks[0]!.slots[0]!;
    if (slot.kind !== "workout") throw new Error("Expected workout");
    const result = changeSwimWorkoutPool(convert(slot.issued), long, calibration);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.totalLengths).toBe(slot.issued.totalLengths);
      expect(result.value.snapshot.calibration).toEqual(slot.issued.snapshot.calibration);
    }
  });
  it("rejects incompatible individual repeats even when the total fits", () => {
    const slot = fixture().weeks[0]!.slots[0]!;
    if (slot.kind !== "workout") throw new Error("Expected workout");
    const changed = convert(slot.issued);
    const sections = changed.sections.map((section) => ({ ...section, items: section.items.map((item) => ({ ...item, lengths: 1, repeats: 2 })) }));
    const totalLengths = sections.reduce((sum, section) => sum + section.rounds * section.items.length * 2, 0);
    expect(changeSwimWorkoutPool({ ...changed, sections, totalLengths }, long)).toMatchObject({
      ok: false, error: { code: "distance_not_whole_lengths" },
    });
  });
  it("retains fixed departures and counts their known time without carrying swimming pace", () => {
      const slot = fixture().weeks[0]!.slots[0]!;
      if (slot.kind !== "workout") throw new Error("Expected workout");
      const withDepartures = {
        ...slot.issued, sections: slot.issued.sections.map((section) => ({
          ...section, items: section.items.map((item) => ({ ...item, sendoffMs: 120_000 })),
        })),
      };
      const changed = convert(withDepartures);
      const known = changed.sections.reduce((sum, section) =>
        sum + section.rounds * section.items.reduce((subtotal, item) => subtotal + 120_000 * (item.repeats - 1) + 20_000, 0), 0);
      expect(changed.budget.accountedMs).toBe(known);
      expect(changed.estimatedMs).toBeNull();
      expect(changed.sections.flatMap((section) => section.items).every((item) => item.sendoffMs === 120_000)).toBe(true);
    });
    it("refuses a known budget or departure-time conflict instead of changing the prescription", () => {
      const slot = fixture().weeks[0]!.slots[0]!;
      if (slot.kind !== "workout") throw new Error("Expected workout");
      expect(changeSwimWorkoutPool({ ...slot.issued, budget: { ...slot.issued.budget, minutes: 1 } }, short))
        .toMatchObject({ ok: false, error: { code: "budget_impossible" } });
      const impossible = { ...slot.issued, sections: slot.issued.sections.map((section) => ({
        ...section, items: section.items.map((item) => ({ ...item, sendoffMs: 1 })),
      })) };
      expect(changeSwimWorkoutPool(impossible, long, calibration)).toMatchObject({ ok: false, error: { code: "budget_impossible" } });
    });
    it("does not use long-course pace to trim short-course work during regeneration", () => {
      const original = fixture();
      const shortPlan = { ...original, weeks: original.weeks.map((week) => ({
        ...week, slots: week.slots.map((slot) => slot.kind === "workout" ? { ...slot, issued: convert(slot.issued) } : slot),
      })) };
      const scope = { asOfISO: "2026-09-07", startedSlotIds: [] };
      const withoutAssessment = applySwimProposal({ ...shortPlan, calibration: null }, original.dose, scope);
      const withLongAssessment = applySwimProposal(shortPlan, original.dose, scope);
      expect(withoutAssessment.ok).toBe(true);
      expect(withLongAssessment.ok).toBe(true);
      if (withoutAssessment.ok && withLongAssessment.ok) expect(withLongAssessment.value.weeks).toEqual(withoutAssessment.value.weeks);
  });
  it("preserves a short-course choice and correct weekly distance through later week edits", () => {
    const original = fixture();
    const mixed = { ...original, weeks: original.weeks.map((week) => ({
      ...week, slots: week.slots.map((slot, index) => index === 0 && slot.kind === "workout" ? { ...slot, issued: convert(slot.issued) } : slot),
    })) };
    expect(swimPlanWeekLengths(mixed.weeks[0]!, long)).toBe(swimPlanWeekLengths(original.weeks[0]!, long));
    const updated = applySwimProposal(mixed, { ...original.dose, mainRepeats: original.dose.mainRepeats + 1 }, { asOfISO: "2026-09-07", startedSlotIds: [] });
    expect(updated.ok).toBe(true);
    if (updated.ok) {
      const slots = updated.value.weeks[0]!.slots;
      const first = original.weeks[0]!.slots[0]!;
      if (first.kind !== "workout") throw new Error("Expected workout");
      expect(slots[0]).toMatchObject({ issued: { snapshot: { course: short } }, original: first.original });
      expect(slots[1]).toMatchObject({ issued: { snapshot: { course: long } } });
    }
    const assessed = applyAcceptedBenchmark(mixed, calibration, { asOfISO: "2026-09-07", startedSlotIds: [] });
    expect(assessed.weeks[0]!.slots[0]).toEqual(mixed.weeks[0]!.slots[0]);
  });
});
