import { describe, expect, it } from "vitest";
import { hasRemainingProgramWorkouts, isPlannedRest, nextProgramCommitment, trainingWorkoutDates, type TrainingCommitment } from "./training-schedule";

describe("DC-K4: resuming retained program workouts", () => {
  const workout = { date: "2026-09-28", role: "strength", skipped: false, completed: false };
  it("includes unfinished work today or later without extending the program", () => {
    expect(hasRemainingProgramWorkouts([workout], "2026-09-28")).toBe(true);
    expect(hasRemainingProgramWorkouts([{ ...workout, date: "2026-10-04" }], "2026-09-28")).toBe(true);
    expect(hasRemainingProgramWorkouts([workout], "2026-09-29")).toBe(false);
  });
  it("excludes skipped, completed and both representations of rest", () => {
    for (const row of [{ ...workout, skipped: true }, { ...workout, completed: true },
      { ...workout, role: "rest" }, { ...workout, prescription: { kind: "rest" } }]) {
      expect(hasRemainingProgramWorkouts([row], "2026-09-28")).toBe(false);
    }
    expect(hasRemainingProgramWorkouts([], "2026-09-28")).toBe(false);
  });
});

describe("DC-K4 / DC-E3: actual workout dates preserve the planned-day history", () => {
  it("keeps completed work on its actual day with a non-work trace on the scheduled day", () => {
    expect(trainingWorkoutDates("2026-09-25", "2026-09-26", true))
      .toEqual({ date: "2026-09-26", traceDate: "2026-09-25" });
  });
  it("never infers completion or catches up an unlinked planned workout", () => {
    expect(trainingWorkoutDates("2026-09-25", null, false))
      .toEqual({ date: "2026-09-25", traceDate: null });
    expect(trainingWorkoutDates("2026-09-25", "2026-09-26", false))
      .toEqual({ date: "2026-09-26", traceDate: null });
    expect(trainingWorkoutDates("2026-09-25", "2026-09-25", true))
      .toEqual({ date: "2026-09-25", traceDate: null });
  });
});

describe("DC-K3: planned rest identity", () => {
  it("recognizes both stored rest representations without inferring from names", () => {
    expect(isPlannedRest({ role: "rest" })).toBe(true);
    expect(isPlannedRest({ prescription: { kind: "rest" } })).toBe(true);
    expect(isPlannedRest({ role: "primary", prescription: { kind: "strength", title: "Rest day lifting" } })).toBe(false);
    expect(isPlannedRest({ role: null, prescription: null })).toBe(false);
    expect(isPlannedRest({})).toBe(false);
  });

  describe("nextProgramCommitment", () => {
    it("selects the next scheduled date for only the requested program without mutating inputs", () => {
      const row: TrainingCommitment = { id: "next", source: "primary", programId: "p", date: "2026-09-25", title: "Workout", state: "scheduled" };
      const rows: TrainingCommitment[] = [
        { ...row, id: "later", date: "2026-09-26" }, row,
        { ...row, id: "past", date: "2026-09-23" },
        { ...row, id: "other", programId: "q", date: "2026-09-24" },
        { ...row, id: "swim", source: "swim", date: "2026-09-24" },
        ...(["started", "completed", "paused", "rest"] as const).map((state) => ({ ...row, id: state, state, date: "2026-09-24" })),
      ];
      const before = structuredClone(rows);
      expect(nextProgramCommitment(rows, "p", "2026-09-24")).toEqual(row);
      expect(rows).toEqual(before);
      expect(nextProgramCommitment(rows, "p", "2026-09-24", "swim")?.id).toBe("swim");
      expect(nextProgramCommitment(rows, "missing", "2026-09-24")).toBeUndefined();
      expect(nextProgramCommitment(rows, "p", "2026-09-27")).toBeUndefined();
      expect(nextProgramCommitment([{ ...row, date: "2026-09-24" }], "p", "2026-09-24")?.id).toBe("next");
    });
  });
});
