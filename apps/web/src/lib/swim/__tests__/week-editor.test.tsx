import { beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { generateSwimPlan } from "@hta/engine";
import { WeekEditor } from "@/components/swim/WeekEditor";
import { DateEditor } from "@/components/swim/DateEditor";
import { previewSwimWeekEdit, previewSwimDateEdit } from "../actions";
import { planPreviewPresentation } from "../presentation";
import { standaloneWeekRequests } from "../model";
import { planId, swimFixture } from "./fixtures";
import type { SwimDateEditPreview, SwimHubView, SwimWeekEditPreview } from "../view-types";

const harness = vi.hoisted(() => ({
  states: [] as unknown[], cursor: 0, task: undefined as Promise<void> | undefined,
}));
vi.mock("../actions", () => ({ previewSwimWeekEdit: vi.fn(), previewSwimDateEdit: vi.fn() }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useRef: (initial: unknown) => {
    const index = harness.cursor++;
    if (!(index in harness.states)) harness.states[index] = { current: initial };
    return harness.states[index];
  },
  useState: (initial: unknown) => {
    const index = harness.cursor++;
    if (!(index in harness.states)) harness.states[index] = typeof initial === "function" ? initial() : initial;
    return [harness.states[index], (next: unknown) => {
      harness.states[index] = typeof next === "function" ? next(harness.states[index]) : next;
    }];
  },
  useTransition: () => [false, (fn: () => Promise<void>) => { harness.task = fn(); }],
}));

function preview(): SwimWeekEditPreview {
  const generated = generateSwimPlan({
    setup: swimFixture().plan.definition.setup, calibration: null,
    weeks: standaloneWeekRequests("2026-09-14", 1, [1, 4]),
  });
  if (!generated.ok) throw new Error(generated.error.message);
  return {
    planId, revision: 1, id: "reviewed-change", week: 2, mainRepeats: 5,
    reason: "Shorter pool visit.", warning: "This differs from the suggested week.",
    excludedCount: 0, changes: [{ date: "2026-09-14", before: "600 yd", after: "550 yd" }],
    plan: planPreviewPresentation(generated.value),
  };
}

function elements(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  if (!React.isValidElement<{ children?: React.ReactNode }>(node)) return [];
  return [node, ...React.Children.toArray(node.props.children).flatMap(elements)];
}
function editor() {
  const plan: SwimHubView = {
    id: planId, revision: 1, status: "active", today: "2026-09-12",
    goal: "Technique & base", course: "25 yd", dates: "2026-09-07 – 2026-09-27",
    workouts: [], proposals: [], analytics: { weeks: [], bests: [], benchmarks: [] },
    editableWeeks: [{ week: 2, mainRepeats: 5, workoutCount: 2 }, { week: 3, mainRepeats: 4, workoutCount: 1 }],
  };
  const onApply = vi.fn();
  let busy = false;
  const tree = () => { harness.cursor = 0; return WeekEditor({ plan, busy, onApply }); };
  const form = () => elements(tree()).find((element) => element.type === "form")!;
  function invoke(node: React.ReactElement<Record<string, unknown>>, handler: string, event?: object) {
    const callback = node.props[handler];
    if (typeof callback !== "function") throw new Error(`Missing ${handler}`);
    callback(event);
  }
  return {
    onApply, plan,
    html: () => renderToStaticMarkup(tree()),
    async review() {
      invoke(form(), "onSubmit", { preventDefault() {}, currentTarget: undefined });
      await harness.task;
    },
    change(name: string, value: string) {
      invoke(elements(tree()).find((element) => element.props.name === name)!, "onChange", { target: { value } });
      invoke(form(), "onChange");
    },
    apply() {
      const button = elements(tree()).find((element) => element.type === "button" && element.props.type === "button")!;
      expect(button.props.disabled).not.toBe(true);
      invoke(button, "onClick");
    },
    setBusy(value: boolean) { busy = value; },
    buttons: () => elements(tree()).filter((element) => element.type === "button"),
  };
}

beforeEach(() => {
  harness.states = []; harness.cursor = 0; harness.task = undefined;
  vi.clearAllMocks();
  vi.mocked(previewSwimWeekEdit).mockResolvedValue({ ok: true, preview: preview() });
});

