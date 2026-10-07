import { z } from "zod";
import type { AuthoredProgramDefinition } from "@hta/domain";
import { authoredRange, effectiveAuthoredMovement, programKindAllowsActivity, upgradeAuthoredProgram } from "@hta/domain";

const id = z.string().uuid();
const dose = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("reps"), reps: z.number().int().min(1).max(500) }).strict(),
  z.object({ kind: z.literal("hold"), seconds: z.number().int().min(1).max(3600) }).strict(),
  z.object({ kind: z.literal("distance"), metres: z.number().positive().max(10000) }).strict(),
]);
export const authoredMovementSchema = z.object({
  id, movementId: id, role: z.enum(["main", "accessory", "tendon"]),
  sets: z.number().int().min(1).max(20), dose,
  weightKg: z.number().min(0).max(1000).optional(),
  restSeconds: z.number().int().min(0).max(1800),
  notes: z.string().trim().max(500),
}).strict();
const authoredWorkoutV1Schema = z.object({
  id, name: z.string().trim().min(1).max(100), weekday: z.number().int().min(0).max(6),
  parts: z.array(z.discriminatedUnion("kind", [
    z.object({ id, kind: z.literal("rehab"), protocolId: id }).strict(),
    z.object({ id, kind: z.literal("movement"), movement: authoredMovementSchema }).strict(),
    z.object({
      id, kind: z.literal("circuit"), name: z.string().trim().min(1).max(100),
      rounds: z.number().int().min(1).max(20),
      movements: z.array(authoredMovementSchema).min(2).max(12),
    }).strict(),
    z.object({
      id, kind: z.literal("cardio"), movementId: id, modality: z.enum(["run", "bike", "row", "ski"]),
      intensity: z.enum(["z2", "threshold", "vo2", "alactic"]),
      repeats: z.number().int().min(1).max(50), notes: z.string().trim().max(500),
      intervals: z.array(z.object({
        id, label: z.string().trim().min(1).max(60), effort: z.enum(["easy", "steady", "hard", "recovery"]),
        target: z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("time"), seconds: z.number().int().min(1).max(21600) }).strict(),
          z.object({ kind: z.literal("distance"), metres: z.number().positive().max(100000) }).strict(),
        ]),
      }).strict()).min(1).max(20),
    }).strict(),
  ])).min(1).max(30),
}).strict();

