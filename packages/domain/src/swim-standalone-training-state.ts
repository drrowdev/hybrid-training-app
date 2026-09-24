import { swimOutcomeForRecording } from "./swim-import-outcome";

export type StandaloneSwimTrainingStatus = "scheduled" | "started" | "completed" | "stopped_early" |
  "skipped" | "paused" | "archived" | "unavailable" | "needs_review";

type RecordingEvidence = Parameters<typeof swimOutcomeForRecording>[0];
export type StandaloneSwimEvidence = Omit<RecordingEvidence,
  "matchId" | "matchedImportId" | "latestImportId" | "matchedWorkoutRevision"> & {
  matchId: string | null;
  matchedImportId: string | null;
  latestImportId: string | null;
  matchedWorkoutRevision: number | null;
};

export type StandaloneSwimTrainingInput = {
  planStatus: "active" | "paused" | "finished" | "archived";
  workoutStatus: "scheduled" | "started" | "completed" | "skipped";
  nativeSessionId: string | null;
  nativeCompletedAt: string | null;
  nativeVisible: boolean;
  evidence: StandaloneSwimEvidence | null;
};

/** Presentation and next-workout eligibility, never native measurements or training response. */
export function standaloneSwimTrainingState(input: StandaloneSwimTrainingInput): {
  status: StandaloneSwimTrainingStatus; completed: boolean; settled: boolean; actionable: boolean;
} {
  const evidence = input.evidence;
  const outcome = evidence && evidence.matchId !== null && evidence.matchedImportId !== null &&
    evidence.latestImportId !== null && evidence.matchedWorkoutRevision !== null
    ? swimOutcomeForRecording({ ...evidence, matchId: evidence.matchId, matchedImportId: evidence.matchedImportId,
      latestImportId: evidence.latestImportId, matchedWorkoutRevision: evidence.matchedWorkoutRevision })
    : null;
  let status: StandaloneSwimTrainingStatus;
  if (input.nativeSessionId) {
    status = !input.nativeVisible ? "unavailable" : input.nativeCompletedAt ? "completed" : "started";
  } else if (input.workoutStatus === "started" || input.workoutStatus === "completed") {
    status = "unavailable";
  } else if (outcome?.outcome) {
    status = outcome.outcome;
  } else if (evidence?.confirmation?.outcome != null && (!outcome || outcome.needsReview || outcome.otherMatch)) {
    status = "needs_review";
  } else if (input.workoutStatus === "skipped") {
    status = "skipped";
  } else if (input.planStatus === "paused") {
    status = "paused";
  } else if (input.planStatus === "finished" || input.planStatus === "archived") {
    status = "archived";
  } else {
    status = "scheduled";
  }
  return {
    status,
    completed: status === "completed",
    settled: status === "completed" || status === "stopped_early" || status === "skipped",
    actionable: input.planStatus === "active" &&
      (status === "scheduled" || status === "started" || status === "needs_review"),
  };
}

export function nextStandaloneSwimWorkout<T extends {
  id: string; date: string; state: ReturnType<typeof standaloneSwimTrainingState>;
}>(workouts: readonly T[], today: string): T | undefined {
  return workouts.filter(({ date, state }) => state.actionable &&
    (state.status === "started" || (state.status === "scheduled" && date >= today)))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))[0];
}
