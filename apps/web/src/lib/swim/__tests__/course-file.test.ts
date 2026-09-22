import { describe, expect, it } from "vitest";
import { MAX_SWIM_COURSE_BYTES, poolCourse, type SwimSetup } from "@hta/domain";
import { parseSwimCourseFile } from "../course-file";
import { planPrivateSwimCourse } from "../course-planning";
import { syntheticCourse } from "./course-fixtures";
import { swimFixture } from "./fixtures";
import { isPrivateSwimPlan, requireGeneratedSwimPlan, swimWorkoutDateRange } from "../model";
import { addDaysToYmd } from "@/lib/dates";
import { deriveSwimWeekCandidate, persistedSwimPlan } from "../queries";
import { readFileSync } from "node:fs";

const setup: SwimSetup<null> = {
  course: poolCourse(50, 1, "m"), goal: "endurance", experience: "recreational",
  knownStrokes: ["freestyle"], equipment: [], recentComfortableLengths: 4, sessionBudgetMinutes: null,
};
function prepare(source = syntheticCourse(), poolChoices: Parameters<typeof planPrivateSwimCourse>[0]["poolChoices"] = []) {
  return planPrivateSwimCourse({ source, setup, startDate: "2026-09-14", weekdays: [1, 4], poolChoices });
}

