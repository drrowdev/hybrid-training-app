import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { validateSwimWorkout } from "@hta/domain";
import { generateSwimPlan } from "@hta/engine";
import { WorkoutClient } from "@/components/swim/WorkoutClient";
import { WorkoutScreen } from "@/components/swim/WorkoutScreen";
import { parseSetupForm } from "../forms";
import { standaloneWeekRequests } from "../model";
import { workoutPresentation } from "../presentation";
import type { SwimWorkoutView } from "../view-types";
import { swimFixture, userId, sessionId } from "./fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {}, replace() {} }) }));
vi.mock("../actions", () => ({}));
vi.mock("@/components/trash/DeleteSessionButton", () => ({ DeleteSessionButton: () => null }));
vi.mock("@/lib/offline/flusher", () => ({}));

function workoutView(): SwimWorkoutView {
  const row = swimFixture().workouts[0]!;
  return {
    ...workoutPresentation(row.definition.issued),
    id: row.id, revision: 2, sessionId, status: "started",
    planStatus: "active", date: row.scheduled_date,
    provisional: false, deleted: false, result: null,
  };
}

describe("DC-SW3 poolside workout controls", () => {
  it.each([
    "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10",
    "2026-09-11", "2026-09-12", "2026-09-13",
  ])("keeps C1 first steps single-repeat with setup starting %s", (startDate) => {
    // SetupForm defaults, with only C1's pool, comfortable lengths and weeks changed.
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
    expect(input.observation).toBeNull();
    const generated = generateSwimPlan({
      setup: input.setup, calibration: null,
      weeks: standaloneWeekRequests(input.startDate, input.weeks, input.weekdays),
    });
    expect(generated.ok).toBe(true);
    if (!generated.ok) throw new Error(generated.error.message);
    expect(generated.value.weeks).toHaveLength(4);
    const slots = generated.value.weeks.flatMap((week) => week.slots);
    expect(slots.length).toBeGreaterThan(0);
    const firstStepRepeatCounts = slots.map((slot) => {
      expect(slot.kind).toBe("workout");
      if (slot.kind !== "workout") throw new Error("Expected a C1 workout");
      expect(validateSwimWorkout(slot.issued)).toEqual([]);
      const { steps } = workoutPresentation(slot.issued);
      expect(steps.length).toBeGreaterThan(0);
      const firstStep = steps[0]!;
      expect(firstStep.repeatIds.length).toBeGreaterThan(0);
      return firstStep.repeatIds.length;
    });
    expect(firstStepRepeatCounts).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
  });

  it("reaches actual logging without scrolling through every repeat", () => {
    const html = renderToStaticMarkup(<WorkoutScreen workout={workoutView()} userId={userId} />);
    expect(html).toContain('href="#swim-result"');
    expect(html).toContain('id="swim-result"');
  });

  it("does not offer the logging shortcut before starting", () => {
    const workout = { ...workoutView(), status: "scheduled" as const, sessionId: null };
    const html = renderToStaticMarkup(<WorkoutScreen workout={workout} userId={userId} />);
    expect(html).not.toContain('href="#swim-result"');
    expect(html).not.toContain('id="swim-result"');
  });

  it("disables Start swim before hydration and draft loading", () => {
    const workout = { ...workoutView(), status: "scheduled" as const, sessionId: null };
    const html = renderToStaticMarkup(<WorkoutScreen workout={workout} userId={userId} />);
    const buttons = html.match(/<button\b[^>]*>Start swim<\/button>/g);
    expect(buttons).toHaveLength(1);
    expect(buttons![0]).toMatch(/\sdisabled=""/);
  });

  it("renders a progress checkbox for a view with a session, without claiming hydration readiness", () => {
    const workout = workoutView();
    expect(workout.steps[0]!.repeatIds).toHaveLength(1);
    const html = renderToStaticMarkup(<WorkoutScreen workout={workout} userId={userId} />);
    const checkboxes = html.match(/<input\b[^>]*type="checkbox"[^>]*aria-label="Mark [^"]* done"[^>]*>/g);
    expect(checkboxes?.length).toBeGreaterThan(0);
    expect(checkboxes![0]).toContain('disabled=""');
  });

  it("adds no DOM around the existing revision-keyed child", () => {
    const workout = workoutView();
    expect(renderToStaticMarkup(<WorkoutScreen workout={workout} userId={userId} edit />))
      .toBe(renderToStaticMarkup(<WorkoutClient workout={workout} userId={userId} edit
        onConfirmed={() => {}} warning={null} setWarning={() => {}} />));
  });
});
