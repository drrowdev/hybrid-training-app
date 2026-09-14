import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { estimateCriticalSwimSpeed, validateSwimWorkout } from "@hta/domain";
import { generateSwimPlan } from "@hta/engine";
import { WorkoutScreen } from "@/components/swim/WorkoutScreen";
import { parseSetupForm } from "../forms";
import { standaloneWeekRequests } from "../model";
import { workoutPresentation } from "../presentation";
import type { SwimWorkoutView } from "../view-types";
import { swimFixture, sessionId } from "./fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));
vi.mock("../actions", () => ({ skipSwimWorkout: vi.fn() }));
vi.mock("@/components/trash/DeleteSessionButton", () => ({
  DeleteSessionButton: () => <button>Delete swim</button>,
}));

function workoutView(): SwimWorkoutView {
  const row = swimFixture().workouts[0]!;
  return {
    ...workoutPresentation(row.definition.issued),
    id: row.id, revision: 2, sessionId, status: "started",
    planStatus: "active", date: row.scheduled_date,
    provisional: false, deleted: false, result: null,
  };
}

function completedView(): SwimWorkoutView {
  return {
    ...workoutView(), revision: 3, status: "completed",
    result: {
      lengths: 12, timeMs: 900123, rpe: 6, notes: "Original swim", splits: "",
      stroke: "freestyle", strokes: ["freestyle"], equipment: [],
      course: "25 yd", distance: "300 yd", pool: workoutView().pool,
    },
  };
}

const render = (workout: SwimWorkoutView) => renderToStaticMarkup(<WorkoutScreen workout={workout} />);

