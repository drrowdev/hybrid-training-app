import { compileAuthoredWorkout, type AuthoredMovement, type AuthoredProgramDefinitionV2 } from "@hta/domain";
import type { Prescription } from "@hta/db";
import { prepareAuthoredWarmups } from "@/lib/planner/authored-warmups";

export const authoredCatalog = [
  { id: "11000000-0000-4000-8000-000000000001", slug: "bench-press-flat", displayName: "Bench Press", pattern: "press", equipment: "barbell", oneRmKg: 100 },
  { id: "11000000-0000-4000-8000-000000000002", slug: "weighted-pull-up", displayName: "Weighted Pull-up", pattern: "pull", equipment: "bodyweight", oneRmKg: 132 },
  { id: "11000000-0000-4000-8000-000000000003", slug: "romanian-deadlift", displayName: "Romanian Deadlift", pattern: "hinge", equipment: "barbell", oneRmKg: 150 },
  { id: "11000000-0000-4000-8000-000000000004", slug: "seated-cable-row", displayName: "Cable Row", pattern: "pull", equipment: "cable", oneRmKg: null },
  { id: "11000000-0000-4000-8000-000000000005", slug: "band-external-rotation", displayName: "Band External Rotation", pattern: "pull", equipment: "band", oneRmKg: null },
  { id: "11000000-0000-4000-8000-000000000006", slug: "run-easy-z2", displayName: "Running", pattern: "cardio", modality: "run", equipment: null, oneRmKg: null },
];
const move = (index: number, role: AuthoredMovement["role"] = "main"): AuthoredMovement => ({
  id: `move-${index}`, movementId: authoredCatalog[index]!.id, role, sets: "2",
  dose: { kind: "reps", reps: "5" }, restSeconds: 90, notes: "",
  load: { kind: "kg", value: index === 4 ? 0 : 25 },
});
const cardio = { id: "cardio", kind: "cardio" as const, movementId: authoredCatalog[5]!.id,
  modality: "run" as const, intensity: "z2" as const, repeats: 1, duration: "5", notes: "", intervals: [] };

export const authoredFixture: AuthoredProgramDefinitionV2 = {
  version: 2, name: "Hybrid week", activity: "hybrid",
  weeks: [
    { type: "Build", sets: "2", reps: "5", pct: 90 },
    { type: "Deload", sets: "1", reps: "5", pct: 70, fewer: true },
  ],
  workouts: [
    { id: "upper", name: "Upper + conditioning", weekday: 0, parts: [
      { id: "bench", kind: "movement", movement: move(0) },
      { id: "pull", kind: "movement", movement: move(1) },
      { id: "row", kind: "movement", movement: { ...move(3, "accessory"), sets: "1–2" } },
      { id: "rehab", kind: "movement", movement: { ...move(4, "tendon"), sets: "1" } },
      cardio,
      { id: "pairs", kind: "circuit", name: "Run + station", rounds: 4,
        runMovementId: authoredCatalog[5]!.id, weeks: [{ rounds: 4, runMetres: 200 }, { rounds: 2, runMetres: 100 }],
        movements: [move(3, "accessory")] },
    ] },
    { id: "easy", name: "Easy run", weekday: 1, parts: [cardio] },
    { id: "lower", name: "Hinge + accessories", weekday: 2, parts: [
      { id: "hinge", kind: "movement", movement: move(2) },
      { id: "circuit", kind: "circuit", name: "Accessories", rounds: 2, movements: [move(3, "accessory"), move(4, "tendon")] },
    ] },
    { id: "tempo", name: "Steady run", weekday: 3, parts: [cardio] },
    { id: "full", name: "Full body", weekday: 4, parts: [
      { id: "bench", kind: "movement", movement: move(0) }, { id: "hinge", kind: "movement", movement: move(2) },
    ] },
    { id: "long", name: "Long run", weekday: 5, parts: [{ ...cardio, duration: "40" }] },
  ],
};

export function authoredFixturePrescription(day = 0, week = 0): Prescription {
  const compiled = compileAuthoredWorkout(authoredFixture.workouts[day]!, authoredCatalog, undefined, authoredFixture.weeks[week], week);
  return prepareAuthoredWarmups(compiled, authoredCatalog.map((movement) => ({
    ...movement, tmKg: movement.oneRmKg == null ? null : movement.oneRmKg * 0.9,
    loadOptions: { barWeightKg: movement.equipment === "barbell" ? 20 : undefined, availablePlateWeightsKg: [1.25] },
  })), null, 87);
}
