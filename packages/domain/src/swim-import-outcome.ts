export type SwimImportedOutcome = "completed" | "stopped_early";

/** A user's outcome claim does not turn imported measurements into a native result. */
export function swimOutcomeForRecording(input: {
  confirmation: { outcome: SwimImportedOutcome | null; matchId: string | null; workoutRevision: number | null } | null;
  matchId: string;
  matchedImportId: string;
  latestImportId: string;
  matchedWorkoutRevision: number;
  workoutRevision: number;
}) {
  const { confirmation } = input;
  const currentEvidence = input.matchedImportId === input.latestImportId &&
    input.matchedWorkoutRevision === input.workoutRevision;
  const otherMatch = confirmation?.outcome != null && confirmation.matchId !== input.matchId;
  const valid = confirmation?.outcome != null && !otherMatch && currentEvidence &&
    confirmation.workoutRevision === input.workoutRevision;
  return {
    outcome: valid ? confirmation.outcome : null,
    canConfirm: currentEvidence,
    otherMatch,
    needsReview: confirmation?.outcome != null && !otherMatch && !valid,
  };
}
