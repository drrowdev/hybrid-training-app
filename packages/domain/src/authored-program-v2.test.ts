import { describe, expect, it } from "vitest";
import {
  authoredLoadDisplay, authoredMovementIds, authoredProgramDates, authoredRange, authoredWorkoutActivity, compileAuthoredWorkout,
  effectiveAuthoredMovement, formatAuthoredLoad, parseAuthoredLoad, upgradeAuthoredProgram,
  type AuthoredMovement, type AuthoredProgramDefinitionV2, type AuthoredWeek, type AuthoredWorkout,
} from "./authored-program";
import { accountMaxMovementIds } from "./scheduled-progression";
import { resolveTargetLoadKg } from "./target-load";

const bench = { id: "bench", slug: "bench-press-flat", displayName: "Bench press", pattern: "press" };
const pullup = { id: "pullup", slug: "weighted-pull-up", displayName: "Weighted pull-up", pattern: "pull" };
const run = { id: "run", slug: "run-easy-z2", displayName: "Running", pattern: "cardio", modality: "run" };
const ski = { id: "ski", slug: "ski-erg", displayName: "SkiErg", pattern: "cardio", modality: "ski" };
const movement: AuthoredMovement = {
  id: "m", movementId: bench.id, role: "main", sets: "3", dose: { kind: "reps", reps: "6–10" },
  load: { kind: "rir", value: "2–3" }, restSeconds: 150, notes: "",
};
const weeks: AuthoredWeek[] = [
  { type: "Build", sets: "4", reps: "5", pct: 75 },
  { type: "Build", sets: "4", reps: "4", pct: 80 },
  { type: "Build", sets: "3", reps: "3", pct: 85 },
  { type: "Deload", sets: "3", reps: "5", pct: 72.5, fewer: true },
  { type: "Build", sets: "3–4", reps: "4", pct: 80 },
  { type: "Test", sets: "1", reps: "3", pct: 90, after: "keep" },
];
const workout: AuthoredWorkout = {
  id: "day", name: "Upper", weekday: 0, parts: [{ id: "part", kind: "movement", movement }],
};
const definition: AuthoredProgramDefinitionV2 = { version: 2, name: "Six weeks", activity: "hybrid", weeks, workouts: [workout] };
const compile = (week: number, entry = workout) => compileAuthoredWorkout(entry, [bench, pullup, run, ski], undefined, weeks[week], week);

