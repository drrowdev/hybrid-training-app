import { z } from "zod";
import { MAX_SWIM_COURSE_BYTES, SWIM_COURSE_VERSION, type SwimCourse } from "@hta/domain";
import { SwimInputError } from "./input-error";

const text = z.string().trim().min(1);
const equipment = z.enum(["kickboard", "pull_buoy", "fins", "paddles", "snorkel"]);
const item = z.object({
  repeats: z.number().int().min(1).max(2000),
  distanceMetres: z.number().int().min(1).max(100000),
  stroke: z.enum(["freestyle", "backstroke", "breaststroke", "butterfly", "individual_medley", "choice", "kick"]),
  effort: z.enum(["easy", "steady", "brisk", "threshold", "sprint"]),
  equipment: z.array(equipment).max(5).refine((values) => new Set(values).size === values.length),
  restSeconds: z.number().int().min(0).max(86400).optional(),
  sendoffSeconds: z.number().int().min(1).max(86400).optional(),
  drill: text.max(500).optional(),
  note: text.max(1000).optional(),
}).strict().refine((value) => value.restSeconds === undefined || value.sendoffSeconds === undefined, {
  message: "Choose rest after a repeat or a fixed send-off, not both.",
});
export const swimCourseWorkoutSchema = z.object({
  title: text.max(100),
  sourcePage: z.number().int().min(1).max(10000).optional(),
  reportedDistanceMetres: z.number().int().min(1).max(100000).optional(),
  sections: z.array(z.object({
    kind: z.enum(["warmup", "preparation", "main", "recovery", "cooldown"]),
    label: text.max(100),
    rounds: z.number().int().min(1).max(2000),
    items: z.array(item).min(1).max(100),
  }).strict()).min(3).max(20),
}).strict();
export const swimCourseSchema = z.object({
  version: z.literal(SWIM_COURSE_VERSION),
  title: text.max(100),
  source: z.object({ reference: text.max(500), edition: text.max(100) }).strict(),
  weeks: z.array(z.object({
    workouts: z.array(swimCourseWorkoutSchema).min(1).max(7),
  }).strict()).min(2).max(16),
}).strict() satisfies z.ZodType<SwimCourse>;

export function parseSwimCourseFile(text: string): SwimCourse {
  if (new TextEncoder().encode(text).byteLength > MAX_SWIM_COURSE_BYTES) {
    throw new SwimInputError("Choose a plan file smaller than 256 KB.");
  }
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { throw new SwimInputError("This is not a valid plan file. Choose the prepared JSON file."); }
  const parsed = swimCourseSchema.safeParse(value);
  if (!parsed.success) throw new SwimInputError("This plan file has missing or unsupported fields.");
  return parsed.data;
}
