import { beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { generateSwimPlan } from "@hta/engine";
import { SetupForm } from "@/components/swim/SetupForm";
import { createSwimPlan, previewSwimPlan } from "../actions";
import { planPreviewPresentation } from "../presentation";
import { standaloneWeekRequests } from "../model";
import { planId, swimFixture } from "./fixtures";

const harness = vi.hoisted(() => ({
  states: [] as unknown[], cursor: 0, pending: false,
  task: undefined as Promise<void> | undefined, push: vi.fn(), refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: harness.push, refresh: harness.refresh }) }));
vi.mock("../actions", () => ({ createSwimPlan: vi.fn(), previewSwimPlan: vi.fn() }));
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
  useTransition: () => [harness.pending, (fn: () => Promise<void>) => { harness.task = fn(); }],
}));

function preview() {
  const generated = generateSwimPlan({
    setup: swimFixture().plan.definition.setup, calibration: null,
    weeks: standaloneWeekRequests("2026-09-07", 3, [1, 4]),
  });
  if (!generated.ok) throw new Error(generated.error.message);
  return planPreviewPresentation(generated.value);
}

type FormHandlers = {
  onSubmit: (event: { preventDefault(): void; currentTarget: undefined; nativeEvent?: { submitter: { getAttribute(name: string): string | null } | null } }) => void;
  onChange: () => void;
};
function form() {
  harness.cursor = 0;
  return SetupForm({ today: "2026-09-07" }) as React.ReactElement<FormHandlers>;
}
function html() { return renderToStaticMarkup(form()); }
function submit(mode: "preview" | "create") {
  // Node FormData cannot read an HTMLFormElement; action input validation has separate real-FormData coverage.
  form().props.onSubmit({
    preventDefault() {}, currentTarget: undefined,
    nativeEvent: { submitter: mode === "preview" ? { getAttribute: (name) => name === "value" ? "preview" : null } : null },
  });
  return harness.task!;
}
function elements(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  if (!React.isValidElement<{ children?: React.ReactNode }>(node)) return [];
  return [node, ...React.Children.toArray(node.props.children).flatMap(elements)];
}

beforeEach(() => {
  harness.states = []; harness.cursor = 0; harness.task = undefined; harness.pending = false;
  vi.clearAllMocks();
  vi.mocked(previewSwimPlan).mockResolvedValue({ ok: true, preview: preview() });
  vi.mocked(createSwimPlan).mockResolvedValue({ ok: true, planId });
});

describe("DC-SW3 read-only setup review", () => {
  it("renders every week, date and structured step without saving or starting a workout", async () => {
    await submit("preview");
    const markup = html();
    expect(markup).toContain('aria-labelledby="swim-plan-preview-title"');
    expect((markup.match(/class="[^"]*previewWeek[^"]*"/g) ?? [])).toHaveLength(3);
    for (const week of preview().weeks) {
      for (const workout of week.workouts) {
        expect(markup).toContain(workout.date);
        for (const step of workout.steps) {
          expect(markup).toContain(step.title);
          expect(markup).toContain(step.effort);
          expect(markup).toContain(step.rest);
        }
      }
    }
    expect(createSwimPlan).not.toHaveBeenCalled();
    expect(harness.push).not.toHaveBeenCalled();
    expect(harness.refresh).not.toHaveBeenCalled();
    expect(elements(form()).filter((element) => element.type === "button")).toHaveLength(2);
  });
  it("invalidates the preview on any setup edit and allows a new preview", async () => {
    await submit("preview");
    const changePool = elements(form()).find((element) => element.props.name === "pool")!.props.onChange;
    if (typeof changePool !== "function") throw new Error("Missing pool control");
    changePool({ target: { value: "custom" } });
    form().props.onChange();
    expect(html()).not.toContain('aria-labelledby="swim-plan-preview-title"');
    await submit("preview");
    expect(html()).toContain('aria-labelledby="swim-plan-preview-title"');
    expect(elements(form()).find((element) => element.props.name === "pool")!.props.value).toBe("custom");
    expect(elements(form()).some((element) => element.props.name === "poolLength" && element.props.required === true)).toBe(true);
    expect(previewSwimPlan).toHaveBeenCalledTimes(2);
    expect(createSwimPlan).not.toHaveBeenCalled();
  });
  it.each(["success", "error", "rejected"] as const)("ignores an obsolete %s preview response after an edit", async (outcome) => {
    let resolve!: (reply: Awaited<ReturnType<typeof previewSwimPlan>>) => void;
    let reject!: (error: Error) => void;
    vi.mocked(previewSwimPlan).mockReturnValueOnce(new Promise((done, failed) => { resolve = done; reject = failed; }));
    const pending = submit("preview");
    form().props.onChange();
    if (outcome === "rejected") reject(new Error("Unavailable"));
    else resolve(outcome === "success" ? { ok: true, preview: preview() } : { error: "Try a different setup." });
    await pending;
    expect(html()).not.toContain('aria-labelledby="swim-plan-preview-title"');
    expect(html()).not.toContain('role="alert"');
    expect(createSwimPlan).not.toHaveBeenCalled();
  });
  it("does not let an older preview replace a more recent request", async () => {
    let resolve!: (reply: Awaited<ReturnType<typeof previewSwimPlan>>) => void;
    vi.mocked(previewSwimPlan).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const older = submit("preview");
    await submit("preview");
    resolve({ error: "Older request failed." });
    await older;
    expect(html()).toContain('aria-labelledby="swim-plan-preview-title"');
    expect(html()).not.toContain('role="alert"');
  });
  it("retains direct creation and creation after preview as the only save actions", async () => {
    await submit("create");
    expect(createSwimPlan).toHaveBeenCalledOnce();
    expect(previewSwimPlan).not.toHaveBeenCalled();
    expect(harness.push).toHaveBeenCalledWith(`/app/swim?plan=${planId}`);
    await submit("preview");
    expect(createSwimPlan).toHaveBeenCalledOnce();
    await submit("create");
    expect(createSwimPlan).toHaveBeenCalledTimes(2);
  });
  it("surfaces validation, learning guidance and transport failures without a success preview", async () => {
    vi.mocked(previewSwimPlan).mockResolvedValueOnce({ error: "Adjust the schedule.", options: ["Choose another day."] });
    await submit("preview");
    expect(html()).toContain('role="alert"');
    expect(html()).not.toContain('aria-labelledby="swim-plan-preview-title"');
    vi.mocked(previewSwimPlan).mockResolvedValueOnce({ guidance: "Practice short supported swims." });
    await submit("preview");
    expect(html()).toContain('role="status"');
    expect(html()).not.toContain('role="alert"');
    vi.mocked(previewSwimPlan).mockRejectedValueOnce(new Error("Unavailable"));
    await submit("preview");
    expect(html()).toContain('role="alert"');
    expect(createSwimPlan).not.toHaveBeenCalled();
  });
  it("disables both submit controls while preparing a preview", async () => {
    const pending = submit("preview");
    harness.pending = true;
    const buttons = elements(form()).filter((element) => element.type === "button");
    expect(buttons).toHaveLength(2);
    expect(buttons.every((button) => button.props.disabled === true)).toBe(true);
    expect(buttons.find((button) => button.props.value !== "preview")!.props.children).toBe("Create swim plan");
    await pending;
  });
});
