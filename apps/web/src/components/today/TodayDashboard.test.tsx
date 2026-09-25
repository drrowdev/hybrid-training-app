import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TodayDashboard, TodayWeek, type TodayWorkout } from "./TodayDashboard";
import { WorkoutExercises, workoutDose } from "./WorkoutExercises";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/planner/actions", () => ({ movePlannedSession: vi.fn(), previewPlannedMove: vi.fn(), skipPlannedSession: vi.fn() }));
vi.mock("@/lib/swim/actions", () => ({ applySwimDateEdit: vi.fn(), previewSwimDateEdit: vi.fn(), skipSwimWorkout: vi.fn() }));

const lift: TodayWorkout = {
  id: "lift", date: "2026-09-25", title: "Lower B", program: "Upper / lower", programId: "strength",
  kind: "strength", week: 3, weeks: 8, done: false, href: "/app/sessions/start/lift", minutes: 52,
  action: "Start workout", state: "not_started", items: [{ kind: "main", movementId: "squat", movementName: "Squat", sets: 4, reps: 5 }],
};
const swim: TodayWorkout = { ...lift, id: "swim", programId: "pool", kind: "swimming", title: "Endurance swim",
  href: "/app/swim/workouts/swim", action: "View swim", items: undefined, swimSteps: [] };
function render(workouts: TodayWorkout[], hasProgram = true) {
  return renderToStaticMarkup(<TodayDashboard today="2026-09-25" workouts={workouts} weekWorkouts={workouts}
    hasProgram={hasProgram} multiplePrograms={workouts.length > 1} prompt={null} quickWorkout={<button data-testid="quick">Quick workout</button>} />);
}
describe("Today presentation", () => {
  it("expands only the first pending workout and places logged workouts last", () => {
    const html = render([{ ...lift, done: true, href: "/app/sessions/logged", summary: "52 min" }, swim]);
    expect(html.indexOf('data-testid="today-card-swim"')).toBeLessThan(html.indexOf('data-testid="today-card-lift"'));
    expect(html.match(/data-testid="today-cta"/g)).toHaveLength(1);
    expect(html).toContain('aria-label="View logged Lower B"');
    expect(html).toContain('href="/app/sessions/logged"');
    expect(html).not.toContain('data-testid="today-mobile-cta"');
  });
  it("pins the same start destination only for a pending startable first workout", () => {
    const html = render([lift, swim]);
    expect(html.match(/<a[^>]+data-testid="today-mobile-cta"[^>]*>/)?.[0]).toContain('href="/app/sessions/start/lift"');
    expect(html.match(/data-testid="today-hero-preview"/g)).toHaveLength(1);
    expect(render([{ ...lift, done: true }])).not.toContain('data-testid="today-mobile-cta"');
    expect(render([{ ...lift, action: "Restore workout", state: "deleted_completed" }])).not.toContain('data-testid="today-mobile-cta"');
  });
  it("keeps a to-do card when an unrelated workout has been completed", () => {
    const html = render([lift, { ...swim, done: true }]);
    expect(html).toContain('data-testid="today-workouts"');
    expect(html).toContain('data-session-state="not_started"');
  });
  it("shows all logged workout links without a start action", () => {
    const html = render([{ ...lift, done: true }, { ...swim, done: true }]);
    expect(html).toContain('data-testid="today-logged"');
    expect(html).not.toContain('data-testid="today-cta"');
    expect(html.match(/data-state="done"/g)).toHaveLength(2);
  });
  it("distinguishes no program from a rest day", () => {
    expect(render([], false)).toContain('href="/app/programs"');
    expect(render([], false)).not.toContain('data-testid="today-week-strip"');
    expect(render([])).toContain('data-testid="today-rest"');
  });
  it("renders seven dates with one current-date marker and accessible completion", () => {
    const html = renderToStaticMarkup(<TodayWeek today="2026-09-25" workouts={[{ ...lift, done: true }]} multiplePrograms />);
    expect(html.match(/<time /g)).toHaveLength(7);
    expect(html.match(/aria-current="date"/g)).toHaveLength(1);
    expect(html).toContain("Completed");
    expect(html).toContain("strength: ");
    const single = renderToStaticMarkup(<TodayWeek today="2026-09-25" workouts={[lift]} multiplePrograms={false} />);
    expect(single).not.toContain("strength: ");
  });
  it("places a selected prompt above or below the workout list without duplication", () => {
    for (const placement of ["before-workouts", "after-workouts"] as const) {
      const html = renderToStaticMarkup(<TodayDashboard today="2026-09-25" workouts={[lift]} weekWorkouts={[lift]}
        hasProgram multiplePrograms={false} prompt={<div data-testid="decision" />} promptPlacement={placement} quickWorkout={null} />);
      expect(html.match(/data-testid="decision"/g)).toHaveLength(1);
      expect(html.indexOf('data-testid="decision"') < html.indexOf('data-testid="today-card-lift"')).toBe(placement === "before-workouts");
    }
  });
  it("preserves range doses and spoken reps without presenting a fixed count", () => {
    expect(workoutDose([{ movementId: "lift", kind: "back_off", sets: 5, reps: 8, setRange: { min: 3, max: 5 }, repRange: { min: 8, max: 10 } }]))
      .toEqual({ text: "3–5 × 8–10", spoken: "3 to 5 sets of 8 to 10 reps" });
  });
  it("keeps every rehab variant and its cue, alongside labelled supersets", () => {
    const circuit = { id: "pair", name: "Superset", size: 2, rounds: 3, position: 0 };
    const html = renderToStaticMarkup(<WorkoutExercises items={[
      { kind: "tendon", movementId: "copenhagen", movementName: "Copenhagen plank", sets: 3, reps: 8, notes: "Dynamic", meta: { rehab: true } },
      { kind: "tendon", movementId: "copenhagen", movementName: "Copenhagen plank", sets: 3, holdSec: { min: 20, max: 20 }, notes: "Keep the pelvis level", meta: { rehab: true } },
      { kind: "back_off", movementId: "split", movementName: "Split squat", sets: 3, reps: 8, circuit },
      { kind: "back_off", movementId: "calf", movementName: "Calf raise", sets: 3, reps: 10, circuit: { ...circuit, position: 1 } },
    ]} />);
    expect(html).toContain("Keep the pelvis level");
    expect(html).toContain("20");
    expect(html).toContain('role="group" aria-label="Superset"');
    expect(html.match(/<h3/g)?.length).toBe(2);
  });
  it("retains structured cardio segments, station loads and effort", () => {
    const html = renderToStaticMarkup(<WorkoutExercises items={[{
      movementId: "cardio", kind: "cardio_z2", durationMin: 40,
      cardioPlan: { summary: "Mixed intervals", effort: "Steady",
        segments: [{ label: "Run", detail: "4 × 800 m" }],
        stations: [{ name: "Sled push", load: "100 kg", target: "4 × 25 m" }] },
    }]} />);
    expect(html).toContain("800 m");
    expect(html).toContain("100 kg");
    expect(html).toContain("25 m");
    expect(html).toContain("Steady");
  });
  it("retains AMRAP and timed or distance prescriptions", () => {
    expect(workoutDose([{ movementId: "squat", kind: "main", sets: 1, reps: 5, isAmrap: true }]).text).toContain("5+");
    expect(workoutDose([{ movementId: "carry", kind: "accessory", sets: 3, distanceM: { min: 20, max: 30 } }]).text).toContain("20–30 m");
    expect(workoutDose([{ movementId: "plank", kind: "accessory", sets: 3, holdSec: { min: 20, max: 30 } }]).text).toContain("20–30s");
  });
});
