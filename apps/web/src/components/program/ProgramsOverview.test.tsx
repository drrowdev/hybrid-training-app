import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProgramsOverview, type ProgramOverviewItem } from "./ProgramsOverview";
import { TrainingWeek } from "./TrainingWeek";
import { formatProgramDate, hasTemplateWorkoutTitles, programWorkoutTitle } from "@/lib/programs/presentation";

const programs: ProgramOverviewItem[] = [
  { id: "strength", kind: "strength", name: "Strength A", startedOn: "2026-09-21", weeks: 6, editable: true, href: "/app/plan?block=strength" },
  { id: "swim", kind: "swimming", name: "Pool endurance", startedOn: "2026-09-21", endsOn: "2026-11-01", editable: false, href: "/app/swim?plan=swim" },
];
const entries = [
  { id: "lift", source: "primary" as const, programId: "strength", date: "2026-09-24", title: "Day 1 · A · 80%", state: "completed" as const },
  { id: "lengths", source: "swim" as const, programId: "swim", date: "2026-09-24", title: "Pool practice", state: "scheduled" as const },
];

describe("Programs navigation", () => {
  it.each(["strength", "running", "swimming", "hybrid"])("keeps %s on the overview and marks only its tab selected", (activity) => {
    const html = renderToStaticMarkup(<ProgramsOverview programs={programs} entries={entries}
      today="2026-09-24" swimHref="/app/swim/setup" activity={activity} />);
    const nav = html.match(/<nav.*?<\/nav>/)?.[0];
    const selected = nav?.match(/<a[^>]*aria-current="page"[^>]*>/)?.[0];
    expect(selected).toContain(`href="/app/programs?activity=${activity}"`);
    expect(nav?.match(/aria-current/g)).toHaveLength(1);
  });
  it("filters swim workouts and opens the selected swimming program", () => {
    const html = renderToStaticMarkup(<ProgramsOverview programs={programs} entries={entries}
      today="2026-09-24" swimHref="/app/swim/setup" activity="swimming" />);
    expect(html).toContain('href="/app/swim?plan=swim"');
    expect(html).toContain('href="/app/swim/lengths?from=today"');
    expect(html).not.toContain('href="/app/sessions/start/lift"');
    expect(html).not.toContain('href="/app/program"');
  });
  it("keeps all four build entries visible for an empty account", () => {
    const html = renderToStaticMarkup(<ProgramsOverview programs={[]} entries={[]}
      today="2026-09-24" swimHref="/app/swim/setup" />);
    for (const activity of ["strength", "running", "hybrid"]) expect(html).toContain(`href="/app/program/build?activity=${activity}"`);
    expect(html).toContain('href="/app/swim/setup"');
    expect(html.match(/<h2>/g)).toHaveLength(4);
    expect(html).not.toContain('aria-label="This week"');
  });
  it("opens finished sessions and removes only known template percentage suffixes", () => {
    const html = renderToStaticMarkup(<TrainingWeek entries={entries} today="2026-09-24"
      sessionLinks={{ lift: "finished" }} templateBlockIds={["strength"]} />);
    expect(html).toContain('href="/app/sessions/finished"');
    expect(html).not.toContain('href="/app/sessions/start/lift"');
    expect(programWorkoutTitle("Day 1 · A · 80%", true)).toBe("Day 1 · A");
    expect(programWorkoutTitle("My workout · 80%", false)).toBe("My workout · 80%");
    expect(hasTemplateWorkoutTitles({ programId: null, archetype: "custom" })).toBe(false);
    expect(hasTemplateWorkoutTitles({ programId: "authored", archetype: null })).toBe(false);
    expect(formatProgramDate("2026-08-24")).toBe("24 Aug");
  });
});
