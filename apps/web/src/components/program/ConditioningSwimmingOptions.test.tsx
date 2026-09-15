import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { syntheticCourse } from "@/lib/swim/__tests__/course-fixtures";
import {
  ConditioningSwimmingOptions, initialConditioningSwimDraft, prepareConditioningSwimDraft,
  type ConditioningSwimDraft,
} from "./ConditioningSwimmingOptions";

const draft = (): ConditioningSwimDraft => ({
  ...initialConditioningSwimDraft(), source: syntheticCourse(),
  fields: {
    pool: "50m", poolLength: "", experience: "regular", comfortableLengths: "4",
    strokes: ["freestyle"], equipment: [], poolLengths: {},
  },
});
const prepare = (value: ConditioningSwimDraft, date = "2026-09-14", days = [0, 3]) =>
  prepareConditioningSwimDraft(value, date, days, []);
const reviewed = () => {
  const value = draft();
  const key = prepare(value).course!.key;
  return { ...value, previewKey: key, confirmedKey: key };
};

describe("inline swimming draft", () => {
  it("DC-SW3 compiles the existing source against the primary schedule without a time budget", () => {
    const result = prepare(draft());
    expect(result.error).toBeNull();
    expect(result.input).toBeNull();
    expect(result.course?.plan.workouts.map((row) => row.scheduled_date)).toEqual(["2026-09-14", "2026-09-17", "2026-09-21"]);
    expect(result.course?.plan.definition.setup.sessionBudgetMinutes).toBeNull();
  });

  it("DC-SW5 requires a current review and invalidates it after dates or pool choices change", () => {
    const value = reviewed();
    expect(prepare(value).input?.kind).toBe("course");
    expect(prepare(value, "2026-09-21").input).toBeNull();
    expect(prepare(value, "2026-09-14", [1, 4]).input).toBeNull();
    expect(prepare({ ...value, fields: { ...value.fields, pool: "25m" } }).input).toBeNull();
  });

  it("DC-K4 requires an explicit decision when source totals disagree with the sets", () => {
    const source = structuredClone(syntheticCourse());
    const value = { ...draft(), source: {
      ...source, weeks: source.weeks.map((week, index) => index === 0
        ? { ...week, workouts: week.workouts.map((workout) => ({ ...workout, reportedDistanceMetres: 999 })) }
        : week),
    } };
    const key = prepare(value).course!.key;
    const confirmed = { ...value, previewKey: key, confirmedKey: key };
    expect(prepare(confirmed).input).toBeNull();
    expect(prepare({ ...confirmed, acceptedTotalsKey: key }).input).toMatchObject({ reviewed: true, acceptSetTotals: true });
  });

  it("keeps entered data when review is unavailable and does not invent a partial plan", () => {
    const value = { ...draft(), fields: { ...draft().fields, comfortableLengths: "" } };
    const copy = structuredClone(value);
    expect(prepare(value)).toMatchObject({ input: null, course: null, error: expect.any(String) });
    expect(value).toEqual(copy);
    expect(prepare(draft(), "2026-09-14", [0]).input).toBeNull();
  });

  it("uses the exact selected existing plan revision instead of copying or importing it again", () => {
    const plan = { id: "00000000-0000-4000-8000-000000000001", revision: 3, title: "Current swimming" };
    const value = { ...draft(), selected: plan.id };
    expect(prepareConditioningSwimDraft(value, "2026-09-14", [0, 3], [plan]).input)
      .toEqual({ kind: "existing", planId: plan.id, revision: 3 });
    expect(prepareConditioningSwimDraft(draft(), "2026-09-14", [0, 3], [plan]).input).toBeNull();
  });

  it("renders shared pool controls without a nested form, another schedule, time field or save button", () => {
    const value = reviewed();
    const html = renderToStaticMarkup(<ConditioningSwimmingOptions value={value} onChange={() => {}}
      prepared={prepare(value)} plans={[]} />);
    expect(html).toContain('name="pool"');
    expect(html).toContain('name="experience"');
    expect(html).not.toContain("<form");
    expect(html).not.toContain('type="date"');
    expect(html).not.toContain('name="weekdays"');
    expect(html).not.toContain('name="timeBudgetMinutes"');
    expect(html.match(/<button[^>]*type="button"/g)?.length).toBe(html.match(/<button/g)?.length);
  });
});
