import { describe, expect, it } from "vitest";
import { swimFixture } from "./fixtures";
import { swimWorkoutDateRange } from "../model";

describe("DC-SW3/DC-SW5/DC-SW7 assigned swim-week date boundaries", () => {
  it("uses the actual program anchor rather than a calendar Monday", () => {
    const { plan, workouts } = swimFixture();
    const shifted = { ...plan, started_on: "2026-09-09", ends_on: "2026-09-29", definition: {
      ...plan.definition, schedule: { startDate: "2026-09-09", weeks: 3, weekdays: [1, 4] },
    } };
    expect(swimWorkoutDateRange(shifted, workouts, workouts[2]!, "2026-09-05")).toEqual({
      min: "2026-09-16", max: "2026-09-22",
    });
  });
  it("keeps the range strictly in the future and within the retained plan end", () => {
    const { plan, workouts } = swimFixture();
    expect(swimWorkoutDateRange(plan, workouts, workouts[2]!, "2026-09-17")).toEqual({
      min: "2026-09-18", max: "2026-09-20",
    });
    expect(swimWorkoutDateRange({ ...plan, ends_on: "2026-09-18" }, workouts, workouts[2]!, "2026-09-05")).toEqual({
      min: "2026-09-14", max: "2026-09-18",
    });
  });
  it("preserves partial weeks and the new anchor after a reviewed resume", () => {
    const { plan, workouts } = swimFixture();
    const resumed = {
      ...plan, ends_on: "2026-10-27", state: { ...plan.state, decisions: [{
        id: "resume", kind: "schedule" as const, decision: "accepted" as const,
        recordedAt: "2026-10-06T12:00:00Z", ruleVersion: "test", generatorVersion: "test",
        inputSnapshot: { preview: { startDate: "2026-10-07", dates: workouts.slice(1).map((row) => ({ id: row.id })) } },
      }] },
    };
    expect(swimWorkoutDateRange(resumed, workouts, workouts[1]!, "2026-10-06")).toEqual({
      min: "2026-10-07", max: "2026-10-13",
    });
    expect(swimWorkoutDateRange(resumed, workouts, workouts[2]!, "2026-10-06")).toEqual({
      min: "2026-10-14", max: "2026-10-20",
    });
    const moved = { ...resumed, state: { ...resumed.state, decisions: [...resumed.state.decisions, {
      id: "move", kind: "schedule" as const, decision: "overridden" as const,
      recordedAt: "2026-10-06T13:00:00Z", ruleVersion: "test", generatorVersion: "test",
      inputSnapshot: { operation: "reschedule" },
    }] } };
    expect(swimWorkoutDateRange(moved, workouts, workouts[2]!, "2026-10-06")).toEqual({
      min: "2026-10-14", max: "2026-10-20",
    });
  });
});
