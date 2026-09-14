import { describe, expect, it } from "vitest";
import { swimOutcomeForRecording } from "./swim-import-outcome";

const input = {
  confirmation: { outcome: "completed" as const, matchId: "match", workoutRevision: 3 },
  matchId: "match", matchedImportId: "recording", latestImportId: "recording",
  matchedWorkoutRevision: 3, workoutRevision: 3,
};

describe("DC-SW4/SW5/SW8 confirmed imported outcome", () => {
  it("never turns matching alone into completion", () => {
    expect(swimOutcomeForRecording({ ...input, confirmation: null })).toEqual({
      outcome: null, canConfirm: true, otherMatch: false, needsReview: false,
    });
    expect(swimOutcomeForRecording({ ...input, confirmation: {
      outcome: null, matchId: null, workoutRevision: null,
    } }).outcome).toBeNull();
  });
  it("keeps explicit complete and partial claims distinct", () => {
    expect(swimOutcomeForRecording(input).outcome).toBe("completed");
    expect(swimOutcomeForRecording({ ...input, confirmation: {
      ...input.confirmation, outcome: "stopped_early",
    } }).outcome).toBe("stopped_early");
  });
  it.each([
    { latestImportId: "corrected-recording" }, { workoutRevision: 4 }, { matchedWorkoutRevision: 2 },
  ])("requires review after source changes: %j", (change) => {
    expect(swimOutcomeForRecording({ ...input, ...change })).toMatchObject({
      outcome: null, needsReview: true, canConfirm: false,
    });
  });
  it("does not carry a confirmation across to another recording's match", () => {
    expect(swimOutcomeForRecording({ ...input, matchId: "other-match" })).toMatchObject({
      outcome: null, otherMatch: true, needsReview: false,
    });
  });
  it("does not return native measurements or a workload estimate", () => {
    expect(Object.keys(swimOutcomeForRecording(input)).sort()).toEqual([
      "canConfirm", "needsReview", "otherMatch", "outcome",
    ]);
  });
});