describe("DC-A1/DC-R3/DC-R6 authored week prescriptions", () => {
  it("upgrades fixed v1 main lifts without inventing percentage loads or changing any week", () => {
    const legacyWorkout: AuthoredWorkout = { ...workout, parts: [
      { id: "fixed", kind: "movement", movement: { ...movement, sets: 2, dose: { kind: "reps", reps: 8 }, load: undefined, weightKg: 42.5 } },
      { id: "unloaded", kind: "movement", movement: { ...movement, id: "unloaded", load: undefined } },
    ] };
    const legacy = { version: 1 as const, name: "Old", activity: "strength" as const, weeks: 3, workouts: [legacyWorkout] };
    const upgraded = upgradeAuthoredProgram(legacy);
    expect(upgraded.version).toBe(2);
    expect(upgraded.weeks).toHaveLength(3);
    for (const [index, week] of upgraded.weeks.entries()) {
      const items = compileAuthoredWorkout(upgraded.workouts[0]!, [bench], undefined, week, index).items;
      expect(items.slice(0, 2).every((item) => item.targetWeightKg === 42.5 && item.reps === 8)).toBe(true);
      expect(items.every((item) => item.percentTm === undefined)).toBe(true);
    }
    expect(legacy.workouts[0]!.parts[0]).toHaveProperty("movement.weightKg", 42.5);
    expect(upgradeAuthoredProgram(upgraded)).toBe(upgraded);
  });
  it("uses the selected week, preserving ranges and optional sets", () => {
    expect(compile(0).items).toHaveLength(4);
    expect(compile(0).items[0]).toMatchObject({ reps: 5, percentTm: 75 });
    expect(compile(3).items).toHaveLength(3);
    expect(compile(3).items[0]).toMatchObject({ reps: 5, percentTm: 72.5 });
    expect(compile(4).items.map((item) => item.optional)).toEqual([false, false, false, true]);
    expect(compile(4).items[0]?.setRange).toEqual({ min: 3, max: 4 });
    expect(compile(5).items).toMatchObject([{ sets: 1, reps: 3, percentTm: 90, isAmrap: false }]);
    expect(compile(5).items[0]?.targetWeightKg).toBeUndefined();
  });
  it("DC-K4 applies explicit per-week overrides after the week default and accessory deload", () => {
    const accessory = { ...movement, role: "accessory" as const, sets: "2–3" };
    expect(effectiveAuthoredMovement(accessory, weeks[3], 3)).toMatchObject({ sets: "1–2", reps: "6–10", deload: true });
    const changed = { ...accessory, overrides: { "3": { sets: "3", reps: "8", load: { kind: "kg" as const, value: 20 } } } };
    expect(effectiveAuthoredMovement(changed, weeks[3], 3)).toMatchObject({ sets: "3", reps: "8", overridden: true, deload: false });
    expect(effectiveAuthoredMovement(changed, weeks[0], 0).sets).toBe("2–3");
    expect(effectiveAuthoredMovement({ ...accessory, sets: "1" }, weeks[3], 3).sets).toBe("1");
    expect(effectiveAuthoredMovement({ ...accessory, role: "tendon" }, weeks[3], 3).sets).toBe("2–3");
    const main = { ...movement, overrides: { "3": { sets: "2" } } };
    expect(effectiveAuthoredMovement(main, weeks[3], 3)).toMatchObject({ sets: "2", reps: "5", load: { kind: "pct", value: 72.5 } });
  });
  it("compiles accessory rep/RIR ranges without converting them to max-effort work", () => {
    const items = compile(3, { ...workout, parts: [{ id: "a", kind: "movement", movement: { ...movement, role: "accessory", sets: "2–3" } }] }).items;
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ repRange: { min: 6, max: 10 }, targetRir: { min: 2, max: 3 }, setRange: { min: 1, max: 2 } });
    expect(items[0]?.percentTm).toBeUndefined();
  });
  it("keeps authored week indices separate from Monday-based storage weeks", () => {
    const dates = authoredProgramDates(definition, "2026-09-30");
    expect(dates[0]).toMatchObject({ date: "2026-10-05", weekIndex: 1, authoredWeekIndex: 0 });
    expect(dates[3]).toMatchObject({ date: "2026-10-26", weekIndex: 4, authoredWeekIndex: 3 });
  });
});

describe("DC-A1/DC-R6 live account load resolution", () => {
  it("resolves current account maxes at 2.5 kg, independent of the account working percentage", () => {
    const item = compile(0).items[0]!;
    expect(resolveTargetLoadKg(item, { tmKg: 50, oneRmKg: 100 })).toBe(75);
    expect(resolveTargetLoadKg(item, { tmKg: 50, oneRmKg: 102.5 })).toBe(77.5);
    expect(resolveTargetLoadKg(item, { tmKg: 50 })).toBeNull();
    expect(accountMaxMovementIds([{ active: true, owned: true, items: [item] }])).toEqual(new Set([bench.id]));
  });
  it("subtracts bodyweight from the stored total-system max and rounds only the added load", () => {
    const display = authoredLoadDisplay({ kind: "pct", value: 90 }, pullup, 132, 87);
    expect(display.text).toBe("+32.5 kg");
    expect(display.rounded).toBe(true);
    expect(display.note).toBe("90% of 132 kg (87 kg bodyweight + 45 kg) = +32.5 kg");
    expect(authoredLoadDisplay({ kind: "pct", value: 80 }, pullup, 132, 87).text).toBe("+17.5 kg");
    expect(authoredLoadDisplay({ kind: "pct", value: 90 }, pullup, 132).text).toBe("90%");
    expect(authoredLoadDisplay({ kind: "pct", value: 50 }, pullup, 132, 87).text).toBe("+0 kg");
  });
  it("DC-A1 reports rounding only when the displayed weight changes", () => {
    expect(authoredLoadDisplay({ kind: "pct", value: 75 }, bench, 100).rounded).toBe(false);
    expect(authoredLoadDisplay({ kind: "pct", value: 75 }, bench, 102.5).rounded).toBe(true);
  });
  it("retains explicit unloaded sets and parses the accepted load inputs", () => {
    expect(resolveTargetLoadKg({ targetWeightKg: 0, meta: { authoredPartId: "a" } })).toBe(0);
    expect(parseAuthoredLoad("75%")).toEqual({ kind: "pct", value: 75 });
    expect(parseAuthoredLoad("80 kg")).toEqual({ kind: "kg", value: 80 });
    expect(formatAuthoredLoad(parseAuthoredLoad("RIR 2–3"))).toBe("RIR 2–3");
    expect(parseAuthoredLoad("")).toBeNull();
    expect(() => parseAuthoredLoad("heavy")).toThrow();
    expect(() => parseAuthoredLoad("75–80%")).toThrow();
    expect(() => authoredRange("12–8")).toThrow();
    expect(authoredRange("6–8 / leg")).toEqual({ min: 6, max: 8 });
  });
});

