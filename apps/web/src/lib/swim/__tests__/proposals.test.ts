import { describe, expect, it } from "vitest";
import { applySwimProposal, generateSwimPlan } from "@hta/engine";
import { deriveSwimWeekCandidate, persistedSwimPlan } from "../queries";
import { standaloneWeekRequests, swimWorkoutDefinition } from "../model";
import { swimFixture } from "./fixtures";

describe("ADR0079 persisted-actual week proposals", () => {
  it("DC-SW3 rejects an out-of-range stored week rather than omitting its work", () => {
    const { plan, workouts } = swimFixture();
    const row = workouts[0]!;
    for (const weekIndex of [-1, 3]) {
      const definition = { ...swimWorkoutDefinition(row), weekIndex };
      expect(() => persistedSwimPlan(plan, [{ ...row, definition }])).toThrow("unsupported week");
    }
  });
  it("DC-SW3/DC-SW5 preserves the declared event horizon when the first swim is later or only later weeks remain", () => {
    const fixture = swimFixture();
    const setup = { ...fixture.plan.definition.setup, event: { dateISO: "2026-09-15", distance: 400, unit: "yd" as const } };
    const generated = generateSwimPlan({ setup, calibration: null, weeks: standaloneWeekRequests("2026-09-07", 3, [3]) });
    if (!generated.ok) throw new Error(generated.error.message);
    const plan = {
      ...fixture.plan, definition: {
        ...fixture.plan.definition, setup, initialDose: generated.value.dose,
        schedule: { startDate: "2026-09-07", weeks: 3, weekdays: [3] },
      },
    };
    const workouts = generated.value.weeks.flatMap((week) => week.slots.map((slot) => {
      if (slot.kind !== "workout") throw new Error("Expected a generated workout");
      return {
        ...fixture.workouts[week.weekIndex]!, scheduled_date: slot.dateISO,
        definition: {
          version: 1 as const, original: slot.original, issued: slot.issued, modifications: [],
          weekIndex: week.weekIndex, slotId: slot.slotId, intent: slot.intent, provisional: week.provisional,
        },
      };
    }));
    for (const rows of [workouts, workouts.slice(1)]) {
      const restored = persistedSwimPlan(plan, rows);
      expect(restored.weeks.map((week) => week.startDateISO)).toEqual(["2026-09-07", "2026-09-14", "2026-09-21"]);
      expect(restored.weeks[0]!.slots).toHaveLength(rows === workouts ? 1 : 0);
      const edited = applySwimProposal(restored, { ...restored.dose, mainRepeats: restored.dose.mainRepeats + 1 }, {
        asOfISO: "2026-09-05", startedSlotIds: [],
      });
      expect(edited.ok).toBe(true);
      if (edited.ok) expect(edited.value.weeks.flatMap((week) => week.slots).every((slot) => slot.kind === "workout")).toBe(true);
    }
  });
  it("makes improving, plateaued and missed/high-effort histories produce different future targets", () => {
    const { plan, history } = swimFixture();
    const improving = deriveSwimWeekCandidate(plan, history, "2026-09-12")!;
    const plateau = deriveSwimWeekCandidate(plan, history.map((row) => ({
      ...row, result: row.result ? { ...row.result, rpe: 7 } : null,
    })), "2026-09-12")!;
    const struggling = deriveSwimWeekCandidate(plan, history.map((row, index) => index === 0 ? {
      ...row, workout: { ...row.workout, session_id: null, status: "skipped" },
      result: null, completedAt: null,
    } : { ...row, result: row.result ? { ...row.result, rpe: 9 } : null }), "2026-09-12")!;
    expect(improving.proposal.decision).toBe("progress");
    expect(plateau.proposal.decision).toBe("hold");
    expect(struggling.proposal.decision).toBe("reduce");
    expect(improving.proposal.to).not.toEqual(struggling.proposal.to);
    expect(improving.exactInputs).toHaveProperty("sourceRows");
    expect(improving.exactInputs).toHaveProperty("versions");
  });
  it("does not let the same actuals advance a week repeatedly after acceptance", () => {
    const { plan, history } = swimFixture();
    const candidate = deriveSwimWeekCandidate(plan, history, "2026-09-12")!;
    const updated = {
      ...plan, state: { ...plan.state, decisions: [{
        id: candidate.id, kind: "progression" as const, decision: "accepted" as const,
        recordedAt: "2026-09-12T12:00:00Z", ruleVersion: "test", generatorVersion: "test",
        inputSnapshot: { ...candidate.exactInputs, appliedDose: candidate.proposal.to },
      }] },
    };
    expect(deriveSwimWeekCandidate(updated, history, "2026-09-12")).toBeNull();
  });
  it("DC-K5 does not compound an accepted future increase when the source actual is edited", () => {
    const { plan, history } = swimFixture();
    const first = deriveSwimWeekCandidate(plan, history, "2026-09-12")!;
    const updated = {
      ...plan, state: { ...plan.state, decisions: [{
        id: first.id, kind: "progression" as const, decision: "accepted" as const,
        recordedAt: "2026-09-12T12:00:00Z", ruleVersion: "test", generatorVersion: "test",
        inputSnapshot: { ...first.exactInputs, appliedDose: first.proposal.to },
      }] },
    };
    const edited = history.map((row, index) => index === 0 ? {
      ...row, notes: "Updated note", workout: { ...row.workout, revision: row.workout.revision + 1 },
    } : row);
    const revised = deriveSwimWeekCandidate(updated, edited, "2026-09-12")!;
    expect(revised.proposal.from).toEqual(first.proposal.from);
    expect(revised.proposal.to).toEqual(first.proposal.to);
  });
  it("excludes started future swims and preserves each original prescription", () => {
    const { plan, history } = swimFixture();
    const changed = history.map((row, index) => index === 2 ? {
      ...row, workout: { ...row.workout, session_id: "started", status: "started" as const },
    } : row);
    const candidate = deriveSwimWeekCandidate(plan, changed, "2026-09-12")!;
    const startedSlot = candidate.generated.weeks[1]!.slots[0]!;
    expect(startedSlot.kind).toBe("workout");
    if (startedSlot.kind === "workout") expect(startedSlot.issued).toEqual(history[2]!.workout.definition.issued);
    for (const week of candidate.generated.weeks) for (const slot of week.slots) {
      if (slot.kind !== "workout") continue;
      const previous = history.find((row) => row.workout.scheduled_date === slot.dateISO)!;
      expect(slot.original).toEqual(previous.workout.definition.original);
    }
  });
  it("does not adapt an archived plan from a late completion", () => {
    const { plan, history } = swimFixture();
    expect(deriveSwimWeekCandidate({ ...plan, status: "archived" }, history, "2026-09-12")).toBeNull();
  });
  it("does not let a trashed abandoned start permanently block the next week", () => {
    const { plan, history } = swimFixture();
    const abandoned = history.map((row, index) => index === 0 ? {
      ...row, deleted: true, completedAt: null, result: null,
      workout: { ...row.workout, status: "started" as const },
    } : row);
    const candidate = deriveSwimWeekCandidate(plan, abandoned, "2026-09-12");
    expect(candidate).not.toBeNull();
    expect(candidate?.proposal.snapshot.excludedResults.map((entry) => entry.result.workoutId)).toContain(history[0]!.workout.id);
  });
  it("does not mix pre-pause completions into the resumed review cohort", () => {
    const { plan, history } = swimFixture();
    const dates = ["2026-09-07", "2026-10-01", "2026-10-08", "2026-10-12", "2026-10-15", "2026-10-19"];
    const resumedHistory = history.map((row, index) => ({
      ...row,
      workout: { ...row.workout, scheduled_date: dates[index]! },
      result: row.result ? { ...row.result, rpe: index === 0 ? 9 : 5 } : null,
      performedAt: row.performedAt ? `${dates[index]}T12:00:00Z` : null,
      completedAt: row.completedAt ? `${dates[index]}T12:20:00Z` : null,
    }));
    const resumed = { ...plan, state: { ...plan.state, decisions: [{
      id: "resume-1", kind: "schedule" as const, decision: "accepted" as const,
      recordedAt: "2026-10-01T09:00:00Z", ruleVersion: "test", generatorVersion: "test",
      inputSnapshot: { preview: { dates: history.slice(1).map((row, index) => ({
        id: row.workout.id, revision: row.workout.revision, date: dates[index + 1]!,
      })) } },
    }] } };
    const candidate = deriveSwimWeekCandidate(resumed, resumedHistory, "2026-10-02")!;
    expect(candidate.input.history.map((row) => row.workoutId)).toEqual([history[1]!.workout.id]);
    expect(candidate.proposal.snapshot.meanRpe).toBe(5);
    expect(candidate.exactInputs.resumeDecisionId).toBe("resume-1");
    expect(candidate.targetWorkoutIds).toEqual(history.slice(2, 4).map((row) => row.workout.id));
  });
});
