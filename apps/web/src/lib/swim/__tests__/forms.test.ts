import { describe, expect, it } from "vitest";
import { parseActualForm, parseSetupForm, parseSwimObservation } from "../forms";
import { estimateCriticalSwimSpeed } from "@hta/domain";
import { generateSwimPlan, swimWeeksFromWeekdays } from "@hta/engine";
import { workoutPresentation } from "../presentation";

function setup() {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    pool: "custom", poolNumerator: "100", poolDenominator: "3", poolUnit: "m",
    goal: "base", experience: "returning", comfortableLengths: "3",
    timeBudgetMinutes: "30", startDate: "2026-09-07", weeks: "6",
  })) form.set(key, value);
  form.append("weekdays", "1"); form.append("weekdays", "4"); form.append("strokes", "freestyle");
  return form;
}

function actual() {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    workoutId: "00000000-0000-4000-8000-000000000001",
    sessionId: "00000000-0000-4000-8000-000000000002", expectedRevision: "2",
    lengths: "12", timeMs: "654321", rpe: "", stroke: "freestyle",
  })) form.set(key, value);
  return form;
}

describe("ADR0079 swimming form boundaries", () => {
  it("preserves exact custom pools and accepts uncalibrated setup", () => {
    const value = parseSetupForm(setup());
    expect(value.setup.course).toEqual({ numerator: 100, denominator: 3, unit: "m" });
    expect(value.observation).toBeNull();
    expect(value.weekdays).toEqual([1, 4]);
  });
  it("requires explicit verification for paired-distance assessment", () => {
    const form = setup();
    form.set("time200", "4:00"); form.set("time400", "8:30");
    expect(() => parseSetupForm(form)).toThrow("Verify");
  });
  it.each(["base", "endurance"])("DC-SW3 shows verified targets for %s without inventing a whole-swim duration", (goal) => {
    const form = setup();
    form.set("goal", goal);
    form.set("time200", "4:00"); form.set("time400", "8:30");
    form.set("verified", "on"); form.set("benchmarkDate", "2026-09-05");
    form.set("benchmarkStroke", "freestyle");
    const parsed = parseSetupForm(form);
    const observation = parseSwimObservation(parsed.observation);
    expect(observation.verified).toBe(true);
    const calibration = estimateCriticalSwimSpeed(observation);
    const weeks = swimWeeksFromWeekdays({ startDateISO: parsed.startDate, weeks: parsed.weeks, weekdays: parsed.weekdays });
    if (!calibration.ok || !weeks.ok) throw new Error("Expected valid assessment and dates");
    const plan = generateSwimPlan({ setup: parsed.setup, calibration: calibration.value, weeks: weeks.value });
    if (!plan.ok) throw new Error(plan.error.message);
    const workout = plan.value.weeks[0]!.slots.find((slot) => slot.kind === "workout");
    if (workout?.kind !== "workout") throw new Error("Expected a generated swim");
    if (goal === "endurance") expect(workout.issued.estimatedMs).not.toBeNull();
    else expect(workout.issued.estimatedMs).toBeNull();
    expect(workout.issued.sections.flatMap((section) => section.items).some((item) => (item.targetMsPerRepeat ?? 0) > 0)).toBe(true);
    expect(workoutPresentation(workout.issued).steps.some((step) => step.section === "Main set" && step.pace)).toBe(true);
  });
  it.each([false, undefined])("DC-SW3 keeps stored unverified assessments effort-only: %s", (verified) => {
    const form = setup();
    form.set("time200", "4:00"); form.set("time400", "8:30");
    form.set("verified", "on"); form.set("benchmarkDate", "2026-09-05");
    form.set("benchmarkStroke", "freestyle");
    const parsed = parseSetupForm(form);
    const calibration = estimateCriticalSwimSpeed(parseSwimObservation(parsed.observation));
    const weeks = swimWeeksFromWeekdays({ startDateISO: parsed.startDate, weeks: parsed.weeks, weekdays: parsed.weekdays });
    if (!calibration.ok || !weeks.ok) throw new Error("Expected valid assessment and dates");
    const observation = { ...calibration.value.observation };
    if (verified === undefined) delete observation.verified;
    else observation.verified = verified;
    const plan = generateSwimPlan({
      setup: parsed.setup, weeks: weeks.value,
      calibration: { ...calibration.value, observation },
    });
    if (!plan.ok) throw new Error(plan.error.message);
    for (const week of plan.value.weeks) for (const slot of week.slots) {
      if (slot.kind !== "workout") continue;
      expect(slot.issued.snapshot.calibration).toBeNull();
      expect(slot.issued.estimatedMs).toBeNull();
      expect(workoutPresentation(slot.issued).steps.every((step) => !step.pace)).toBe(true);
    }
  });
  it("does not extrapolate an unsupported whole-length assessment", () => {
    const form = setup();
    form.set("poolNumerator", "3333"); form.set("poolDenominator", "100");
    form.set("time200", "4:00"); form.set("time400", "8:30"); form.set("verified", "on");
    expect(() => parseSetupForm(form)).toThrow("exact 200 and 400");
  });
  it("rejects invalid calendar dates", () => {
    const form = setup(); form.set("startDate", "2026-02-31");
    expect(() => parseSetupForm(form)).toThrow();
  });
  it("retains manual milliseconds and leaves omitted RPE unknown", () => {
    const value = parseActualForm(actual());
    expect(value.timeMs).toBe(654321);
    expect(value.rpe).toBeNull();
    expect(value.splits).toEqual([]);
  });
  it("does not accept split distance greater than actual whole lengths", () => {
    const form = actual(); form.set("splits", "13, 5:00");
    expect(() => parseActualForm(form)).toThrow("Split lengths");
  });
  it("does not round partial lengths into completed distance", () => {
    const form = actual(); form.set("lengths", "2.5");
    expect(() => parseActualForm(form)).toThrow();
  });
});
