import { describe, expect, it } from "vitest";
import {
  canCopyAuthoredProgram, copyAuthoredProgramContent, type AuthoredMovement, type AuthoredProgramDefinitionV2,
} from "./authored-program";

const movement = (id: string): AuthoredMovement => ({
  id, movementId: "bench", role: "main", sets: "3", dose: { kind: "reps", reps: "6–10" },
  load: { kind: "kg", value: 80 }, overrides: { 1: { sets: "4", load: { kind: "kg", value: 85 } } },
  restSeconds: 150, notes: "Pause on chest",
});
const source: AuthoredProgramDefinitionV2 = {
  version: 2, activity: "hybrid", name: "Source",
  weeks: [{ type: "Build", sets: "4", reps: "5", pct: 75 }, { type: "Deload", sets: "3", reps: "5", pct: 70, fewer: true }],
  workouts: [{
    id: "w1", name: "Upper", weekday: 0, parts: [
      { id: "p1", kind: "movement", movement: movement("m1"), linkNext: true },
      { id: "p2", kind: "movement", movement: movement("m2") },
      { id: "p3", kind: "rehab", protocolId: "rehab" },
      { id: "p4", kind: "circuit", name: "Finisher", rounds: 3, weeks: [{ rounds: 3 }, { rounds: 2 }], movements: [movement("m3"), movement("m4")] },
      { id: "p5", kind: "cardio", movementId: "run", modality: "run", intensity: "z2", repeats: 1, notes: "Easy",
        intervals: [{ id: "i1", label: "Run", effort: "easy", target: { kind: "time", seconds: 1800 } }] },
    ],
  }],
};

function ids(content: ReturnType<typeof copyAuthoredProgramContent>) {
  return content.workouts.flatMap((workout) => [workout.id, ...workout.parts.flatMap((part) =>
    part.kind === "movement" ? [part.id, part.movement.id]
      : part.kind === "circuit" ? [part.id, ...part.movements.map((entry) => entry.id)]
        : part.kind === "cardio" ? [part.id, ...part.intervals.map((entry) => entry.id)] : [part.id])]);
}

describe("copying an authored program", () => {
  it("keeps sets, reps, loads, notes, weekly changes, links and weeks", () => {
    let next = 0;
    const copy = copyAuthoredProgramContent(source, () => `new-${next++}`);
    expect(copy.weeks).toEqual(source.weeks);
    const strip = (value: unknown) => JSON.parse(JSON.stringify(value, (key, entry) => key === "id" ? undefined : entry));
    expect(strip(copy.workouts)).toEqual(strip(source.workouts));
  });

  it("gives every workout, part, station and interval a fresh unique id", () => {
    let next = 0;
    const copy = copyAuthoredProgramContent(source, () => `new-${next++}`);
    const copied = ids(copy);
    expect(new Set(copied).size).toBe(copied.length);
    expect(copied.every((id) => id.startsWith("new-"))).toBe(true);
  });

  it("does not share mutable state with the source", () => {
    const copy = copyAuthoredProgramContent(source, () => crypto.randomUUID());
    const part = copy.workouts[0]!.parts[0]!;
    if (part.kind === "movement") part.movement.overrides![1]!.sets = "9";
    copy.weeks[0]!.sets = "9";
    expect(source.weeks[0]!.sets).toBe("4");
    expect(source.workouts[0]!.parts[0]).toHaveProperty("movement.overrides.1.sets", "4");
  });

  it("upgrades a v1 source before copying", () => {
    const copy = copyAuthoredProgramContent({ version: 1, activity: "strength", name: "Old", weeks: 3,
      workouts: [{ id: "w", name: "Day", weekday: 2, parts: [{ id: "p", kind: "movement", movement: { ...movement("m"), weightKg: 60, load: undefined } }] }] },
    () => crypto.randomUUID());
    expect(copy.weeks).toHaveLength(3);
    expect(copy.workouts[0]!.weekday).toBe(2);
  });

  it("allows a program into the same activity or into hybrid only", () => {
    expect(canCopyAuthoredProgram("hybrid", "hybrid")).toBe(true);
    expect(canCopyAuthoredProgram("strength", "hybrid")).toBe(true);
    expect(canCopyAuthoredProgram("running", "hybrid")).toBe(true);
    expect(canCopyAuthoredProgram("hybrid", "strength")).toBe(false);
    expect(canCopyAuthoredProgram("strength", "running")).toBe(false);
  });
});