describe("DC-K4/DC-SW5 manual future-week review", () => {
  it("shows a read-only before/after preview and applies only on explicit confirmation", async () => {
    const flow = editor();
    expect(flow.buttons()).toHaveLength(1);
    await flow.review();
    expect(flow.onApply).not.toHaveBeenCalled();
    expect(flow.html()).toContain("600 yd");
    expect(flow.html()).toContain("550 yd");
    expect(flow.html()).toContain('role="status"');
    expect(flow.html()).toContain('aria-labelledby="swim-plan-preview-title"');
    flow.apply();
    expect(flow.onApply).toHaveBeenCalledWith(preview());
  });

  describe("DC-K4/DC-SW5 date review controls", () => {
    function dateEditor() {
      const { plan } = editor();
      const workout: SwimHubView["workouts"][number] = {
        id: swimFixture().workouts[2]!.id, date: "2026-09-14", title: "Pool swim", total: "600 yd",
        week: 2, provisional: true, status: "Scheduled", reschedule: { revision: 1, min: "2026-09-14", max: "2026-09-20" },
      };
      const onApply = vi.fn();
      const preview: SwimDateEditPreview = {
        id: "date-preview", planId, revision: 1, workoutId: workout.id, workoutRevision: 1,
        date: "2026-09-15", previousDate: "2026-09-14", reason: "Pool access changed.",
        warnings: ["Strength training is scheduled on this day."],
      };
      vi.mocked(previewSwimDateEdit).mockResolvedValue({ ok: true, preview });
      const tree = (busy = false) => { harness.cursor = 0; return DateEditor({ plan, workout, busy, onApply }); };
      function formHandler(handler: string) {
        const callback = elements(tree()).find((entry) => entry.type === "form")!.props[handler];
        if (typeof callback !== "function") throw new Error("Missing form handler");
        return callback;
      }
      return {
        plan, workout, preview, onApply, tree,
        async review() {
          formHandler("onSubmit")({ preventDefault() {}, currentTarget: undefined });
          await harness.task;
        },
        edit: () => formHandler("onChange")(),
        html: () => renderToStaticMarkup(tree()),
      };
    }
    it("shows the allowed dates, previews conflicts and waits for explicit confirmation", async () => {
      const flow = dateEditor();
      expect(flow.html()).toContain('min="2026-09-14"');
      expect(flow.html()).toContain('max="2026-09-20"');
      await flow.review();
      expect(flow.onApply).not.toHaveBeenCalled();
      expect(flow.html()).toContain('role="status"');
      const confirm = elements(flow.tree()).find((entry) => entry.type === "button" && entry.props.type === "button")!;
      if (typeof confirm.props.onClick !== "function") throw new Error("Missing confirmation");
      confirm.props.onClick();
      expect(flow.onApply).toHaveBeenCalledWith(flow.preview);
      flow.edit();
      expect(elements(flow.tree()).filter((entry) => entry.type === "button")).toHaveLength(1);
    });
    it("ignores a late date response after an edit and disables controls during mutations", async () => {
      const flow = dateEditor();
      let finish!: (value: Awaited<ReturnType<typeof previewSwimDateEdit>>) => void;
      vi.mocked(previewSwimDateEdit).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
      const request = flow.review();
      flow.edit();
      finish({ ok: true, preview: flow.preview });
      await request;
      expect(elements(flow.tree()).filter((entry) => entry.type === "button")).toHaveLength(1);
      expect(elements(flow.tree(true)).filter((entry) => entry.type === "button").every((entry) => entry.props.disabled)).toBe(true);
    });
    it("has no date editor for inactive or ineligible work", () => {
      const flow = dateEditor();
      flow.plan.status = "paused";
      expect(flow.html()).toBe("");
      flow.plan.status = "active";
      delete flow.workout.reschedule;
      expect(flow.html()).toBe("");
    });
  });
  it("clears an old preview when editing repeats or choosing a different week", async () => {
    const flow = editor();
    await flow.review();
    flow.change("repeats", "3");
    expect(flow.buttons()).toHaveLength(1);
    await flow.review();
    expect(previewSwimWeekEdit).toHaveBeenLastCalledWith(expect.objectContaining({ week: 2, mainRepeats: 3 }));
    flow.change("week", "3");
    expect(flow.buttons()).toHaveLength(1);
    await flow.review();
    expect(previewSwimWeekEdit).toHaveBeenLastCalledWith(expect.objectContaining({ week: 3, mainRepeats: 4 }));
  });
  it("rejects a late preview after its inputs were changed", async () => {
    const flow = editor();
    let finish!: (value: Awaited<ReturnType<typeof previewSwimWeekEdit>>) => void;
    vi.mocked(previewSwimWeekEdit).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const request = flow.review();
    flow.change("repeats", "2");
    finish({ ok: true, preview: preview() });
    await request;
    expect(flow.buttons()).toHaveLength(1);
    expect(flow.onApply).not.toHaveBeenCalled();
  });
  it("surfaces validation and transport failure without enabling apply", async () => {
    const flow = editor();
    vi.mocked(previewSwimWeekEdit).mockResolvedValueOnce({ error: "This week changed." });
    await flow.review();
    expect(flow.html()).toContain('role="alert"');
    expect(flow.buttons()).toHaveLength(1);
    vi.mocked(previewSwimWeekEdit).mockRejectedValueOnce(new Error("Unavailable"));
    await flow.review();
    expect(flow.html()).toContain('role="alert"');
    expect(flow.buttons()).toHaveLength(1);
  });
  it("disables review, confirmation and form fields during a plan mutation", async () => {
    const flow = editor();
    await flow.review();
    flow.setBusy(true);
    expect(flow.buttons().every((button) => button.props.disabled === true)).toBe(true);
    expect(flow.html()).toContain('<fieldset class="');
    expect(flow.html()).toContain('disabled=""');
    expect(flow.onApply).not.toHaveBeenCalled();
  });
  it("has no editor when there are no eligible weeks", () => {
    const flow = editor();
    flow.plan.editableWeeks = [];
    expect(flow.html()).toBe("");
  });
});
