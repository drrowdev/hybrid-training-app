import type { SwimPlanPreview } from "./view-types";
import type { SwimCourseWorkout, TrainingCommitment } from "@hta/domain";

export type SwimCourseEditInput = {
  planId: string; revision: number; workoutId: string; workoutRevision: number;
  workout: SwimCourseWorkout; reason: string;
};
export type SwimCourseEditPreview = { id: string; before: string; after: string; plan: SwimPlanPreview };

export type SwimCourseImportPreview = {
  replaces?: { id: string; revision: number; name: string };
  id: string;
  title: string;
  plan: SwimPlanPreview;
  totals: { key: string; week: number; workout: number; reported: number; calculated: number }[];
  strengthDays: string[];
  scheduleRevision?: string;
  overlaps?: TrainingCommitment[];
};
