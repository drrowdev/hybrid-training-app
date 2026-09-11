import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";
import { JsxEmit, ModuleKind, transpileModule } from "typescript";
import * as React from "react";
import * as domain from "@hta/domain";
import * as draftModule from "../draft";
import * as timeModule from "../time";
import * as presentation from "../presentation";
import * as viewTypes from "../view-types";
import { isUuid } from "@/lib/offline/outbox-core";
import { renderToStaticMarkup } from "react-dom/server";
import { estimateCriticalSwimSpeed, validateSwimWorkout } from "@hta/domain";
import { generateSwimPlan } from "@hta/engine";
import { WorkoutClient } from "@/components/swim/WorkoutClient";
import { WorkoutScreen } from "@/components/swim/WorkoutScreen";
import { parseSetupForm } from "../forms";
import { standaloneWeekRequests } from "../model";
import { workoutPresentation } from "../presentation";
import { nextConfirmedView, nextEditMode, type SwimWorkoutView } from "../view-types";
import { initialSwimDraft, readSwimDraft } from "../draft";
import { SWIM_REFRESH_WARNING } from "../action-feedback";
import { swimFixture, userId, sessionId, receiptId } from "./fixtures";

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

function completionHarness(reply: object, refreshFails = false) {
  const states: Record<string, unknown[]> = { screen: [], client: [] };
  let scope = "screen", cursor = 0;
  let task: Promise<void> | undefined;
  let auto: ((value: object) => void) | undefined;
  const effects: (() => unknown)[] = [];
  const local = new Map<string, string>();
  const refresh = vi.fn(() => { if (refreshFails) throw new Error("Refresh unavailable"); });
  const enqueue = vi.fn(async () => ({ status: "stored" }));
  const hooks = {
    useCallback: (callback: unknown) => callback,
    useState(initial: unknown) {
      const index = cursor++;
      const slots = states[scope]!;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (next: unknown) => {
        slots[index] = typeof next === "function" ? next(slots[index]) : next;
      }];
    },
    useEffect(effect: () => unknown) { effects.push(effect); },
    useTransition: () => [false, (action: () => Promise<void>) => { task = action(); }],
  };
  const installed = createRequire(import.meta.url);
  function load(name: string, extra: Record<string, unknown> = {}) {
    const exports = {};
    const source = readFileSync(new URL(`../../../components/swim/${name}.tsx`, import.meta.url), "utf8");
    runInNewContext(transpileModule(source, {
      compilerOptions: { module: ModuleKind.CommonJS, jsx: JsxEmit.ReactJSX },
    }).outputText, {
      exports, FormData, queueMicrotask,
      localStorage: {
        getItem: (key: string) => local.get(key) ?? null,
        setItem: (key: string, value: string) => local.set(key, value),
        removeItem: (key: string) => local.delete(key),
      },
      require: (id: string) => ({
        react: hooks, "react/jsx-runtime": installed("react/jsx-runtime"),
        "next/navigation": { useRouter: () => ({ refresh, replace() {} }) },
        "next/link": { default: "a" }, "@hta/domain": domain,
        "@/components/trash/DeleteSessionButton": { DeleteSessionButton: () => null },
        "@/components/forms/RpeInput": { RpeInput: () => null },
        "@/lib/swim/actions": {}, "@/lib/swim/action-feedback": { SWIM_REFRESH_WARNING },
        "@/lib/offline/outbox": { enqueue, listForSession: async () => [], listDeadLettered: async () => [] },
        "@/lib/offline/outbox-core": { createOutboxEntryId: () => receiptId, isUuid },
        "@/lib/offline/flusher": {
          flushOutbox: async () => reply,
          startAutoFlush: (callback: typeof auto) => { auto = callback; return () => {}; },
        },
        "@/lib/swim/time": timeModule, "@/lib/swim/draft": draftModule,
        "@/lib/swim/presentation": presentation, "@/lib/swim/view-types": viewTypes,
        "./Swim.module.css": { default: {} }, "./SplitFields": { SplitFields: () => null },
        ...extra,
      })[id],
    });
    return exports as Record<string, (props: Record<string, unknown>) => React.ReactElement>;
  }
  const client = load("WorkoutClient");
  const screen = load("WorkoutScreen", { "./WorkoutClient": client });
  let incoming = workoutView();
  let tree: React.ReactElement;
  let childKey: string | null = null;
  function render() {
    scope = "screen"; cursor = 0;
    const child = screen.WorkoutScreen!({ workout: incoming, userId });
    if (child.key !== childKey) { states.client = []; childKey = child.key; }
    scope = "client"; cursor = 0; effects.length = 0;
    tree = client.WorkoutClient!(child.props as Record<string, unknown>);
    return renderToStaticMarkup(tree);
  }
  render();
  states.client![0] = { ...initialSwimDraft(incoming), lengths: "12", time: "15:00", notes: "Draft, not server" };
  states.client![1] = true;
  render();
  function findForm(node: React.ReactNode): React.ReactElement<{ onSubmit: (event: object) => void }> | undefined {
    if (!React.isValidElement<{ children?: React.ReactNode }>(node)) return;
    if (node.type === "form") return node as ReturnType<typeof findForm>;
    for (const child of React.Children.toArray(node.props.children)) {
      const found = findForm(child);
      if (found) return found;
    }
  }
  return {
    render, enqueue, refresh,
    async finish() {
      const form = findForm(tree)!;
      // Node FormData has no HTMLFormElement overload; the actual handler only reads confirmPool.
      form.props.onSubmit({ preventDefault() {}, currentTarget: undefined });
      await task;
      return render();
    },
    async replay() {
      states.client![0] = { ...states.client![0] as object, queuedId: receiptId };
      render();
      effects[2]!();
      await Promise.resolve(); await Promise.resolve();
      auto!(reply);
      return render();
    },
    async recoverAccepted() {
      local.set(draftModule.swimDraftKey(userId, incoming.id), JSON.stringify({
        ...initialSwimDraft(incoming), acceptedId: receiptId,
      }));
      effects[0]!();
      await Promise.resolve();
      render();
      effects[2]!();
      await Promise.resolve(); await Promise.resolve();
      return render();
    },
    incoming(view: SwimWorkoutView) { incoming = view; return render(); },
  };
}

