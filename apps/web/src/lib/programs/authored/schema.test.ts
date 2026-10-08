import { describe, expect, it } from "vitest";
import { upgradeAuthoredProgram, type AuthoredProgramDefinition, type AuthoredWorkoutPart } from "@hta/domain";
import { authoredProgramSchema } from "./schema";

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const definition = (activity: AuthoredProgramDefinition["activity"], parts: AuthoredWorkoutPart[]): AuthoredProgramDefinition => ({
  version: 1, activity, name: "My program", weeks: 2, workouts: [{ id: id(1), name: "Workout", weekday: 0, parts }],
});
const movement: AuthoredWorkoutPart = { id: id(2), kind: "movement", movement: {
  id: id(3), movementId: id(4), role: "main", sets: 3, dose: { kind: "reps", reps: 5 }, restSeconds: 90, notes: "",
} };
const run: AuthoredWorkoutPart = { id: id(5), kind: "cardio", movementId: id(6), modality: "run",
  intensity: "z2", repeats: 1, notes: "", intervals: [{ id: id(7), label: "Run", effort: "easy", target: { kind: "time", seconds: 1200 } }] };
const rehab: AuthoredWorkoutPart = { id: id(8), kind: "rehab", protocolId: id(9) };

describe("DC-R5 focused authored program contracts", () => {
  it.each(["strength", "running", "hybrid"] as const)("accepts an explicit library attachment in %s", (activity) => {
    expect(authoredProgramSchema.safeParse(definition(activity, [rehab])).success).toBe(true);
  });
  it("does not permit strength or circuits to masquerade as Running rehab", () => {
    expect(authoredProgramSchema.safeParse(definition("running", [movement])).success).toBe(false);
    expect(authoredProgramSchema.safeParse(definition("running", [{ ...movement, movement: { ...movement.movement, role: "tendon" } }])).success).toBe(false);
    expect(authoredProgramSchema.safeParse(definition("running", [{ id: id(10), kind: "circuit", name: "Circuit", rounds: 3,
      movements: [movement.movement, { ...movement.movement, id: id(11), movementId: id(12) }] }])).success).toBe(false);
    expect(authoredProgramSchema.safeParse(definition("running", [run, rehab])).success).toBe(true);
  });
  it("requires Hybrid for ordinary mixed modalities", () => {
    expect(authoredProgramSchema.safeParse(definition("strength", [movement, run])).success).toBe(false);
    expect(authoredProgramSchema.safeParse(definition("hybrid", [movement, run, rehab])).success).toBe(true);
    expect(authoredProgramSchema.safeParse(definition("running", [{ ...run, modality: "row" }])).success).toBe(false);
  });
  it("DC-A1: upgrades old definitions without replacing their prescriptions", () => {
    const parsed = authoredProgramSchema.parse(definition("strength", [movement]));
    expect(parsed.version).toBe(2);
    expect(parsed.weeks).toHaveLength(2);
    expect(parsed.workouts[0]?.parts[0]).toMatchObject({ movement: { overrides: {
      0: { sets: "3", reps: "5", load: null }, 1: { sets: "3", reps: "5", load: null },
    } } });
  });
  it.each(["invalid", "5-2", "0", "21", "1.5"])("DC-K4: invalid set range %s returns validation errors", (sets) => {
    const input = upgradeAuthoredProgram(definition("strength", [movement]));
    input.weeks[0]!.sets = sets;
    expect(authoredProgramSchema.safeParse(input).success).toBe(false);
  });
  it("DC-K4: rejects overrides outside the program and incomplete circuit weeks", () => {
    const input = upgradeAuthoredProgram(definition("strength", [movement]));
    const part = input.workouts[0]!.parts[0]!;
    if (part.kind !== "movement") throw new Error("Expected movement");
    part.movement.overrides = { 2: { sets: "2" } };
    expect(authoredProgramSchema.safeParse(input).success).toBe(false);
    input.workouts[0]!.parts = [{ id: id(10), kind: "circuit", name: "Circuit", rounds: 2,
      weeks: [{ rounds: 2 }], movements: [movement.movement, { ...movement.movement, id: id(11) }] }];
    expect(authoredProgramSchema.safeParse(input).success).toBe(false);
  });
});

describe("DC-K4 linked exercises", () => {
  it("accepts linkNext on movement parts and leaves old definitions unchanged", () => {
    const v2 = authoredProgramSchema.parse(definition("strength", [movement, { ...movement, id: id(20), movement: { ...movement.movement, id: id(21) } }]));
    const linked = structuredClone(v2); (linked.workouts[0]!.parts[0] as { linkNext?: true }).linkNext = true;
    expect(authoredProgramSchema.parse(linked).workouts[0]?.parts[0]).toMatchObject({ linkNext: true });
    expect(v2.workouts[0]?.parts[0]).not.toHaveProperty("linkNext");
  });
  it("rejects a link flag that is not true", () => {
    const v2 = authoredProgramSchema.parse(definition("strength", [movement]));
    (v2.workouts[0]!.parts[0] as { linkNext?: unknown }).linkNext = false;
    expect(authoredProgramSchema.safeParse(v2).success).toBe(false);
  });
});

