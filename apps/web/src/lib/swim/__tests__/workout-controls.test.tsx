import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { estimateCriticalSwimSpeed, validateSwimWorkout } from "@hta/domain";
import { generateSwimPlan } from "@hta/engine";
import { WorkoutClient } from "@/components/swim/WorkoutClient";
import { WorkoutScreen } from "@/components/swim/WorkoutScreen";
import { parseSetupForm } from "../forms";
import { standaloneWeekRequests } from "../model";
import { workoutPresentation } from "../presentation";
import { nextConfirmedView, nextEditMode, type SwimWorkoutView } from "../view-types";
import { initialSwimDraft } from "../draft";
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

function completedView(): SwimWorkoutView {
  return {
    ...workoutView(), revision: 3, status: "completed", notes: "Original swim",
    result: {
      lengths: 12, timeMs: 900123, rpe: 6, notes: "Original swim", splits: "",
      stroke: "freestyle", strokes: ["freestyle"], equipment: [],
      course: "25 yd", distance: "300 yd", pool: workoutView().pool,
    },
  };
}

function editedView(): SwimWorkoutView {
  return {
    ...completedView(), revision: 4, notes: "Edited swim",
    result: {
      ...completedView().result!, lengths: 14, timeMs: 840456, rpe: 7, notes: "Edited swim",
      stroke: "backstroke", strokes: ["backstroke"], equipment: ["fins"], distance: "350 yd",
    },
  };
}

