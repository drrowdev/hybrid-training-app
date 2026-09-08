import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { validateSwimWorkout } from "@hta/domain";
import { generateSwimPlan } from "@hta/engine";
import { WorkoutClient } from "@/components/swim/WorkoutClient";
import { WorkoutScreen } from "@/components/swim/WorkoutScreen";
import { parseSetupForm } from "../forms";
import { standaloneWeekRequests } from "../model";
import { workoutPresentation } from "../presentation";
import { nextConfirmedView, type SwimWorkoutView } from "../view-types";
import { SWIM_REFRESH_WARNING } from "../action-feedback";
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

  describe("DC-SW7 monotonic confirmed workout view", () => {
    it.each(["props", "confirmed"] as const)("accepts newer %s and preserves identity for older or unchanged input", (source) => {
      const current = workoutView();
      const newer = { ...current, revision: 3 };
      expect(nextConfirmedView(current, newer, source)).toBe(newer);
      expect(nextConfirmedView(newer, current, source)).toBe(newer);
      expect(nextConfirmedView(current, current, source)).toBe(current);
    });

    it("absorbs confirmed Start → newer completion props → stale props → late older reply", () => {
      const started = workoutView();
      const scheduled = { ...started, revision: 1, sessionId: null, status: "scheduled" as const };
      const completed: SwimWorkoutView = {
        ...started, revision: 3, status: "completed",
        result: { lengths: 12, timeMs: 900123, stroke: "freestyle" },
      };
      let held = nextConfirmedView(scheduled, started, "confirmed");
      expect(held).toBe(started);
      held = nextConfirmedView(held, completed, "props");
      expect(held).toBe(completed);
      held = nextConfirmedView(held, scheduled, "props");
      expect(held).toBe(completed);
      expect(nextConfirmedView(held, started, "confirmed")).toBe(completed);
    });

    it.each([
      { deleted: true }, { deleted: false }, { sourceGone: true }, { sourceGone: false },
      { planStatus: "paused" }, { planStatus: "finished" }, { planStatus: "archived" }, { planStatus: "active" },
      { result: { lengths: 12, timeMs: 900123, stroke: "freestyle" } },
    ] satisfies Partial<SwimWorkoutView>[])("accepts equal-revision props %j without accepting an equal reply", (changes) => {
      const current = workoutView();
      const incoming = { ...current, ...changes };
      expect(nextConfirmedView(current, incoming, "props")).toBe(incoming);
      expect(nextConfirmedView(current, incoming, "confirmed")).toBe(current);
      expect(`${incoming.id}:${incoming.revision}`).toBe(`${current.id}:${current.revision}`);
    });

    it.each([1, 2, 9])("ignores foreign replies at revision %s and permits a props ID switch", (revision) => {
      const current = workoutView();
      const foreign = { ...current, id: "other-workout", revision };
      expect(nextConfirmedView(current, foreign, "confirmed")).toBe(current);
      const selected = nextConfirmedView(current, foreign, "props");
      expect(selected).toBe(foreign);
      expect(nextConfirmedView(selected, { ...current, revision: 10 }, "confirmed")).toBe(selected);
    });
  });

  describe("WorkoutScreen ownership and controlled warning boundary", () => {
    const owner = readFileSync(new URL("../../../components/swim/WorkoutScreen.tsx", import.meta.url), "utf8");
    const child = readFileSync(new URL("../../../components/swim/WorkoutClient.tsx", import.meta.url), "utf8");

    it("absorbs props and functional confirmed updates above the exact child revision key", () => {
      expect(owner).toContain("const [heldWorkout, setWorkout] = useState(incomingWorkout)");
      expect(owner).toContain('const effective = nextConfirmedView(heldWorkout, incomingWorkout, "props")');
      expect(owner).toContain("if (effective !== heldWorkout) setWorkout(effective)");
      expect(owner).toContain('onConfirmed={(view) => setWorkout((current) => nextConfirmedView(current, view, "confirmed"))}');
      expect(owner).toContain('return <WorkoutClient key={`${effective.id}:${effective.revision}`} workout={effective} userId={userId} edit={edit}');
    });

    it("keeps warning state and its setter above remounts, not in child initialization or a props effect", () => {
      expect(owner).toContain("const [warning, setWarning] = useState<string | null>(null)");
      expect(owner).toContain("warning={warning} setWarning={setWarning}");
      expect(owner).not.toContain("useEffect");
      expect(owner.match(/\bsetWarning\b/g)).toHaveLength(3);
      expect(child).not.toContain("[warning, setWarning]");
      expect(child).toContain("warning: string | null; setWarning: (warning: string | null) => void");
      expect(child).toContain("const [draft, setDraft] = useState<SwimDraft>(() => initialSwimDraft(workout))");
      expect(child).toContain("const [ready, setReady] = useState(false)");
      expect(child).toContain('const [sync, setSync] = useState<"idle" | "queued" | "saved" | "checking">("idle")');
      expect(child).toContain("const [editing, setEditing] = useState(edit)");
    });

    it("retains strict success checks, Start/submit warning clears and confirmation before refresh", () => {
      const start = child.slice(child.indexOf("function start()"), child.indexOf("function submit("));
      const submit = child.slice(child.indexOf("function submit("), child.indexOf("const completed ="));
      for (const action of [start, submit]) {
        expect(action).toContain("setError(null)");
        expect(action).toContain("setWarning(null)");
        expect(action).toContain("if (!result || result.ok !== true || result.error || result.errorCode)");
        expect(action).toContain("setWarning(result.warning ?? null)");
        expect(action).toContain("catch { setWarning(SWIM_REFRESH_WARNING); }");
      }
      expect(start).toContain("if (result.view) onConfirmed(result.view)");
      expect(start.indexOf("setWarning(result.warning ?? null)")).toBeLessThan(start.indexOf("onConfirmed(result.view)"));
      expect(start.indexOf("onConfirmed(result.view)")).toBeLessThan(start.indexOf("router.refresh()"));
      expect(start.indexOf("if (!result ||")).toBeLessThan(start.indexOf("onConfirmed(result.view)"));
      expect(child).toContain('{error && <p role="alert" className={styles.error}>{error}</p>}');
      expect(child).toContain('{warning && <p role="status" className={styles.warning}>{warning}</p>}');
    });

    it("renders the controlled warning once across revision views, then removes it when cleared (SSR only)", () => {
      const started = workoutView();
      const completed: SwimWorkoutView = { ...started, revision: 3, status: "completed", result: {
        lengths: 12, timeMs: 900123, stroke: "freestyle",
      } };
      for (const workout of [started, completed, { ...completed, deleted: true }]) {
        const render = (warning: string | null) => renderToStaticMarkup(
          <WorkoutClient key={`${workout.id}:${workout.revision}`} workout={workout} userId={userId}
            onConfirmed={() => {}} warning={warning} setWarning={() => {}} />,
        );
        const html = render(SWIM_REFRESH_WARNING);
        expect(html.split(SWIM_REFRESH_WARNING)).toHaveLength(2);
        expect(html).toMatch(new RegExp(`<p role="status"[^>]*>${SWIM_REFRESH_WARNING}</p>`));
        expect(html.indexOf(SWIM_REFRESH_WARNING)).toBeGreaterThan(html.lastIndexOf("</section>"));
        expect(render(null)).not.toContain(SWIM_REFRESH_WARNING);
      }
    });
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
