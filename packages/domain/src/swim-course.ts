import type { PoolCourse, SwimEquipment, SwimEffort, SwimSectionKind, SwimStroke } from "./swimming";

export const SWIM_COURSE_VERSION = "swim-course-1";
export const MAX_SWIM_COURSE_BYTES = 256 * 1024;

export interface SwimCourseItem {
  readonly repeats: number;
  readonly distanceMetres: number;
  readonly stroke: SwimStroke;
  readonly effort: SwimEffort;
  readonly equipment: readonly SwimEquipment[];
  readonly restSeconds?: number;
  readonly sendoffSeconds?: number;
  readonly drill?: string;
  readonly note?: string;
}

export interface SwimCourseSection {
  readonly kind: SwimSectionKind;
  readonly label: string;
  readonly rounds: number;
  readonly items: readonly SwimCourseItem[];
}

export interface SwimCourseWorkout {
  readonly title: string;
  readonly sourcePage?: number;
  readonly reportedDistanceMetres?: number;
  readonly sections: readonly SwimCourseSection[];
}

/** Private user-supplied prescriptions, not a catalogue or an adaptive model. */
export interface SwimCourse {
  readonly version: typeof SWIM_COURSE_VERSION;
  readonly title: string;
  readonly source: { readonly reference: string; readonly edition: string };
  readonly weeks: readonly { readonly workouts: readonly SwimCourseWorkout[] }[];
}

export interface SwimCourseWorkoutChoice {
  readonly weekIndex: number;
  readonly workoutIndex: number;
  readonly course: PoolCourse;
}

export function swimCourseWorkoutKey(weekIndex: number, workoutIndex: number): string {
  return `course-${weekIndex}-${workoutIndex}`;
}
