/** Imported observations are not native results, completed prescriptions or assessments. */
export interface SwimImportEvidence {
  readonly version: 1;
  readonly source: "local_dashboard";
  readonly activityId: string;
  readonly date: string;
  readonly environment: "pool" | "open_water";
  readonly workoutReference: string | null;
  readonly distanceMetres: number;
  readonly recordedDurationMs: number;
  readonly durationKind: "unspecified";
  readonly nativeCourse: null;
  readonly detail: {
    readonly status: "missing" | "partial" | "available" | "unverified";
    readonly fetchedAt: string | null;
    readonly splits: readonly {
      readonly distanceMetres: number | null;
      readonly elapsedMs: number | null;
      readonly reportedActiveMs: number | null;
      readonly activeTimeVerified: false;
      readonly reportedPauseMs: number | null;
      readonly stroke: "freestyle" | "backstroke" | "breaststroke" | "butterfly" | "mixed" | "drill" | null;
      readonly strokeKnown: boolean;
      readonly activeLengths: number | null;
      readonly workoutStep: number | null;
    }[];
  };
}
