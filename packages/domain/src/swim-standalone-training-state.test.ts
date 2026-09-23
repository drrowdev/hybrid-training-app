import { describe, expect, it } from "vitest";
import { nextStandaloneSwimWorkout, standaloneSwimTrainingState, type StandaloneSwimTrainingInput } from "./swim-standalone-training-state";

const input: StandaloneSwimTrainingInput = {
  planStatus: "active", workoutStatus: "scheduled",
  nativeSessionId: null, nativeCompletedAt: null, nativeVisible: false, evidence: null,
};
const evidence: NonNullable<StandaloneSwimTrainingInput["evidence"]> = {
  confirmation: { outcome: "completed", matchId: "match", workoutRevision: 1 },
  matchId: "match", matchedImportId: "recording", latestImportId: "recording",
  matchedWorkoutRevision: 1, workoutRevision: 1,
};

describe("DC-SW5/SW6/SW7/SW8 standalone imported result presentation", () => {
  it("keeps unknown and matched-only workouts scheduled without inventing a result", () => {
    const expected = { status: "scheduled", completed: false, settled: false, actionable: true };
    expect(standaloneSwimTrainingState(input)).toEqual(expected);
    expect(standaloneSwimTrainingState({ ...input, evidence: { ...evidence, confirmation: null } })).toEqual(expected);
  });
  it.each(["completed", "stopped_early"] as const)("settles an explicit current %s claim", (outcome) => {
    expect(standaloneSwimTrainingState({ ...input, evidence: {
      ...evidence, confirmation: { ...evidence.confirmation!, outcome },
    } })).toEqual({ status: outcome, completed: outcome === "completed", settled: true, actionable: false });
  });
  it.each([
    { latestImportId: "corrected" }, { matchedImportId: "older" }, { workoutRevision: 2 },
    { matchedWorkoutRevision: 2 }, { matchId: "rematched" },
    { confirmation: { ...evidence.confirmation!, workoutRevision: 2 } },
  ])("requires review of stale or rematched evidence: %j", (change) => {
    expect(standaloneSwimTrainingState({ ...input, evidence: { ...evidence, ...change } })).toEqual({
      status: "needs_review", completed: false, settled: false, actionable: true,
    });
  });
  it.each(["active", "paused", "finished", "archived"] as const)(
    "removing a claim restores the %s plan's ordinary presentation", (planStatus) => {
      const without = standaloneSwimTrainingState({ ...input, planStatus });
      expect(standaloneSwimTrainingState({ ...input, planStatus, evidence: {
        ...evidence, confirmation: { outcome: null, matchId: null, workoutRevision: null },
      } })).toEqual(without);
    },
  );
  it.each(["matchId", "matchedImportId", "latestImportId", "matchedWorkoutRevision"] as const)(
    "retains a claim needing review when its current %s is no longer available", (key) => {
      expect(standaloneSwimTrainingState({ ...input, evidence: { ...evidence, [key]: null } })).toEqual({
        status: "needs_review", completed: false, settled: false, actionable: true,
      });
      expect(standaloneSwimTrainingState({ ...input, planStatus: "archived",
        evidence: { ...evidence, [key]: null } }).actionable).toBe(false);
      expect(standaloneSwimTrainingState({ ...input,
        evidence: { ...evidence, [key]: null, confirmation: null } })).toEqual(standaloneSwimTrainingState(input));
    },
  );
  it.each(["paused", "finished", "archived"] as const)(
    "preserves confirmed and stale history on a %s plan without making it next", (planStatus) => {
      expect(standaloneSwimTrainingState({ ...input, planStatus, evidence })).toEqual({
        status: "completed", completed: true, settled: true, actionable: false,
      });
      expect(standaloneSwimTrainingState({ ...input, planStatus, evidence: {
        ...evidence, latestImportId: "corrected",
      } })).toEqual({ status: "needs_review", completed: false, settled: false, actionable: false });
    },
  );
  it("counts only an explicit skip as skipped", () => {
    expect(standaloneSwimTrainingState({ ...input, workoutStatus: "skipped" })).toEqual({
      status: "skipped", completed: false, settled: true, actionable: false,
    });
    expect(standaloneSwimTrainingState(input).status).not.toBe("skipped");
  });
  it.each(["paused", "finished", "archived"] as const)("keeps an unsettled %s plan off the next-workout surface", (planStatus) => {
    expect(standaloneSwimTrainingState({ ...input, planStatus })).toEqual({
      status: planStatus === "paused" ? "paused" : "archived",
      completed: false, settled: false, actionable: false,
    });
  });
  it.each([null, "2026-09-22T10:00:00Z"])("gives a visible legacy session precedence, completedAt=%s", (nativeCompletedAt) => {
    expect(standaloneSwimTrainingState({
      ...input, nativeSessionId: "native", nativeVisible: true, nativeCompletedAt, evidence,
    })).toEqual({
      status: nativeCompletedAt ? "completed" : "started",
      completed: nativeCompletedAt !== null, settled: nativeCompletedAt !== null,
      actionable: nativeCompletedAt === null,
    });
  });
  it("never revives a deleted native session using a stale imported claim", () => {
    expect(standaloneSwimTrainingState({
      ...input, nativeSessionId: "deleted", nativeCompletedAt: "2026-09-22T10:00:00Z", evidence,
    })).toEqual({ status: "unavailable", completed: false, settled: false, actionable: false });
  });
  it.each(["started", "completed"] as const)("does not invent a missing native %s result", (workoutStatus) => {
    expect(standaloneSwimTrainingState({ ...input, workoutStatus, evidence })).toEqual({
      status: "unavailable", completed: false, settled: false, actionable: false,
    });
  });
  it("does not treat an unlinked timestamp as a native completion", () => {
    expect(standaloneSwimTrainingState({ ...input, nativeCompletedAt: "2026-09-22T10:00:00Z" }))
      .toEqual(standaloneSwimTrainingState(input));
  });
  it("does not mutate evidence or emit inferred duration, pace, distance or load", () => {
    const value = structuredClone({ ...input, evidence });
    const before = structuredClone(value);
    expect(Object.keys(standaloneSwimTrainingState(value)).sort()).toEqual(["actionable", "completed", "settled", "status"]);
    expect(value).toEqual(before);
  });
  it("DC-SW5 selects the next dated unsettled swim and restores it after confirmation removal", () => {
    const today = "2026-09-23";
    const first = { id: "first", date: today, state: standaloneSwimTrainingState(input) };
    const second = { ...first, id: "second", date: "2026-09-25" };
    for (const change of [
      evidence, { ...evidence, confirmation: { ...evidence.confirmation!, outcome: "stopped_early" as const } },
      { ...evidence, matchId: null },
    ]) {
      expect(nextStandaloneSwimWorkout([{ ...first, state: standaloneSwimTrainingState({ ...input, evidence: change }) }, second], today))
        .toBe(second);
    }
    expect(nextStandaloneSwimWorkout([second, first], today)).toBe(first);
    expect(nextStandaloneSwimWorkout([{ ...first, date: "2026-09-22" }], today)).toBeUndefined();
    expect(nextStandaloneSwimWorkout([{ ...first, state: standaloneSwimTrainingState({ ...input, planStatus: "paused" }) }], today))
      .toBeUndefined();
    const started = { ...first, date: "2026-09-22", state: standaloneSwimTrainingState({
      ...input, nativeSessionId: "native", nativeVisible: true,
    }) };
    expect(nextStandaloneSwimWorkout([second, started], today)).toBe(started);
  });
});