describe("DC-SW8/DC-SW9 actual completion handler with held stale props (VM/SSR, not browser timing)", () => {
  it("restores an accepted receipt without a server result as explicit reload recovery, never silent success", async () => {
    const harness = completionHarness({});
    const html = await harness.recoverAccepted();
    expect(html).toContain(SWIM_REFRESH_WARNING);
    expect(html).not.toContain("Swim saved");
    expect(html).not.toContain("Edit result");
    expect(harness.enqueue).not.toHaveBeenCalled();
    expect(harness.incoming(completedView())).toContain("Edit result");
  });
  it.each(["finish", "replay"] as const)("shows the server result after %s before refreshed props arrive", async (path) => {
    const view = completedView();
    const harness = completionHarness({
      completedSessionIds: [sessionId], dropped: 0,
      swimCompletions: [{ receiptId, workoutId: view.id, sessionId, userId, view }],
    });
    const html = await harness[path]();
    expect(html).toContain("Your swim");
    expect(html).toContain("Edit result");
    expect(html).toContain("Original swim");
    expect(html).not.toContain("Draft, not server");
    expect(harness.incoming(workoutView())).toContain("Original swim");
    expect(harness.incoming(editedView())).toContain("Edited swim");
    expect(harness.enqueue).toHaveBeenCalledTimes(path === "finish" ? 1 : 0);
  });

  it.each(["finish", "replay"] as const)("retains the result and existing warning if router refresh throws after %s", async (path) => {
    const view = completedView();
    const harness = completionHarness({
      completedSessionIds: [sessionId],
      swimCompletions: [{ receiptId, workoutId: view.id, sessionId, userId, view }],
    }, true);
    const html = await harness[path]();
    expect(html).toContain("Edit result");
    expect(html).toContain(SWIM_REFRESH_WARNING);
    expect(html).not.toContain('role="alert"');
    expect(harness.enqueue).toHaveBeenCalledTimes(path === "finish" ? 1 : 0);
  });

  describe.each(["finish", "replay"] as const)("%s confirmation rejection", (path) => {
    it.each([
      "absent", "collection", "receipt", "owner", "session", "workout", "duplicate",
      "view", "result", "malformed", "revision", "view-session", "view-workout", "deleted", "warning",
    ])("requires reload without fabricated success or another write: %s", async (failure) => {
      const view = completedView();
      const confirmation = { receiptId, workoutId: view.id, sessionId, userId, view };
      let values: unknown = [confirmation];
      if (failure === "absent") values = undefined;
      if (failure === "collection") values = {};
      if (failure === "receipt") confirmation.receiptId = userId;
      if (failure === "owner") confirmation.userId = receiptId;
      if (failure === "session") confirmation.sessionId = receiptId;
      if (failure === "workout") confirmation.workoutId = receiptId;
      if (failure === "duplicate") values = [confirmation, confirmation];
      if (failure === "warning") Reflect.set(confirmation, "warning", {});
      if (failure === "view") Reflect.deleteProperty(confirmation, "view");
      if (failure === "result") view.result = null;
      if (failure === "malformed") Reflect.set(view, "steps", null);
      if (failure === "revision") view.revision = workoutView().revision;
      if (failure === "view-session") view.sessionId = receiptId;
      if (failure === "view-workout") view.id = receiptId;
      if (failure === "deleted") view.deleted = true;
      const harness = completionHarness({ completedSessionIds: [sessionId], swimCompletions: values });
      const html = await harness[path]();
      expect(html).toContain(SWIM_REFRESH_WARNING);
      expect(html).toContain('disabled=""');
      expect(html).not.toContain("Swim saved");
      expect(html).not.toContain("Edit result");
      expect(harness.incoming(workoutView())).toContain(SWIM_REFRESH_WARNING);
      expect(harness.enqueue).toHaveBeenCalledTimes(path === "finish" ? 1 : 0);
      expect(harness.incoming(completedView())).toContain("Edit result");
    });
  });
});

