import { z } from "zod";
import { CONDITIONING_ACTIVITIES } from "@hta/domain";
import { parseSwimCourseFile, swimCoursePoolChoicesSchema } from "./course-file";
import { parseSetupForm } from "./forms";
import { planPrivateSwimCourse } from "./course-planning";

export const conditioningCourseSchema = z.object({
  kind: z.literal("course"),
  courseFile: z.string().min(1).max(262144),
  pool: z.enum(["50m", "25m", "custom"]),
  poolLength: z.string().max(64).optional(),
  experience: z.enum(["beginner", "returning", "regular", "trained"]),
  comfortableLengths: z.number().int().min(1).max(2000),
  strokes: z.array(z.enum(["freestyle", "backstroke", "breaststroke", "butterfly"])).min(1).max(4),
  equipment: z.array(z.enum(["kickboard", "pull_buoy", "fins", "paddles", "snorkel"])).max(5),
  poolChoices: swimCoursePoolChoicesSchema.default([]),
  reviewed: z.boolean(),
  acceptSetTotals: z.boolean().default(false),
}).strict();
export const programConditioningSchema = z.object({
  requestId: z.string().uuid(),
  choices: z.array(z.object({
    weekday: z.number().int().min(0).max(6),
    activity: z.enum(CONDITIONING_ACTIVITIES),
  }).strict()).max(7),
  swim: z.discriminatedUnion("kind", [
    conditioningCourseSchema,
    z.object({ kind: z.literal("existing"), planId: z.string().uuid(), revision: z.number().int().positive() }).strict(),
  ]).optional(),
}).strict().refine((value) =>
  value.choices.some((choice) => choice.activity === "swimming") === (value.swim !== undefined),
{ message: "Choose a swimming plan for the selected swim days." });

export type ProgramConditioningInput = z.input<typeof programConditioningSchema>;
export type ProgramConditioning = z.output<typeof programConditioningSchema>;

/** Both inline preview and final save use the existing course compiler. */
export function planConditioningCourse(
  input: z.output<typeof conditioningCourseSchema>, startDate: string, weekdays: readonly number[],
) {
  const source = parseSwimCourseFile(input.courseFile);
  const form = new FormData();
  form.set("pool", input.pool);
  if (input.poolLength !== undefined) form.set("poolLength", input.poolLength);
  form.set("poolUnit", "m");
  form.set("goal", "endurance");
  form.set("experience", input.experience);
  form.set("comfortableLengths", String(input.comfortableLengths));
  form.set("weeks", String(source.weeks.length));
  form.set("startDate", startDate);
  weekdays.forEach((day) => form.append("weekdays", String((day + 1) % 7)));
  input.strokes.forEach((stroke) => form.append("strokes", stroke));
  input.equipment.forEach((equipment) => form.append("equipment", equipment));
  const parsed = parseSetupForm(form, "course");
  return planPrivateSwimCourse({ source, ...parsed, poolChoices: input.poolChoices });
}
