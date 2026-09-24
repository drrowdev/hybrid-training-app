import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProgramsOverview, type ProgramOverviewItem } from "./ProgramsOverview";
import { TrainingWeek } from "./TrainingWeek";
import { formatProgramDate, hasTemplateWorkoutTitles, programWorkoutTitle } from "@/lib/programs/presentation";
import { NewProgramChooser } from "./NewProgramChooser";
import { SwimProgramHistory } from "./SwimProgramHistory";
import { ProgramHistory, ProgramHistorySummary } from "./ProgramHistory";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/planner/actions", () => ({ endBlock: vi.fn() }));

const programs: ProgramOverviewItem[] = [
  { id: "strength", kind: "strength", name: "Strength A", startedOn: "2026-09-21", weeks: 6, editable: true, href: "/app/plan?block=strength" },
  { id: "swim", kind: "swimming", name: "Pool endurance", startedOn: "2026-09-21", endsOn: "2026-11-01", editable: false, href: "/app/swim?plan=swim" },
];
const entries = [
  { id: "lift", source: "primary" as const, programId: "strength", date: "2026-09-24", title: "Day 1 · A · 80%", state: "completed" as const },
  { id: "lengths", source: "swim" as const, programId: "swim", date: "2026-09-24", title: "Pool practice", state: "scheduled" as const },
];

describe("Programs navigation", () => {
  it("opens each program and keeps the four types in fixed order", () => {
    const html = renderToStaticMarkup(<ProgramsOverview programs={programs} entries={entries}
      today="2026-09-24" swimHref="/app/swim/setup" />);
    expect([...html.matchAll(/data-kind="([^"]+)"/g)].map((match) => match[1])).toEqual(["strength", "running", "swimming", "hybrid"]);
    expect(html).toContain('href="/app/plan?block=strength"');
    expect(html).toContain('href="/app/swim?plan=swim"');
    expect(html).not.toContain('href="/app/sessions/start/lift"');
    expect(html).toContain('href="/app/plan"');
    expect(html).toContain('href="/app/plan/history"');
  });
  it("keeps all four build entries visible for an empty account", () => {
    const html = renderToStaticMarkup(<ProgramsOverview programs={[]} entries={[]}
      today="2026-09-24" swimHref="/app/swim/setup" />);
    expect(html.match(/aria-label="Start [^"]+ program"/g)).toHaveLength(4);
    expect(html).not.toContain("disabled");
    expect(html).not.toContain('aria-label="This week"');
  });
  it("uses each program's own week boundary in its summary", () => {
    const html = renderToStaticMarkup(<ProgramsOverview programs={programs.map((program) => ({
      ...program, startedOn: "2026-09-23", weeks: 6,
    }))} entries={entries} today="2026-09-28" swimHref="/app/swim/setup" />);
    expect(html).toMatch(/data-kind="strength"[\s\S]+?Week 2 of 6/);
    expect(html).toMatch(/data-kind="swimming"[\s\S]+?Week 1 of 6/);
  });
  it("locks only non-swim starts while a legacy program is active", () => {
    const legacy = { ...programs[0], id: "legacy", kind: null, href: "/app/plan?block=legacy" };
    const html = renderToStaticMarkup(<ProgramsOverview programs={[legacy]} entries={[]}
      today="2026-09-24" swimHref="/app/swim/setup" />);
    expect(html).toContain('href="/app/plan?block=legacy"');
    expect(html.match(/disabled=""/g)).toHaveLength(3);
    expect(html).not.toContain("classify");
    expect(html).toContain("Week 1 of 6");
  });
  it("shares the history title and row anatomy across primary and swim history", () => {
    const html = renderToStaticMarkup(<ProgramHistory>
      <ProgramHistorySummary name="Upper / lower" startedOn="2026-09-01" endedOn="2026-09-21" status="Completed" />
      <SwimProgramHistory programs={[{ ...programs[1], status: "finished" }]} />
    </ProgramHistory>);
    expect(html).toMatch(/<h1[^>]*>Program history<\/h1>/);
    expect(html).toContain('href="/app/programs"');
    expect(html).toContain("1 Sept");
    expect(html).not.toContain("2026-09-01");
    expect(html).toContain('href="/app/swim?plan=swim"');
  });
  it("retains paused swimming without making finished programs occupy a type", () => {
    const history = [{ ...programs[1], status: "paused" as const },
      { ...programs[1], id: "finished", href: "/app/swim?plan=finished", status: "finished" as const }];
    const html = renderToStaticMarkup(<ProgramsOverview programs={history} entries={entries}
      today="2026-09-24" swimHref={null} initiallyOpen />);
    expect(html).toContain('href="/app/swim?plan=swim"');
    expect(html).not.toContain('href="/app/swim?plan=finished"');
    expect(html).toMatch(/data-kind="swimming"(?![^>]*disabled)/);
    const historyHtml = renderToStaticMarkup(<SwimProgramHistory programs={[...programs, ...history,
      { ...programs[1], id: "archived", href: "/app/swim?plan=archived", status: "archived" }]} />);
    expect(historyHtml.match(/<a /g)).toHaveLength(3);
    for (const id of ["swim", "finished", "archived"]) expect(historyHtml).toContain(`href="/app/swim?plan=${id}"`);
    expect(historyHtml).not.toContain("<button");
  });
  it.each([
    ["strength", ["wendler-531", "tactical-barbell"]],
    ["hybrid", ["green-protocol", "hyrox"]],
  ] as const)("offers only existing %s templates", (type, templates) => {
    const html = renderToStaticMarkup(<NewProgramChooser programs={programs} type={type} swimHref="/app/swim/setup" onSelect={() => {}} onClose={() => {}} />);
    expect([...html.matchAll(/href="\/app\/program\?program=([^"]+)"/g)].map((match) => match[1])).toEqual(templates);
    expect(html).toContain(`href="/app/program/build?activity=${type}"`);
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