describe("DC-SW3 poolside workout controls", () => {
  it.each(["completed", "removed"] as const)("DC-SW5/DC-SW7 keeps the issued prescription identical after a swim is %s", (state) => {
    const scheduled: SwimWorkoutView = { ...workoutView(), sessionId: null, status: "scheduled" };
    const after: SwimWorkoutView = {
      ...completedView(), planStatus: "paused",
      ...(state === "removed" ? { sessionId: null, sourceGone: true, result: null } : {}),
    };
    const prescription = (workout: SwimWorkoutView) => {
      const html = renderToStaticMarkup(<WorkoutScreen workout={workout} userId={userId} />);
      const section = html.match(/<section\b[^>]*><h2>Workout<\/h2>[\s\S]*?<\/section>/)?.[0];
      expect(section).toBeDefined();
      return section;
    };
    expect(prescription(after)).toBe(prescription(scheduled));
  });
  it("puts the complete prescription before optional in-app start controls", () => {
    const workout: SwimWorkoutView = { ...workoutView(), sessionId: null, status: "scheduled" };
    const html = renderToStaticMarkup(<WorkoutScreen workout={workout} userId={userId} />);
    const start = html.match(/<button\b[^>]*>Start swim<\/button>/)?.[0];
    expect(start).toBeDefined();
    expect(start).toMatch(/class="[^"]*secondary/);
    expect(html.indexOf("</ol>")).toBeGreaterThan(0);
    expect(html.indexOf("</ol>")).toBeLessThan(html.indexOf(start!));
    expect(html).not.toContain('id="swim-result"');
  });
  it("A7 DC-SW7/DC-SW9: retained Notes match the pinned textbox engine, not the exact label engine (SSR only)", () => {
    const installed = createRequire(import.meta.url);
    const playwrightTest = createRequire(installed.resolve("@playwright/test/package.json"));
    const playwright = createRequire(playwrightTest.resolve("playwright/package.json"));
    const core = playwright.resolve("playwright-core/package.json");
    expect(playwright(core).version).toBe("1.60.0");
    expect(installed("react-dom/package.json").version).toBe("19.2.4");
    const bundle = readFileSync(join(dirname(core), "lib/coreBundle.js"), "utf8");
    const injectedLiteral = bundle.match(/^    source3 = ('.*');$/m)?.[1];
    expect(injectedLiteral).toBeDefined();
    const injected = runInNewContext(injectedLiteral!);

    // Use the already-installed Capacitor → plist DOM parser, without adding a dependency.
    const mobile = createRequire(new URL("../../../../../mobile/package.json", import.meta.url));
    const capacitor = createRequire(mobile.resolve("@capacitor/cli/package.json"));
    const plist = createRequire(capacitor.resolve("plist/package.json"));
    const { DOMParser } = plist("@xmldom/xmldom") as {
      DOMParser: new () => { parseFromString: (html: string, mime: string) => Document };
    };
    const retained = readSwimDraft(JSON.stringify({
      ...initialSwimDraft(workoutView()), lengths: "12", time: "15:00", rpe: "6",
      notes: "Synthetic retained swim draft",
    }))!;
    expect(retained.notes).toBe("Synthetic retained swim draft");
    const render = (notes: string) => renderToStaticMarkup(
      <WorkoutClient workout={{ ...workoutView(), notes }} userId={userId}
        onConfirmed={() => {}} warning={null} setWarning={() => {}} />,
    );
    for (const notes of ["", retained.notes]) {
      const markup = render(notes).match(/<label\b[^>]*>Notes<textarea\b[^>]*>[\s\S]*?<\/textarea><\/label>/)?.[0];
      expect(markup).toBeDefined();
      const document = new DOMParser().parseFromString(markup!, "text/html");
      const label = document.documentElement;
      const textarea = document.getElementsByTagName("textarea")[0]!;
      // XML DOM supplies the rendered tree; adapt only the HTML surface used here.
      // The isolated label models an open disclosure, not browser layout or hydration.
      for (const element of [label, textarea]) {
        Object.defineProperties(element, {
          nodeName: { value: element.tagName.toUpperCase() },
          parentElement: { get: () => element.parentNode?.nodeType === 1 ? element.parentNode : null },
          closest: { value: (selector: string) => {
            expect(selector).toBe("details,summary");
            return null;
          } },
        });
      }
      Object.defineProperties(textarea, {
        labels: { value: [label] },
        value: { get: () => textarea.textContent },
      });
      Object.defineProperties(document, {
        defaultView: { value: { getComputedStyle: () => ({ display: "inline", visibility: "visible", content: "normal" }) } },
        querySelectorAll: { value: (selector: string) => {
          expect(selector).toBe("*");
          return document.getElementsByTagName("*");
        } },
      });
      const selectors = runInNewContext(`${injected}
        const evaluator = { _cacheText: new Map(), _queryCSS: ({ scope }, css) => scope.querySelectorAll(css) };
        ({
          label: InjectedScript.prototype._createInternalLabelEngine.call({ _evaluator: evaluator }),
          role: createRoleEngine(true)
        });
      `, {
        module: { exports: {} }, Node: { TEXT_NODE: 3, COMMENT_NODE: 8, ELEMENT_NODE: 1 },
        Element: label.constructor, HTMLInputElement: class {},
      }) as Record<"label" | "role", { queryAll: (root: Document, selector: string) => HTMLTextAreaElement[] }>;
      expect(selectors.label.queryAll(document, '"Notes"s')).toEqual(notes ? [] : [textarea]);
      const stable = selectors.role.queryAll(document, 'textbox[name="Notes"s]');
      expect(stable).toEqual([textarea]);
      expect(stable[0]!.value).toBe(notes);
      expect(selectors.role.queryAll(document, 'textbox[name="Other"s]')).toEqual([]);
    }
    const source = readFileSync(new URL("../../../../e2e/swimming-lifecycle-load-mobile.spec.ts", import.meta.url), "utf8");
    const a7 = source.slice(source.indexOf('  test("A7,'));
    expect(a7.match(/page\.getByRole\("textbox", \{ name: "Notes", exact: true \}\)/g) ?? []).toHaveLength(2);
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
