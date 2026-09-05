import { describe, expect, it } from "vitest";
import { countsTowardAdherence, countsTowardHistory, countsTowardProgression, summarizeSwimWeek } from "@hta/domain";
import { settledSwimResult } from "../queries";
import type { SwimPlanRow } from "../storage";
import { swimFixture } from "./fixtures";

function lifecycleFixture() {
  const fixture = swimFixture();
  const pause = { from: "active" as const, to: "paused" as const, recordedAt: "2026-09-10T12:05:00Z" };
  const resume = { from: "paused" as const, to: "active" as const, recordedAt: "2026-09-13T09:00:00Z" };
  const paused: SwimPlanRow = {
    ...fixture.plan, status: "paused",
    state: {
      ...fixture.plan.state, lifecycle: [pause],
      pauseSnapshot: { pausedAt: pause.recordedAt, workoutIds: fixture.workouts.slice(2).map((row) => row.id) },
    },
  };
  const resumed: SwimPlanRow = { ...paused, status: "active", state: { ...paused.state, lifecycle: [pause, resume] } };
  return { ...fixture, paused, resumed };
}

describe("ADR0079 DC-SW7 completion-time lifecycle", () => {
  it("keeps pause-time actual distance, frequency and load inputs after resume without adherence or progression", () => {
    const { history, paused, resumed } = lifecycleFixture();
    const row = history[1]!;
    for (const plan of [paused, resumed]) {
      const result = settledSwimResult(row, plan);
      expect(result.lifecycle.planPaused).toBe(true);
      expect(countsTowardHistory(result)).toBe(true);
      expect(result).toMatchObject({ actualMs: row.result!.timeMs, rpe: row.result!.rpe });
      expect(countsTowardAdherence(result)).toBe(false);
      expect(countsTowardProgression(result)).toBe(false);
      const summary = summarizeSwimWeek({ weekStartISO: "2026-09-07", results: [result] });
      expect(summary).toMatchObject({ actualSessions: 1, sessionsCompleted: 0, sessionsPlanned: 0, adherence: null });
      expect(summary.byCourse[0]).toMatchObject({ actualLengths: row.result!.lengths, actualSessions: 1, plannedLengths: 0 });
    }
  });

  it("leaves pre-pause completions and historical misses unchanged while excluding captured unstarted targets", () => {
    const { history, paused, resumed } = lifecycleFixture();
    const earlier = history[0]!;
    const missed = {
      ...earlier, workout: { ...earlier.workout, status: "scheduled" as const, session_id: null },
      result: null, performedAt: null, completedAt: null,
    };
    for (const plan of [paused, resumed]) {
      expect(countsTowardAdherence(settledSwimResult(earlier, plan))).toBe(true);
      expect(countsTowardProgression(settledSwimResult(earlier, plan))).toBe(true);
      expect(countsTowardAdherence(settledSwimResult(missed, plan))).toBe(true);
    }
    expect(countsTowardAdherence(settledSwimResult(history[2]!, paused))).toBe(false);
    expect(countsTowardAdherence(settledSwimResult(history[2]!, resumed))).toBe(true);
  });

  it.each<[string, boolean]>([
    ["2026-09-10T12:04:59Z", false],
    ["2026-09-10T12:05:00Z", true],
    ["2026-09-10T15:10:00+03:00", true],
    ["2026-09-13T08:59:59Z", true],
    ["2026-09-13T09:00:00Z", false],
  ])("uses the pause/resume timestamp boundaries for %s", (completedAt, expected) => {
    const { history, resumed } = lifecycleFixture();
    expect(settledSwimResult({ ...history[1]!, completedAt }, resumed).lifecycle.planPaused).toBe(expected);
  });

  it("retains every pause window across repeated pauses and resumes", () => {
    const { history, resumed } = lifecycleFixture();
    const later: SwimPlanRow = {
      ...resumed, state: { ...resumed.state, lifecycle: [...resumed.state.lifecycle!,
        { from: "active", to: "paused", recordedAt: "2026-09-20T12:00:00Z" },
        { from: "paused", to: "active", recordedAt: "2026-09-21T12:00:00Z" },
      ] },
    };
    expect(settledSwimResult(history[1]!, later).lifecycle.planPaused).toBe(true);
    expect(settledSwimResult({ ...history[1]!, completedAt: "2026-09-15T12:30:00Z" }, later).lifecycle.planPaused).toBe(false);
    expect(settledSwimResult({ ...history[1]!, completedAt: "2026-09-20T12:30:00Z" }, later).lifecycle.planPaused).toBe(true);
    expect(settledSwimResult({ ...history[1]!, completedAt: "2026-09-21T12:30:00Z" }, later).lifecycle.planPaused).toBe(false);
  });

  it("does not relabel earlier actuals when the plan is later archived", () => {
    const { history, resumed } = lifecycleFixture();
    const archived: SwimPlanRow = {
      ...resumed, status: "archived",
      state: { ...resumed.state, lifecycle: [...resumed.state.lifecycle!, {
        from: "active", to: "archived", recordedAt: "2026-09-20T12:00:00Z",
      }] },
    };
    expect(settledSwimResult(history[0]!, archived).lifecycle.archivedLate).toBe(false);
    expect(settledSwimResult(history[1]!, archived).lifecycle.planPaused).toBe(true);
    const late = settledSwimResult({ ...history[1]!, completedAt: "2026-09-20T12:30:00Z" }, archived);
    expect(late.lifecycle.archivedLate).toBe(true);
    expect(countsTowardProgression(late)).toBe(false);
    expect(countsTowardHistory(late)).toBe(true);
    expect(late.actualMs).toBe(history[1]!.result!.timeMs);
  });
});
