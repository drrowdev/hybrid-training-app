import { swimOutcomeForRecording } from "./swim-import-outcome";

export type SwimTrainingStatus = "scheduled" | "started" | "completed" | "stopped_early" |
  "skipped" | "paused" | "archived" | "unavailable" | "needs_review";

export function swimTrainingState(input: {
  planStatus: string;
  parentActive: boolean;
  parentExists: boolean;
  workoutStatus: string;
  nativeSessionId: string | null;
  nativeCompletedAt: string | null;
  nativeVisible: boolean;
  evidence: Parameters<typeof swimOutcomeForRecording>[0] | null;
}): { status: SwimTrainingStatus; completed: boolean; settled: boolean; actionable: boolean } {
  const outcome = input.evidence ? swimOutcomeForRecording(input.evidence) : null;
  let status: SwimTrainingStatus;
  if (input.nativeSessionId && !input.nativeVisible) status = "unavailable";
  else if (input.nativeCompletedAt) status = "completed";
  else if (outcome?.outcome) status = outcome.outcome;
  else if (outcome?.needsReview || outcome?.otherMatch) status = "needs_review";
  else if (input.workoutStatus === "skipped") status = "skipped";
  else if (!input.parentExists) status = "unavailable";
  else if (input.planStatus === "paused") status = "paused";
  else if (!input.parentActive || input.planStatus === "archived" || input.planStatus === "finished") status = "archived";
  else if (input.nativeSessionId) status = "started";
  else if (input.workoutStatus === "completed") status = "unavailable";
  else status = "scheduled";
  return {
    status,
    completed: status === "completed",
    settled: status === "completed" || status === "stopped_early" || status === "skipped",
    actionable: input.parentActive && input.planStatus === "active" &&
      (status === "scheduled" || status === "started" || status === "needs_review"),
  };
}