const range = (max: number, min = 1) => z.union([z.string().trim().max(40), z.number()]).superRefine((value, ctx) => {
  try {
    const parsed = authoredRange(value, max);
    if (parsed.min < min || !Number.isInteger(parsed.min) || !Number.isInteger(parsed.max)) {
      ctx.addIssue({ code: "custom", fatal: true, message: `Enter whole numbers between ${min} and ${max}.` });
    }
  } catch (error) {
    ctx.addIssue({ code: "custom", fatal: true, message: error instanceof Error ? error.message : "Enter a valid range." });
  }
});
const loadSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pct"), value: z.number().positive().max(100) }).strict(),
  z.object({ kind: z.literal("kg"), value: z.number().min(0).max(1000) }).strict(),
  z.object({ kind: z.literal("rir"), value: range(10, 0) }).strict(),
]);
const overrideSchema = z.object({
  sets: range(20).transform(String).optional(), reps: range(500).transform(String).optional(),
  load: loadSchema.nullable().optional(),
}).strict();
export const authoredMovementV2Schema = authoredMovementSchema.omit({ weightKg: true }).extend({
  sets: range(20),
  dose: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("reps"), reps: range(500) }).strict(),
    dose.options[1], dose.options[2],
  ]),
  load: loadSchema.nullable().optional(),
  overrides: z.record(z.string().regex(/^(?:[0-9]|1[0-5])$/), overrideSchema).optional(),
}).strict();
const legacyParts = authoredWorkoutV1Schema.shape.parts.element.options;
const authoredWorkoutV2Schema = authoredWorkoutV1Schema.extend({
  parts: z.array(z.discriminatedUnion("kind", [
    legacyParts[0],
    z.object({ id, kind: z.literal("movement"), movement: authoredMovementV2Schema }).strict(),
    z.object({
      id, kind: z.literal("circuit"), name: z.string().trim().min(1).max(100),
      rounds: z.number().int().min(1).max(20),
      weeks: z.array(z.object({
        rounds: z.number().int().min(1).max(20), runMetres: z.number().positive().max(10000).optional(),
      }).strict()).min(1).max(16),
      runMovementId: id.optional(),
      movements: z.array(authoredMovementV2Schema).min(2).max(12),
    }).strict(),
    legacyParts[3].extend({
      duration: range(600).transform(String).optional(),
      effort: z.string().trim().max(100).optional(),
    }).strict(),
  ])).min(1).max(30),
}).strict();
export const authoredWorkoutSchema = z.union([authoredWorkoutV2Schema, authoredWorkoutV1Schema]);
const authoredProgramV1Schema = z.object({
  version: z.literal(1), activity: z.enum(["strength", "running", "hybrid"]),
  name: z.string().trim().min(1).max(100),
  weeks: z.number().int().min(1).max(16),
  workouts: z.array(authoredWorkoutV1Schema).min(1).max(7),
}).strict();
const authoredProgramV2Schema = authoredProgramV1Schema.extend({
  version: z.literal(2),
  weeks: z.array(z.object({
    type: z.enum(["Build", "Deload", "Test"]), sets: range(20).transform(String), reps: range(500).transform(String),
    pct: z.number().positive().max(100), fewer: z.boolean().optional(),
    after: z.enum(["updateFromLoggedSet", "fixedIncrease", "keep"]).optional(),
    stepKg: z.number().positive().max(50).optional(),
  }).strict()).min(1).max(16),
  workouts: z.array(authoredWorkoutV2Schema).min(1).max(7),
}).strict();
export const authoredProgramSchema = z.union([authoredProgramV1Schema, authoredProgramV2Schema]).superRefine((definition, ctx) => {
  const ids: string[] = [];
  const days = new Set<number>();
  for (const workout of definition.workouts) {
    const itemCount = workout.parts.reduce((sum, part) => sum + (part.kind === "movement" ? authoredRange(part.movement.sets, 20).max
      : part.kind === "circuit" ? part.movements.length * part.rounds : 1), 0);
    if (itemCount > 500) ctx.addIssue({ code: "custom", message: "Keep each workout to 500 sets and cardio parts or fewer." });
    ids.push(workout.id);
    if (days.has(workout.weekday)) ctx.addIssue({ code: "custom", message: "Choose a different day for each workout." });
    days.add(workout.weekday);
    for (const part of workout.parts) {
      ids.push(part.id);
      if (part.kind === "rehab") continue;
      if (part.kind === "cardio") {
        const seconds = part.intervals.reduce((sum, interval) => sum + (interval.target.kind === "time" ? interval.target.seconds : 0), 0) * part.repeats;
        const metres = part.intervals.reduce((sum, interval) => sum + (interval.target.kind === "distance" ? interval.target.metres : 0), 0) * part.repeats;
        if (seconds > 36000 || metres > 1000000) ctx.addIssue({ code: "custom", message: "Reduce the duration, distance or repeats for this cardio part." });
        ids.push(...part.intervals.map((interval) => interval.id));
        if (definition.activity === "strength") ctx.addIssue({ code: "custom", message: "Choose Hybrid to include cardio in this program." });
        if (definition.activity === "running" && part.modality !== "run") ctx.addIssue({ code: "custom", message: "Choose Hybrid to include machine work." });
      } else {
        if (!programKindAllowsActivity(definition.activity, "strength")) {
          ctx.addIssue({ code: "custom", message: "Choose Hybrid to add strength exercises or circuits. Add rehab from your protocol library." });
        }
        const movements = part.kind === "movement" ? [part.movement] : part.movements;
        ids.push(...movements.map((movement) => movement.id));
        if (part.kind === "circuit" && new Set(movements.map((movement) => movement.movementId)).size !== movements.length) {
          ctx.addIssue({ code: "custom", message: "Each circuit station needs a different exercise." });
        }
      }
      if (definition.version === 2) {
        for (const [index, week] of definition.weeks.entries()) {
          const count = workout.parts.reduce((sum, part) => {
            if (part.kind === "movement") return sum + authoredRange(effectiveAuthoredMovement(part.movement, week, index).sets, 20).max;
            if (part.kind !== "circuit") return sum + 1;
            const plan = "weeks" in part ? part.weeks[index] : undefined;
            return sum + (plan?.rounds ?? part.rounds) * (plan?.runMetres ? 2 : part.movements.length);
          }, 0);
          if (count > 500) ctx.addIssue({ code: "custom", message: "Keep each workout to 500 sets and cardio parts or fewer." });
        }
        for (const part of workout.parts) {
          if (part.kind === "circuit" && "weeks" in part) {
            if (part.weeks.length !== definition.weeks.length) ctx.addIssue({ code: "custom", message: "Set the circuit rounds for every week." });
            if (part.weeks.some((week) => week.runMetres !== undefined) && !part.runMovementId) {
              ctx.addIssue({ code: "custom", message: "Choose a running exercise for this circuit." });
            }
            if (definition.activity === "strength" && part.weeks.some((week) => week.runMetres !== undefined)) {
              ctx.addIssue({ code: "custom", message: "Choose Hybrid to include cardio in this program." });
            }
          }
          const movements = part.kind === "movement" ? [part.movement] : part.kind === "circuit" ? part.movements : [];
          for (const movement of movements) {
            if ("overrides" in movement && Object.keys(movement.overrides ?? {}).some((key) => Number(key) >= definition.weeks.length)) {
              ctx.addIssue({ code: "custom", message: "Remove changes for weeks outside this program." });
            }
          }
        }
      }
    }
  }
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: "Workout and part identities must be unique." });
}).transform((definition: AuthoredProgramDefinition) => upgradeAuthoredProgram(definition));

export const authoredSaveSchema = z.object({
  definition: authoredProgramSchema,
  startedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  editBlockId: id.optional(),
  editRevision: z.string().regex(/^[a-f0-9]{32}$/).optional(),
  workoutId: id.optional(),
  scope: z.enum(["program", "workout", "future"]).default("program"),
  plannedSessionId: id.optional(),
}).strict().superRefine((input, ctx) => {
  if (input.editBlockId && !input.editRevision) {
    ctx.addIssue({ code: "custom", message: "Reload this program before editing." });
  }
  if (input.scope !== "program" && (!input.editBlockId || !input.workoutId || !input.plannedSessionId)) {
    ctx.addIssue({ code: "custom", message: "Choose the workout to edit." });
  }
  if (input.scope === "program" && (input.workoutId || input.plannedSessionId)) {
    ctx.addIssue({ code: "custom", message: "Choose whether to edit this workout or future matching workouts." });
  }
});
export type AuthoredSaveInput = Omit<z.input<typeof authoredSaveSchema>, "definition"> & { definition: AuthoredProgramDefinition };