describe("DC-R3 executable circuits and cardio", () => {
  const stations = [{ ...movement, role: "accessory" as const, movementId: ski.id, dose: { kind: "distance" as const, metres: 500 } },
    { ...movement, id: "other", role: "accessory" as const }];
  it("classifies the day's activity from its exercises, including mixed station circuits", () => {
    const catalog = [bench, ski, run];
    expect(authoredWorkoutActivity(workout, catalog)).toBe("strength");
    expect(authoredWorkoutActivity({ ...workout, parts: [{ id: "c", kind: "circuit", name: "Stations", rounds: 3, movements: stations }] }, catalog)).toBe("hybrid");
    expect(authoredWorkoutActivity({ ...workout, parts: [{ id: "run", kind: "cardio", movementId: run.id,
      modality: "run", intensity: "z2", repeats: 1, notes: "", intervals: [], duration: "40" }] }, catalog)).toBe("running");
  });
  it("cycles total run/station pairs rather than multiplying pairs by station count", () => {
    const part = { id: "c", kind: "circuit" as const, name: "Run + station", rounds: 4, runMovementId: run.id,
      weeks: weeks.map((_, index) => ({ rounds: index === 3 ? 3 : 4, runMetres: 800 })), movements: stations };
    const circuit = { ...workout, parts: [part] };
    const items = compile(0, circuit).items;
    expect(items).toHaveLength(8);
    expect(items.map((item) => item.movementId)).toEqual(["run", "ski", "run", "bench", "run", "ski", "run", "bench"]);
    expect(new Set(items.map((item) => item.meta.authoredPartId)).size).toBe(8);
    expect(compile(3, circuit).items).toHaveLength(6);
    expect(authoredMovementIds({ ...definition, workouts: [circuit] })).toContain(run.id);
  });
  it("does full laps without runs, retaining independently loggable cardio stations", () => {
    const circuit = { ...workout, parts: [{ id: "c", kind: "circuit" as const, name: "Stations", rounds: 3, movements: stations }] };
    const items = compile(0, circuit).items;
    expect(items).toHaveLength(6);
    expect(items.map((item) => item.movementId)).toEqual(["ski", "bench", "ski", "bench", "ski", "bench"]);
    expect(new Set(items.map((item) => item.meta.authoredPartId)).size).toBe(6);
  });
  it("keeps cardio duration ranges and effort visible with the lower duration as the logging target", () => {
    const items = compile(0, { ...workout, parts: [{ id: "c", kind: "cardio", movementId: run.id, modality: "run",
      intensity: "z2", repeats: 1, intervals: [], notes: "", duration: "40–60", effort: "Zone 2" }] }).items;
    expect(items[0]).toMatchObject({ durationMin: 40, cardioPlan: { meta: "40–60 min", effort: "Zone 2" } });
    expect(items[0]?.meta).toMatchObject({ repeats: 1, intervals: [{ target: { kind: "time", seconds: 2400 } }] });
  });
});