describe("DC-SW3/DC-SW5 swimming workout review without in-app logging", () => {
  it.each(["active", "paused", "finished", "archived"] as const)(
    "has no execution or result-entry controls for a %s plan, including legacy started work", (planStatus) => {
      const scheduled: SwimWorkoutView = { ...workoutView(), sessionId: null, status: "scheduled" };
      const skipped: SwimWorkoutView = { ...scheduled, status: "skipped" };
      for (const workout of [scheduled, workoutView(), completedView(), skipped,
        { ...completedView(), deleted: true }, { ...completedView(), sourceGone: true, result: null }]) {
        const html = render({ ...workout, planStatus });
        expect(html).not.toMatch(/Start swim|Starting|Log swim|Log your swim|Finish swim|Edit result|Edit your swim|Mark next|Individual repeats/);
        expect(html).not.toMatch(/swim-result|type="checkbox"|data-context="cardio"|Saved on this device|data-done=/);
        expect(html).toContain("<h2>Workout</h2>");
        expect(html.match(/<li\b/g)).toHaveLength(workout.steps.length);
        expect(html).toContain(workout.total);
        expect(html).toContain(workout.date);
        for (const step of workout.steps) {
          for (const text of [step.section, step.title, step.detail, step.effort, step.rest, step.pace, step.guidance]) {
            if (text) expect(html).toContain(renderToStaticMarkup(<span>{text}</span>).slice(6, -7));
          }
        }
      }
    },
  );

  it("retains legacy results read-only without offering an editor", () => {
    const html = render(completedView());
    expect(html).toContain("<h2>Your swim</h2>");
    expect(html).toContain("300 yd");
    expect(html).toContain("12 lengths · 15:00.123 · RPE 6");
    expect(html).toContain("Original swim");
    expect(html).not.toMatch(/<form|<input|<textarea|<select|Edit result/);
    expect(html).toContain("Delete swim");
    expect(render({ ...completedView(), sourceGone: true, result: null })).not.toContain("Original swim");
  });

  it.each(["completed", "removed"] as const)(
    "DC-SW5/DC-SW7 keeps the issued prescription identical after a swim is %s", (state) => {
      const scheduled: SwimWorkoutView = { ...workoutView(), sessionId: null, status: "scheduled" };
      const after: SwimWorkoutView = {
        ...completedView(), planStatus: "paused",
        ...(state === "removed" ? { sessionId: null, sourceGone: true, result: null } : {}),
      };
      const prescription = (workout: SwimWorkoutView) => {
        const section = render(workout).match(/<section\b[^>]*><h2>Workout<\/h2>[\s\S]*?<\/section>/)?.[0];
        expect(section).toBeDefined();
        return section;
      };
      expect(prescription(after)).toBe(prescription(scheduled));
    },
  );

  it("preserves skipping scheduled work and the existing trash lifecycle", () => {
    const scheduled: SwimWorkoutView = { ...workoutView(), sessionId: null, status: "scheduled" };
    expect(render(scheduled)).toContain(">Skip swim</button>");
    expect(render(workoutView())).not.toContain(">Skip swim</button>");
    expect(render({ ...scheduled, planStatus: "paused" })).not.toContain(">Skip swim</button>");
    expect(render({ ...completedView(), deleted: true })).toContain('href="/app/settings/trash"');
    expect(render({ ...completedView(), deleted: true })).not.toContain("Delete swim");
    expect(render({ ...completedView(), sourceGone: true, result: null })).not.toContain("Delete swim");
  });

  it("has no logger, draft persistence or new completion queue wired into the workout screen", () => {
    const source = readFileSync(new URL("../../../components/swim/WorkoutScreen.tsx", import.meta.url), "utf8");
    expect(source).not.toMatch(/startSwimWorkout|editSwimResult|completeSwimWorkout|localStorage|outbox|SwimDraft|SplitFields|RpeInput/);
    expect(source).toContain("skipSwimWorkout");
  });

  it.each([
    ["B6", "10", "4:00", "8:30"],
    ["B7", "20", "16:00", "34:00"],
  ])("DC-SW1/DC-SW3: %s summary distinguishes the course from identical step distances", (_, minutes, time200, time400) => {
    const form = new FormData();
    for (const [name, value] of Object.entries({
      pool: "50m", goal: "endurance", experience: "regular", comfortableLengths: "12",
      timeBudgetMinutes: minutes, weeks: "2", startDate: "2026-09-10", weekdays: "1",
      strokes: "freestyle", time200, time400, benchmarkDate: "2026-09-10",
      benchmarkStroke: "freestyle", verified: "on",
    })) form.set(name, value);
    const input = parseSetupForm(form);
    const assessed = input.observation && estimateCriticalSwimSpeed(input.observation);
    if (!assessed?.ok) throw new Error("Expected calibrated budget fixture.");
    const generated = generateSwimPlan({
      setup: input.setup, calibration: assessed.value,
      weeks: standaloneWeekRequests(input.startDate, input.weeks, input.weekdays),
    });
    if (!generated.ok) throw new Error(generated.error.message);
    const slot = generated.value.weeks[0]!.slots[0]!;
    if (slot.kind !== "workout") throw new Error("Expected budget workout.");
    const view: SwimWorkoutView = {
      ...workoutView(), ...workoutPresentation(slot.issued),
      date: slot.dateISO, sessionId: null, status: "scheduled",
    };
    const html = render(view);
    const summary = html.match(/^<section\b[^>]*>([\s\S]*?)<\/section>/)?.[1];
    expect(summary).toBeDefined();
    expect(view.course).toBe("50 m");
    expect(html.split(`>${view.course}<`).length - 1).toBeGreaterThan(1);
    expect(summary!.split(`>${view.course}<`).length - 1).toBe(1);
  });

  it.each([
    "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10",
    "2026-09-11", "2026-09-12", "2026-09-13",
  ])("keeps C1's generated whole-length prescriptions with setup starting %s", (startDate) => {
    const form = new FormData();
    for (const [name, value] of Object.entries({
      goal: "base", experience: "beginner", pool: "25yd",
      comfortableLengths: "4", timeBudgetMinutes: "30", weeks: "4", startDate,
      strokes: "freestyle", time200: "", time400: "", benchmarkDate: "",
      benchmarkStroke: "freestyle", eventDate: "", eventDistance: "", eventUnit: "m",
    })) form.set(name, value);
    form.append("weekdays", "1");
    form.append("weekdays", "4");
    const input = parseSetupForm(form);
    const generated = generateSwimPlan({
      setup: input.setup, calibration: null,
      weeks: standaloneWeekRequests(input.startDate, input.weeks, input.weekdays),
    });
    if (!generated.ok) throw new Error(generated.error.message);
    expect(generated.value.weeks).toHaveLength(4);
    const slots = generated.value.weeks.flatMap((week) => week.slots);
    expect(slots.map((slot) => {
      if (slot.kind !== "workout") throw new Error("Expected a C1 workout");
      expect(validateSwimWorkout(slot.issued)).toEqual([]);
      return workoutPresentation(slot.issued).steps[0]!.repeatIds.length;
    })).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
  });
});