describe("DC-SW3 poolside workout controls", () => {
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
    const html = renderToStaticMarkup(<main><WorkoutScreen workout={view} userId={userId} /></main>);
    const summary = html.match(/^<main><section\b[^>]*>([\s\S]*?)<\/section>/)?.[1];
    expect(summary).toBeDefined();
    expect(view.course).toBe("50 m");
    expect(html.split(`>${view.course}<`).length - 1).toBeGreaterThan(1);
    expect(summary!.split(`>${view.course}<`).length - 1).toBe(1);
  });

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

    it.each(["props-first", "reply-first"] as const)("closes the query episode on effective revision advance, %s (pure transitions)", (order) => {
      const original = completedView();
      const edited = editedView();
      let held = original;
      let mode = nextEditMode(null, true, held.revision);
      expect(mode).toEqual({ intent: 3, open: true });
      const arrivals: [SwimWorkoutView, "props" | "confirmed"][] = order === "props-first"
        ? [[edited, "props"], [edited, "confirmed"], [original, "props"]]
        : [[edited, "confirmed"], [original, "props"], [edited, "props"]];
      for (const [incoming, source] of arrivals) {
        held = nextConfirmedView(held, incoming, source);
        mode = nextEditMode(mode.intent, true, held.revision);
        expect(held).toBe(edited);
        expect(mode).toEqual({ intent: 3, open: false });
        expect(`${held.id}:${held.revision}`).not.toBe(`${original.id}:${original.revision}`);
      }
      // Matching refreshed props must not begin another query episode.
      held = nextConfirmedView(held, { ...edited }, "props");
      expect(nextEditMode(mode.intent, true, held.revision)).toEqual({ intent: 3, open: false });
      mode = nextEditMode(mode.intent, false, held.revision);
      expect(mode).toEqual({ intent: null, open: false });
      const key = `${held.id}:${held.revision}`;
      mode = nextEditMode(mode.intent, true, held.revision);
      expect(mode).toEqual({ intent: 4, open: true });
      expect(`${held.id}:${held.revision}`).toBe(key);
      expect(nextEditMode(mode.intent, true, held.revision)).toEqual(mode);
      expect(nextEditMode(mode.intent, false, held.revision)).toEqual({ intent: null, open: false });
    });

    it("closes query editing on external props, not only a locally confirmed reply (pure transitions)", () => {
      const original = completedView();
      const intent = nextEditMode(null, true, original.revision).intent;
      const incoming = editedView();
      const effective = nextConfirmedView(original, incoming, "props");
      expect(effective.revision).toBe(incoming.revision);
      expect(nextEditMode(intent, true, effective.revision)).toEqual({ intent: 3, open: false });
    });

    it("keeps no-query and stable renders unchanged, and clears/re-enters at the same revision (pure transitions)", () => {
      let held = completedView();
      expect(nextEditMode(null, false, held.revision)).toEqual({ intent: null, open: false });
      held = nextConfirmedView(held, editedView(), "confirmed");
      expect(nextEditMode(null, false, held.revision)).toEqual({ intent: null, open: false });
      const open = nextEditMode(null, true, held.revision);
      expect(nextEditMode(open.intent, true, held.revision)).toEqual(open);
      const equalProps = nextConfirmedView(held, { ...held, planStatus: "archived" }, "props");
      expect(nextEditMode(open.intent, true, equalProps.revision)).toEqual(open);
      const cleared = nextEditMode(open.intent, false, equalProps.revision);
      expect(cleared).toEqual({ intent: null, open: false });
      expect(nextEditMode(cleared.intent, true, equalProps.revision)).toEqual(open);
    });

    it.each<{ error?: string; errorCode?: string; ok?: boolean; warning?: string; view?: SwimWorkoutView }>([
      { error: "Recompute unavailable", errorCode: "transient" },
      { ok: true, warning: SWIM_REFRESH_WARNING },
    ])("retains revision and intent without a reply view, then closes on updated props: %j (pure transitions)", (reply) => {
      const original = completedView();
      const open = nextEditMode(null, true, original.revision);
      expect(reply).not.toHaveProperty("view");
      const confirmed = reply.view ? nextConfirmedView(original, reply.view, "confirmed") : original;
      expect(confirmed).toBe(original);
      const unchanged = nextConfirmedView(confirmed, { ...original }, "props");
      expect(unchanged.revision).toBe(original.revision);
      expect(nextEditMode(open.intent, true, unchanged.revision)).toEqual(open);
      const effective = nextConfirmedView(unchanged, editedView(), "props");
      expect(nextEditMode(open.intent, true, effective.revision)).toEqual({ intent: 3, open: false });
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
      expect(owner).toContain('return <WorkoutClient key={`${effective.id}:${effective.revision}`} workout={effective} userId={userId} edit={mode.open}');
      expect(owner).toContain("const [editIntent, setEditIntent] = useState<number | null>(null)");
      expect(owner).toContain("const mode = nextEditMode(editIntent, edit, effective.revision)");
      expect(owner).toContain("if (mode.intent !== editIntent) setEditIntent(mode.intent)");
      expect(owner.indexOf("const [editIntent")).toBeLessThan(owner.indexOf("return <WorkoutClient"));
      expect(owner).not.toContain("incomingWorkout.revision");
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

    it("retains strict success checks, Start/edit warning clears and confirmation before refresh (source contract)", () => {
      const start = child.slice(child.indexOf("function start()"), child.indexOf("function submit("));
      const submit = child.slice(child.indexOf("function submit("), child.indexOf("const completed ="));
      const edit = submit.slice(submit.indexOf("const result = await editSwimResult"), submit.indexOf("const existing ="));
      for (const action of [start, submit]) {
        expect(action).toContain("setError(null)");
        expect(action).toContain("setWarning(null)");
        expect(action).toContain("if (!result || result.ok !== true || result.error || result.errorCode)");
        expect(action).toContain("setWarning(result.warning ?? null)");
        expect(action).toContain("catch { setWarning(SWIM_REFRESH_WARNING); }");
      }
      for (const action of [start, edit]) {
        expect(action).toContain("if (result.view) onConfirmed(result.view)");
        expect(action.indexOf("setWarning(result.warning ?? null)")).toBeLessThan(action.indexOf("onConfirmed(result.view)"));
        expect(action.indexOf("onConfirmed(result.view)")).toBeLessThan(action.indexOf("router.refresh()"));
        expect(action).toMatch(/if \(!result \|\| result.ok !== true \|\| result.error \|\| result.errorCode\) \{\s*setError\([^\n]+\);\s*return;\s*\}/);
      }
      expect(child).toContain("onConfirmed: (view: SwimWorkoutView) => void");
      expect(edit).toMatch(/if \(result.view\) onConfirmed\(result.view\);\s*setEditing\(false\);\s*setSync\("saved"\);/);
      expect(edit).toContain("router.replace(`/app/swim/${workout.id}`)");
      expect(edit.indexOf("setSync")).toBeLessThan(edit.indexOf("router.replace"));
      expect(edit.indexOf("router.replace")).toBeLessThan(edit.indexOf("router.refresh"));
      expect(child).toContain('{error && <p role="alert" className={styles.error}>{error}</p>}');
      expect(child).toContain('{warning && <p role="status" className={styles.warning}>{warning}</p>}');
    });

    it("bridges false→true and true→false only on a changed edit prop, preserving native same-prop editing (source contract)", () => {
      const bridge = child.slice(child.indexOf("const [editing, setEditing]"), child.indexOf("useEffect(() =>"));
      expect(bridge.trim()).toBe([
        "const [editing, setEditing] = useState(edit);",
        "  const [previousEdit, setPreviousEdit] = useState(edit);",
        "  if (edit !== previousEdit) {",
        "    setPreviousEdit(edit);",
        "    setEditing(edit);",
        "  }",
      ].join("\n"));
      expect(child.match(/setEditing\(edit\)/g)).toHaveLength(1);
      expect(child).toContain("onClick={() => setEditing(true)}>Edit result</button>");
      expect(child).toContain("onClick={() => { setDraft(initialSwimDraft(workout)); setEditing(false); }}>Cancel</button>");
      expect(owner.match(/\bkey=/g)).toHaveLength(1);
      expect(owner).not.toMatch(/useEffect|queueMicrotask|useCallback|useRef|useRouter/);
      expect(bridge).not.toMatch(/setDraft|setSync|setReady|setWarning/);
    });

    it("renders the controlled warning once across revision views, then removes it when cleared (SSR only)", () => {
      const started = workoutView();
      const completed: SwimWorkoutView = { ...started, revision: 3, status: "completed", result: {
        lengths: 12, timeMs: 900123, stroke: "freestyle",
      } };
      for (const workout of [started, completed, editedView(), { ...completed, deleted: true }]) {
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

    it.each(["native", "query"] as const)("renders the confirmed %s summary and a later editor with canonical values (pure/SSR only)", (entry) => {
      const original = completedView();
      const held = nextConfirmedView(original, editedView(), "confirmed");
      const intent = nextEditMode(null, entry === "query", original.revision).intent;
      const closed = nextEditMode(intent, entry === "query", held.revision);
      expect(closed.open).toBe(false);
      const render = (edit: boolean) => renderToStaticMarkup(
        <WorkoutClient key={`${held.id}:${held.revision}`} workout={held} userId={userId} edit={edit}
          onConfirmed={() => {}} warning={SWIM_REFRESH_WARNING} setWarning={() => {}} />,
      );
      const summary = render(closed.open);
      expect(summary).not.toContain('id="swim-result"');
      expect(summary).toContain(">Edit result</button>");
      expect(summary).toContain("14 lengths · 14:00.456 · RPE 7");
      expect(summary).toContain("Edited swim");
      expect(summary).not.toContain("Original swim");
      expect(summary.split(SWIM_REFRESH_WARNING)).toHaveLength(2);
      const cleared = nextEditMode(closed.intent, false, held.revision);
      const later = nextEditMode(cleared.intent, true, held.revision);
      const form = render(later.open);
      expect(form).toContain('id="swim-result"');
      expect(form).not.toContain(">Edit result</button>");
      expect(form).toMatch(/Whole lengths<input[^>]*value="14"/);
      expect(form).toMatch(/Time · min:sec<input[^>]*value="14:00.456"/);
      expect(form).toContain('data-context="cardio" data-value="7"');
      expect(form).toMatch(/Notes<textarea[^>]*>Edited swim<\/textarea>/);
      expect(form).toContain('<option value="planned" selected="">Backstroke</option>');
      expect(form).toMatch(/<input type="checkbox" checked=""\/>Fins/);
      expect(form.split(SWIM_REFRESH_WARNING)).toHaveLength(2);
      expect(initialSwimDraft(held)).toMatchObject({
        lengths: "14", time: "14:00.456", rpe: "7", notes: "Edited swim",
        stroke: "planned", equipment: ["fins"], pool: "planned",
      });
    });

    it("opens the completed editor for equal-revision query entry on SSR", () => {
      const workout = editedView();
      const html = renderToStaticMarkup(<WorkoutScreen workout={workout} userId={userId} edit />);
      expect(html).toContain('id="swim-result"');
      expect(html).toMatch(/Whole lengths<input[^>]*value="14"/);
      expect(html).not.toContain(">Edit result</button>");
      expect(renderToStaticMarkup(<WorkoutScreen workout={workout} userId={userId} />)).not.toContain('id="swim-result"');
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
