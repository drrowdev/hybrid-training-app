import {
  SWIM_COURSE_VERSION, formatPoolCourse, formatExactDistance, swimCourseWorkoutKey, swimCourseWorkoutTitle,
  type SwimCourse, type SwimCourseWorkoutChoice, type SwimSetup,
} from "@hta/domain";
import { compileSwimCourseWorkout } from "@hta/engine";
import { standaloneWeekRequests, type StandalonePlanDefinition, type StandaloneWorkoutDefinition } from "./model";
import { SwimInputError } from "./input-error";
import { workoutPresentation } from "./presentation";
import type { SwimPlanPreview } from "./view-types";

export function planPrivateSwimCourse(input: {
  source: SwimCourse; setup: SwimSetup<null>; startDate: string; weekdays: number[];
  poolChoices: readonly SwimCourseWorkoutChoice[];
}) {
  const { source, setup, startDate, weekdays, poolChoices } = input;
  const daysNeeded = Math.max(...source.weeks.map((week) => week.workouts.length));
  if (weekdays.length !== daysNeeded) {
    throw new SwimInputError(`Choose ${daysNeeded} swim days for this plan.`);
  }
  const requested = standaloneWeekRequests(startDate, source.weeks.length, weekdays);
  const choices = new Map<string, SwimCourseWorkoutChoice>();
  for (const choice of poolChoices) {
    const key = swimCourseWorkoutKey(choice.weekIndex, choice.workoutIndex);
    if (!source.weeks[choice.weekIndex]?.workouts[choice.workoutIndex] || choices.has(key)) {
      throw new SwimInputError("Review the pool choices again.");
    }
    choices.set(key, choice);
  }
  const totals: { key: string; week: number; workout: number; reported: number; calculated: number }[] = [];
  const preview: SwimPlanPreview = {
    course: formatPoolCourse(setup.course),
    workoutCount: source.weeks.reduce((sum, week) => sum + week.workouts.length, 0),
    weeks: [],
  };
  const workouts = source.weeks.flatMap((week, weekIndex) => {
    const scheduled = requested[weekIndex]!;
    const weekPreview: SwimPlanPreview["weeks"][number] = {
      week: weekIndex + 1, startDate: scheduled.startDateISO, provisional: false, total: "", workouts: [],
    };
    let metres = 0;
    const rows = week.workouts.map((workout, workoutIndex) => {
      const key = swimCourseWorkoutKey(weekIndex, workoutIndex);
      const choice = choices.get(key);
      const course = choice?.course ?? setup.course;
      const compiled = compileSwimCourseWorkout(workout, course, setup);
      if (!compiled.ok) {
        throw new SwimInputError(`Week ${weekIndex + 1}, swim ${workoutIndex + 1}: ${compiled.error.message}`);
      }
      const issued = compiled.value.workout;
      const slot = scheduled.slots[workoutIndex];
      if (!slot) throw new SwimInputError("The plan needs more swim days.");
      if (compiled.value.sourceTotalDiffers && compiled.value.reportedDistanceMetres !== null) {
        totals.push({
          key, week: weekIndex + 1, workout: workoutIndex + 1,
          reported: compiled.value.reportedDistanceMetres, calculated: compiled.value.distanceMetres,
        });
      }
      const definition: StandaloneWorkoutDefinition = {
        version: 1, original: issued, issued, modifications: [], courseSource: workout,
        ...(choice ? { poolCourse: issued.snapshot.course } : {}),
        weekIndex, slotId: key, intent: "moderate", provisional: false,
      };
      weekPreview.workouts.push({
        ...workoutPresentation(issued), title: swimCourseWorkoutTitle(workout.title, key), slotId: key,
        date: slot.dateISO, course: formatPoolCourse(course),
      });
      metres += compiled.value.distanceMetres;
      return { scheduled_date: slot.dateISO, slot: "single" as const, definition };
    });
    weekPreview.total = formatExactDistance({ numerator: metres, denominator: 1, unit: "m" });
    preview.weeks.push(weekPreview);
    return rows;
  });
  const definition: StandalonePlanDefinition = {
    version: 1, setup, generatorVersion: SWIM_COURSE_VERSION,
    privateCourse: { version: source.version, title: source.title, source: source.source },
    schedule: { startDate, weeks: source.weeks.length, weekdays },
  };
  return { definition, workouts, totals, preview };
}
