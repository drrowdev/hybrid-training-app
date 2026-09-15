import { describe, expect, it } from "vitest";
import { swimTrainingState } from "./swim-training-state";

const input: Parameters<typeof swimTrainingState>[0] = {
  planStatus: "active", parentActive: true, parentExists: true, workoutStatus: "scheduled",
  nativeSessionId: null, nativeCompletedAt: null, nativeVisible: false, evidence: null,
};
const evidence = {
  confirmation: { outcome: "completed" as const, matchId: "match", workoutRevision: 1 },
  matchId: "match", matchedImportId: "recording", latestImportId: "recording",
  matchedWorkoutRevision: 1, workoutRevision: 1,
};

describe("DC-SW4/SW5/SW8 shared training state", () => {
  it("keeps unconfirmed swims actionable without creating a result", () => {
    expect(swimTrainingState(input)).toEqual({ status: "scheduled", completed: false, settled: false, actionable: true });
  });
  it("settles a stopped-early swim without marking its prescription completed", () => {
    expect(swimTrainingState({ ...input, evidence: { ...evidence, confirmation: {
      ...evidence.confirmation, outcome: "stopped_early",
    } } })).toEqual({ status: "stopped_early", completed: false, settled: true, actionable: false });
    expect(swimTrainingState({ ...input, evidence })).toEqual({
      status: "completed", completed: true, settled: true, actionable: false,
    });
  });
  it.each([{ latestImportId: "new" }, { matchId: "unmatched" }, { workoutRevision: 2 }])(
    "does not settle obsolete evidence: %j", (change) => {
      expect(swimTrainingState({ ...input, evidence: { ...evidence, ...change } })).toEqual({
        status: "needs_review", completed: false, settled: false, actionable: true,
      });
    },
  );
  it("removing a confirmation restores the scheduled state", () => {
    expect(swimTrainingState({ ...input, evidence: { ...evidence, confirmation: null } }).status).toBe("scheduled");
  });
  it.each([
    [{ planStatus: "paused" }, "paused"], [{ parentActive: false }, "archived"],
    [{ parentActive: false, parentExists: false }, "unavailable"],
    [{ planStatus: "archived" }, "archived"], [{ workoutStatus: "skipped" }, "skipped"],
  ] as const)("keeps inactive work off the next-workout surface: %j", (change, status) => {
    expect(swimTrainingState({ ...input, ...change })).toMatchObject({ status, completed: false, actionable: false });
  });
  it("retains confirmed history after the programme ends or is purged", () => {
    expect(swimTrainingState({ ...input, parentExists: false, parentActive: false, evidence }).completed).toBe(true);
  });
  it("does not count removed native results", () => {
    expect(swimTrainingState({ ...input, nativeSessionId: "deleted" })).toMatchObject({
      status: "unavailable", completed: false, actionable: false,
    });
  });
});
