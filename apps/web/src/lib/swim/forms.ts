import { z } from "zod";
import {
  parsePoolCourse, lengthsForNativeDistance, estimateCriticalSwimSpeed,
  SWIM_ASSESSMENT_VERSION, validateSwimSetup,
  type PoolCourse, type SwimObservation, type SwimSetup,
} from "@hta/domain";
import { parseSwimTime } from "./time";
import { SwimInputError } from "./input-error";

const stroke = z.enum(["freestyle", "backstroke", "breaststroke", "butterfly"]);
const equipment = z.enum(["kickboard", "pull_buoy", "fins", "paddles", "snorkel"]);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(
  (value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Choose a valid date.",
);

export function parseBenchmarkForm(form: FormData, course: PoolCourse): SwimObservation | null {
  const time200 = String(form.get("time200") ?? "").trim();
  const time400 = String(form.get("time400") ?? "").trim();
  if (!time200 && !time400) return null;
  if (form.get("verified") !== "on") throw new SwimInputError("Verify both times under the same conditions.");
  const lengths200 = lengthsForNativeDistance(200, course);
  const lengths400 = lengthsForNativeDistance(400, course);
  if (!lengths200.ok || !lengths400.ok) throw new SwimInputError("This pool cannot support exact 200 and 400 distance trials.");
  const observation: SwimObservation = {
    protocol: "css_200_400", course, verified: true,
    stroke: stroke.parse(form.get("benchmarkStroke")), equipment: [],
    observedOn: date.parse(form.get("benchmarkDate")),
    version: SWIM_ASSESSMENT_VERSION,
    trials: [
      { distance: 200, lengths: lengths200.value, timeMs: parseSwimTime(time200) },
      { distance: 400, lengths: lengths400.value, timeMs: parseSwimTime(time400) },
    ],
  };
  const calibration = estimateCriticalSwimSpeed(observation);
  if (!calibration.ok) throw new SwimInputError(calibration.error.message);
  return observation;
}

export function parseSetupForm(form: FormData) {
  const pool = z.enum(["25m", "50m", "25yd", "custom"]).parse(form.get("pool"));
  const course = parsePoolCourse({
    lengthNumerator: pool === "custom" ? Number(form.get("poolNumerator")) : pool === "50m" ? 50 : 25,
    lengthDenominator: pool === "custom" ? Number(form.get("poolDenominator")) : 1,
    unit: pool === "custom" ? z.enum(["m", "yd"]).parse(form.get("poolUnit")) : pool === "25yd" ? "yd" : "m",
  });
  if (!course.ok) throw new SwimInputError(course.error.message);
  const goal = z.enum(["technique", "base", "endurance"]).parse(form.get("goal"));
  const experience = z.enum(["beginner", "returning", "regular", "trained"]).parse(form.get("experience"));
  const weekdays = z.array(z.coerce.number().int().min(0).max(6)).min(1).max(7).parse(form.getAll("weekdays"));
  if (new Set(weekdays).size !== weekdays.length) throw new SwimInputError("Choose each swim day once.");
  const startDate = date.parse(form.get("startDate"));
  const weeks = z.coerce.number().int().min(2).max(16).parse(form.get("weeks"));
  const observation = parseBenchmarkForm(form, course.value);
  const eventDate = String(form.get("eventDate") ?? "");
  const eventNumerator = String(form.get("eventNumerator") ?? "");
  const event = eventDate || eventNumerator ? {
    dateISO: date.parse(eventDate),
    distance: z.coerce.number().positive().max(1000000).parse(eventNumerator) /
      z.coerce.number().positive().max(1000000).parse(form.get("eventDenominator")),
    unit: z.enum(["m", "yd"]).parse(form.get("eventUnit")),
  } : undefined;
  const setup: SwimSetup = {
    goal: goal === "endurance" ? "endurance" : "technique_base",
    experience: experience === "beginner" ? "learning" : experience === "regular" ? "recreational" : experience,
    course: course.value,
    knownStrokes: z.array(stroke).parse(form.getAll("strokes")),
    equipment: z.array(equipment).parse(form.getAll("equipment")),
    recentComfortableLengths: z.coerce.number().int().min(0).max(2000).parse(form.get("comfortableLengths")),
    sessionBudgetMinutes: z.coerce.number().int().min(10).max(240).parse(form.get("timeBudgetMinutes")),
    ...(event ? { event } : {}),
    ...(observation ? { benchmarks: [observation] } : {}),
  };
  const issue = validateSwimSetup(setup).find((item) => item.severity === "blocking");
  if (issue) throw new SwimInputError(issue.message);
  return { setup, startDate, weeks, weekdays, observation };
}

export const actualFormSchema = z.object({
  workoutId: z.string().uuid(),
  sessionId: z.string().uuid(),
  expectedRevision: z.coerce.number().int().positive(),
  lengths: z.coerce.number().int().min(1).max(2000),
  timeMs: z.coerce.number().int().min(1).max(86_400_000),
  rpe: z.preprocess((value) => value === "" || value == null ? null : Number(value), z.number().min(0).max(10).multipleOf(0.1).nullable()),
  notes: z.string().max(2000).default(""),
  reason: z.string().max(1000).default(""),
  stroke: z.enum(["planned", "freestyle", "backstroke", "breaststroke", "butterfly", "individual_medley", "choice", "kick"]),
  equipment: z.string().default("[]"),
  pool: z.enum(["planned", "25m", "50m", "25yd", "custom"]).default("planned"),
  poolNumerator: z.string().default(""),
  poolDenominator: z.string().default(""),
  poolUnit: z.string().default(""),
  confirmPool: z.string().default(""),
  splits: z.string().max(10000).default(""),
  clientLogId: z.string().uuid().optional(),
});

export function parseActualForm(form: FormData) {
  const fields = actualFormSchema.parse(Object.fromEntries(form.entries()));
  const pieces = z.array(equipment).max(5).parse(JSON.parse(fields.equipment));
  let course: PoolCourse | null = null;
  if (fields.pool !== "planned") {
    if (fields.confirmPool !== "on") throw new SwimInputError("Confirm the pool used for this result.");
    const parsed = parsePoolCourse({
      lengthNumerator: fields.pool === "custom" ? Number(fields.poolNumerator) : fields.pool === "50m" ? 50 : 25,
      lengthDenominator: fields.pool === "custom" ? Number(fields.poolDenominator) : 1,
      unit: fields.pool === "custom" ? z.enum(["m", "yd"]).parse(fields.poolUnit) : fields.pool === "25yd" ? "yd" : "m",
    });
    if (!parsed.ok) throw new SwimInputError(parsed.error.message);
    course = parsed.value;
  }

  const splits = fields.splits.trim() ? fields.splits.trim().split(/\r?\n/).map((line) => {
    const [lengths, time, extra] = line.split(",").map((value) => value.trim());
    if (extra !== undefined || !lengths || !time) throw new SwimInputError("Enter each split as lengths, minutes:seconds.");
    return { lengths: z.coerce.number().int().min(1).max(2000).parse(lengths), timeMs: parseSwimTime(time) };
  }) : [];
  if (splits.reduce((sum, split) => sum + split.lengths, 0) > fields.lengths) throw new SwimInputError("Split lengths exceed your total.");
  if (splits.reduce((sum, split) => sum + split.timeMs, 0) > fields.timeMs) throw new SwimInputError("Split times exceed your total.");
  return { ...fields, equipment: pieces, splits, course, notesSupplied: form.has("notes") };
}

export function parseSwimDate(value: unknown): string {
  return date.parse(value);
}

export function parseSwimObservation(value: unknown): SwimObservation {
  const observation = z.object({
    protocol: z.literal("css_200_400"),
    course: z.object({ numerator: z.number().int().positive(), denominator: z.number().int().positive(), unit: z.enum(["m", "yd"]) }),
    stroke,
    equipment: z.array(equipment).max(0),
    observedOn: date,
    version: z.literal(SWIM_ASSESSMENT_VERSION),
    verified: z.literal(true),
    trials: z.array(z.object({ distance: z.number().int(), lengths: z.number().int().positive(), timeMs: z.number().int().positive() })).length(2),
  }).parse(value);
  const course = parsePoolCourse({ lengthNumerator: observation.course.numerator, lengthDenominator: observation.course.denominator, unit: observation.course.unit });
  if (!course.ok) throw new SwimInputError(course.error.message);
  const parsed = { ...observation, course: course.value };
  const calibration = estimateCriticalSwimSpeed(parsed);
  if (!calibration.ok) throw new SwimInputError(calibration.error.message);
  return parsed;
}
