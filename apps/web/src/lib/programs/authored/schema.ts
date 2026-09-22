import { z } from "zod";
import type { AuthoredProgramDefinition } from "@hta/domain";

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
export const authoredWorkoutSchema = z.object({
  id, name: z.string().trim().min(1).max(100), weekday: z.number().int().min(0).max(6),
  parts: z.array(z.discriminatedUnion("kind", [
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

export const authoredProgramSchema = z.object({
  version: z.literal(1), activity: z.enum(["strength", "running", "hybrid"]),
  name: z.string().trim().min(1).max(100),
  weeks: z.number().int().min(1).max(16),
  workouts: z.array(authoredWorkoutSchema).min(1).max(7),
}).strict().superRefine((definition, ctx) => {
  const ids: string[] = [];
  const days = new Set<number>();
  for (const workout of definition.workouts) {
    const itemCount = workout.parts.reduce((sum, part) => sum + (part.kind === "movement" ? part.movement.sets
      : part.kind === "circuit" ? part.movements.length * part.rounds : 1), 0);
    if (itemCount > 500) ctx.addIssue({ code: "custom", message: "Keep each workout to 500 sets and cardio parts or fewer." });
    ids.push(workout.id);
    if (days.has(workout.weekday)) ctx.addIssue({ code: "custom", message: "Choose a different day for each workout." });
    days.add(workout.weekday);
    for (const part of workout.parts) {
      ids.push(part.id);
      if (part.kind === "cardio") {
        const seconds = part.intervals.reduce((sum, interval) => sum + (interval.target.kind === "time" ? interval.target.seconds : 0), 0) * part.repeats;
        const metres = part.intervals.reduce((sum, interval) => sum + (interval.target.kind === "distance" ? interval.target.metres : 0), 0) * part.repeats;
        if (seconds > 36000 || metres > 1000000) ctx.addIssue({ code: "custom", message: "Reduce the duration, distance or repeats for this cardio part." });
        ids.push(...part.intervals.map((interval) => interval.id));
        if (definition.activity === "strength") ctx.addIssue({ code: "custom", message: "Choose Hybrid to include cardio in this program." });
        if (definition.activity === "running" && part.modality !== "run") ctx.addIssue({ code: "custom", message: "Choose Hybrid to include machine work." });
      } else {
        const movements = part.kind === "movement" ? [part.movement] : part.movements;
        ids.push(...movements.map((movement) => movement.id));
        if (part.kind === "circuit" && new Set(movements.map((movement) => movement.movementId)).size !== movements.length) {
          ctx.addIssue({ code: "custom", message: "Each circuit station needs a different exercise." });
        }
      }
    }
  }
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: "Workout and part identities must be unique." });
}) satisfies z.ZodType<AuthoredProgramDefinition>;

export const authoredSaveSchema = z.object({
  definition: authoredProgramSchema,
  startedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  editBlockId: id.optional(),
  workoutId: id.optional(),
  scope: z.enum(["program", "workout", "future"]).default("program"),
  plannedSessionId: id.optional(),
}).strict().superRefine((input, ctx) => {
  if (input.scope !== "program" && (!input.editBlockId || !input.workoutId || !input.plannedSessionId)) {
    ctx.addIssue({ code: "custom", message: "Choose the workout to edit." });
  }
  if (input.scope === "program" && (input.workoutId || input.plannedSessionId)) {
    ctx.addIssue({ code: "custom", message: "Choose whether to edit this workout or future matching workouts." });
  }
});
export type AuthoredSaveInput = z.input<typeof authoredSaveSchema>;