describe("DC-SW1/SW3/SW4/SW5 private course file", () => {
  it("parses a closed version without modifying the source", () => {
    const source = syntheticCourse();
    expect(parseSwimCourseFile(JSON.stringify(source))).toEqual(source);
  });
  it("rejects a one-week truncation and retains every swim in the complete fixture", () => {
    const source = syntheticCourse();
    expect(() => parseSwimCourseFile(JSON.stringify({ ...source, weeks: source.weeks.slice(0, 1) }))).toThrow();
    expect(parseSwimCourseFile(JSON.stringify(source)).weeks.flatMap((week) => week.workouts)).toHaveLength(3);
  });
  it.each(["", "not-json", "{}"])("rejects invalid files without echoing their contents", (text) => {
    expect(() => parseSwimCourseFile(text)).toThrow();
  });
  it("bounds encoded bytes and rejects unsupported fields and ambiguous timing", () => {
    expect(() => parseSwimCourseFile(" ".repeat(MAX_SWIM_COURSE_BYTES + 1))).toThrow();
    expect(() => parseSwimCourseFile("é".repeat(MAX_SWIM_COURSE_BYTES / 2 + 1))).toThrow();
    expect(() => parseSwimCourseFile(JSON.stringify({ ...syntheticCourse(), algorithm: "invented" }))).toThrow();
    const source = syntheticCourse();
    const item = source.weeks[0]!.workouts[0]!.sections[1]!.items[0]!;
    expect(() => parseSwimCourseFile(JSON.stringify(source).replace(JSON.stringify(item),
      JSON.stringify({ ...item, sendoffSeconds: 60 })))).toThrow();
  });
  it("schedules only explicitly listed swims, with no generated dose or extra final session", () => {
    const result = prepare();
    expect(result.workouts.map((row) => row.scheduled_date)).toEqual(["2026-09-14", "2026-09-17", "2026-09-21"]);
    expect(result.workouts.map((row) => row.definition.slotId)).toEqual(["course-0-0", "course-0-1", "course-1-0"]);
    expect(result.preview.weeks.map((week) => week.total)).toEqual(["700 m", "350 m"]);
    expect(result.definition).not.toHaveProperty("initialDose");
    expect(result.workouts.every((row) => row.definition.provisional === false)).toBe(true);
  });
  it.each([0, 1, 2, 3, 4, 5, 6])("M4 DC-SW7 materializes a future week-two primary overlap without another swim (start offset %s)", (offset) => {
    const startDate = addDaysToYmd("2026-09-14", offset);
    const sundayIndex = new Date(`${startDate}T00:00:00Z`).getUTCDay();
    const result = planPrivateSwimCourse({
      source: syntheticCourse(), setup, startDate,
      weekdays: [(sundayIndex + 1) % 7, (sundayIndex + 3) % 7], poolChoices: [],
    });
    const target = addDaysToYmd(startDate, 7);
    const fixture = swimFixture();
    const plan = { ...fixture.plan, definition: result.definition, started_on: startDate, ends_on: addDaysToYmd(startDate, 13) };
    const workouts = result.workouts.map((row, index) => ({ ...fixture.workouts[index]!, ...row }));
    const selected = workouts.at(-1)!;
    const range = swimWorkoutDateRange(plan, workouts, selected, startDate);
    expect(workouts).toHaveLength(3);
    expect(selected.definition.weekIndex).toBe(1);
    expect(selected.scheduled_date > startDate).toBe(true);
    expect(workouts.some((row) => row.scheduled_date === target)).toBe(false);
    expect(target >= range.min && target <= range.max).toBe(true);
  });
  it("requires a pool decision without combining short repeats", () => {
    const source = syntheticCourse();
    const revised = { ...source, weeks: source.weeks.map((week, wi) => wi ? week : {
      workouts: week.workouts.map((workout, i) => i ? workout : {
        ...workout, sections: workout.sections.map((section) => section.kind !== "main" ? section : {
          ...section, items: section.items.map((item) => ({ ...item, distanceMetres: 25 })),
        }),
      }),
    }) };
    expect(() => prepare(revised)).toThrow(/Week 1, swim 1/);
    const result = prepare(revised, [{ weekIndex: 0, workoutIndex: 0, course: { numerator: 50, denominator: 2, unit: "m" } }]);
    expect(result.workouts[0]!.definition.poolCourse).toEqual(poolCourse(25, 1, "m"));
    expect(result.workouts[1]!.definition).not.toHaveProperty("poolCourse");
    expect(result.totals).toEqual([{ key: "course-0-0", week: 1, workout: 1, reported: 350, calculated: 225 }]);
    expect(result.workouts[0]!.definition.original).toEqual(result.workouts[0]!.definition.issued);
  });
  it("rejects mismatched frequency, duplicate or nonexistent workout pool choices", () => {
    expect(() => planPrivateSwimCourse({ source: syntheticCourse(), setup, startDate: "2026-09-14", weekdays: [1], poolChoices: [] })).toThrow();
    const choice = { weekIndex: 0, workoutIndex: 0, course: poolCourse(25, 1, "m") };
    expect(() => prepare(syntheticCourse(), [choice, choice])).toThrow();
    expect(() => prepare(syntheticCourse(), [{ ...choice, weekIndex: 15 }])).toThrow();
  });
  it("excludes the course from generic regeneration even without an initial dose", () => {
    const fixture = swimFixture();
    const plan = { ...fixture.plan, definition: prepare().definition };
    expect(isPrivateSwimPlan(plan)).toBe(true);
    expect(deriveSwimWeekCandidate(plan, [], "2026-09-30")).toBeNull();
    expect(() => persistedSwimPlan(plan, [])).toThrow();
    expect(() => requireGeneratedSwimPlan(plan)).toThrow();
    expect(requireGeneratedSwimPlan(fixture.plan).initialDose).toBeDefined();
  });
  it("restores the exact previous pool validator and refuses data-destroying rollback", () => {
    const root = new URL("../../../../../../packages/db/", import.meta.url);
    const prior = readFileSync(new URL("drizzle/0151_swim_pool_changes.sql", root), "utf8").replaceAll("\r\n", "\n");
    const down = readFileSync(new URL("rollbacks/0152_swim_private_courses.down.sql", root), "utf8").replaceAll("\r\n", "\n");
    const pattern = /CREATE OR REPLACE FUNCTION public\.swim_validate_plan_binding\([\s\S]*?END \$\$;/;
    expect(down.match(pattern)?.[0]).toBe(prior.match(pattern)?.[0]);
    expect(down).toMatch(/BEGIN;[\s\S]*IF EXISTS[\s\S]*RAISE EXCEPTION[\s\S]*COMMIT;/);
    expect(down).not.toMatch(/DELETE FROM|TRUNCATE|CASCADE|pg_get_functiondef/);
  });
});
