import {
  SWIM_COURSE_VERSION, SWIM_MODEL_VERSION, lengthsForNativeDistance, normalizePoolCourse,
  swimWorkoutEquipment, swimWorkoutLengths, swimWorkoutStrokes, validateSwimWorkout,
  type PoolCourse, type SwimCourseWorkout, type SwimResult, type SwimSection, type SwimWorkout, type SwimSetup,
} from "@hta/domain";

export interface CompiledSwimCourseWorkout {
  readonly workout: SwimWorkout;
  readonly distanceMetres: number;
  readonly reportedDistanceMetres: number | null;
  readonly sourceTotalDiffers: boolean;
}

export function editableSwimCourseWorkout(title: string, workout: SwimWorkout): SwimCourseWorkout {
  const course = workout.snapshot.course;
  if (course.unit !== "m" || workout.snapshot.versions.generator !== SWIM_COURSE_VERSION) {
    throw new Error("Only an imported metre workout can use this editor.");
  }
  return {
    title, sections: workout.sections.map((section) => ({
      kind: section.kind, label: section.label, rounds: section.rounds,
      items: section.items.map((item) => ({
        repeats: item.repeats, distanceMetres: item.lengths * course.numerator / course.denominator,
        stroke: item.stroke, effort: item.effort, equipment: [...item.equipment],
        ...(item.restSeconds === undefined ? {} : { restSeconds: item.restSeconds }),
        ...(item.sendoffMs === undefined ? {} : { sendoffSeconds: item.sendoffMs / 1000 }),
        ...(item.drill === undefined ? {} : { drill: item.drill }),
        ...(item.note === undefined ? {} : { note: item.note }),
      })),
    })),
  };
}

/** Retain supplied work exactly; never scale, trim, calibrate or infer progression. */
export function compileSwimCourseWorkout(
  source: SwimCourseWorkout, course: PoolCourse,
  available?: Pick<SwimSetup, "knownStrokes" | "equipment">,
): SwimResult<CompiledSwimCourseWorkout> {
  const parsed = normalizePoolCourse(course);
  if (!parsed.ok) return parsed;
  if (parsed.value.unit !== "m") {
    return { ok: false, error: { code: "setup_invalid", message: "Choose a metre pool for this course." } };
  }
  if (source.sections.length < 3 || source.sections.length > 20 ||
      source.sections.some((section) => section.items.length < 1 || section.items.length > 100)) {
    return { ok: false, error: { code: "setup_invalid", message: "Check the workout sections and repetitions." } };
  }
  const sections: SwimSection[] = [];
  for (const section of source.sections) {
    const items = [];
    for (const item of section.items) {
      if (!Number.isInteger(item.distanceMetres) || item.distanceMetres < 1 || item.distanceMetres > 100000 ||
          (item.restSeconds !== undefined && (!Number.isInteger(item.restSeconds) || item.restSeconds < 0 || item.restSeconds > 86400)) ||
          (item.sendoffSeconds !== undefined && (!Number.isInteger(item.sendoffSeconds) || item.sendoffSeconds < 1 || item.sendoffSeconds > 86400)) ||
          (item.restSeconds !== undefined && item.sendoffSeconds !== undefined)) {
        return { ok: false, error: { code: "setup_invalid", message: "Check the repeat distance, rest and send-off." } };
      }
      const lengths = lengthsForNativeDistance(item.distanceMetres, parsed.value);
      if (!lengths.ok) return lengths;
      items.push({
        repeats: item.repeats, lengths: lengths.value, stroke: item.stroke,
        effort: item.effort, equipment: item.equipment, optional: false,
        ...(item.restSeconds === undefined ? {} : { restSeconds: item.restSeconds }),
        ...(item.sendoffSeconds === undefined ? {} : { sendoffMs: item.sendoffSeconds * 1000 }),
        ...(item.drill === undefined ? {} : { drill: item.drill }),
        ...(item.note === undefined ? {} : { note: item.note }),
      });
    }
    sections.push({ kind: section.kind, label: section.label, rounds: section.rounds, items });
  }
  const initial: SwimWorkout = {
    kind: "swim_workout", focus: "endurance", sections, totalLengths: 0,
    snapshot: {
      course: parsed.value, strokes: [], equipment: [], calibration: null, protocol: null,
      versions: { model: SWIM_MODEL_VERSION, generator: SWIM_COURSE_VERSION, assessment: null },
    },
    estimatedMs: null, budget: { minutes: null, accountedMs: 0 },
  };
  const totalLengths = swimWorkoutLengths(initial);
  const accountedMs = swimCourseKnownDuration(initial);
  const workout: SwimWorkout = {
    ...initial, totalLengths,
    snapshot: { ...initial.snapshot, strokes: swimWorkoutStrokes(initial), equipment: swimWorkoutEquipment(initial) },
    budget: { minutes: null, accountedMs },
  };
  const issue = validateSwimWorkout(workout).find((entry) => entry.severity === "blocking");
  if (issue) return { ok: false, error: { code: "setup_invalid", message: issue.message } };
  if (available) {
    const strokes = workout.snapshot.strokes.flatMap((stroke) =>
      stroke === "individual_medley" ? ["freestyle", "backstroke", "breaststroke", "butterfly"] as const
        : stroke === "choice" || stroke === "kick" ? [] : [stroke]);
    if (strokes.some((stroke) => !available.knownStrokes.includes(stroke)) ||
        workout.snapshot.equipment.some((piece) => !available.equipment.includes(piece))) {
      return { ok: false, error: { code: "setup_invalid", message: "This workout uses strokes or equipment not selected in your setup." } };
    }
  }
  if (totalLengths > 2000) {
    return { ok: false, error: { code: "lengths_invalid", message: "This workout exceeds 2,000 pool lengths." } };
  }
  const distanceMetres = totalLengths * parsed.value.numerator / parsed.value.denominator;
  return {
    ok: true, value: {
      workout, distanceMetres, reportedDistanceMetres: source.reportedDistanceMetres ?? null,
      sourceTotalDiffers: source.reportedDistanceMetres !== undefined && source.reportedDistanceMetres !== distanceMetres,
    },
  };
}

/** Only explicit between-repeat time is known; no invented turnarounds or pace. */
export function swimCourseKnownDuration(workout: SwimWorkout): number {
  return workout.sections.reduce((total, section) => total + section.rounds * section.items.reduce(
    (subtotal, item) => subtotal + (item.sendoffMs ?? (item.restSeconds ?? 0) * 1000) * Math.max(0, item.repeats - 1),
    0,
  ), 0);
}
