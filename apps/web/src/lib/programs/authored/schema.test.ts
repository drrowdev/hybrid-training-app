import { describe, expect, it } from "vitest";
import type { AuthoredProgramDefinition, AuthoredWorkoutPart } from "@hta/domain";
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
});
