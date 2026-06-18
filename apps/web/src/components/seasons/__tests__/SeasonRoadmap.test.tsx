/**
 * SeasonRoadmap — SSR smoke for the Season tab (ADR 0051 Phase 0).
 *
 * Static render asserts the public contract: the empty state shows the create
 * builder; the populated state renders one card per block with the resolved
 * program name + friendly emphasis label + status; the per-card Remove control
 * appears only on PLANNED blocks. Interactive behaviour (action dispatch,
 * router.refresh) lives in Playwright — here the server actions + router are
 * stubbed so the component renders deterministically under node.
 */
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/lib/seasons/actions", () => ({
  createSeason: vi.fn(),
  addSeasonBlock: vi.fn(),
  removeSeasonBlock: vi.fn(),
  updateSeasonBlock: vi.fn(),
  reorderSeasonBlocks: vi.fn(),
  abandonSeason: vi.fn(),
}));

import { SeasonRoadmap, type SeasonRoadmapProgram } from "../SeasonRoadmap";
import type { ActiveSeason, SeasonBlock } from "@/lib/seasons/queries";

const PROGRAMS: SeasonRoadmapProgram[] = [
  { id: "hybrid", name: "Hybrid" },
  { id: "wendler-531", name: "5/3/1" },
  { id: "tactical-barbell", name: "Tactical Barbell" },
];

const EMPHASIS = [
  "base",
  "strength_bias",
  "endurance_bias",
  "build",
  "peak",
  "realize",
  "recovery",
] as const;

function block(over: Partial<SeasonBlock> = {}): SeasonBlock {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    position: 0,
    programId: "hybrid",
    templateRef: null,
    emphasis: "base",
    intentNote: null,
    plannedWeeks: null,
    status: "planned",
    blockId: null,
    ...over,
  };
}

describe("SeasonRoadmap — empty state", () => {
  it("renders the create builder when there is no active season", () => {
    const html = renderToStaticMarkup(
      <SeasonRoadmap
        season={null}
        programs={PROGRAMS}
        emphasisOptions={EMPHASIS}
        today="2026-06-18"
        upcomingEvents={[]}
        floorContext={null}
      />,
    );
    expect(html).toContain('data-testid="season-empty"');
    expect(html).toContain('data-testid="season-name-input"');
    expect(html).toContain('data-testid="season-create"');
    // One draft block row is seeded so the user can fill it in immediately.
    expect(html).toContain('data-testid="season-draft-row"');
    // The program + emphasis selects are present with friendly labels.
    expect(html).toContain("Hybrid");
    expect(html).toContain("Strength focus");
    expect(html).toContain("Engine focus");
    // No populated rail in the empty state.
    expect(html).not.toContain('data-testid="season-rail"');
  });
});

describe("SeasonRoadmap — populated state", () => {
  const season: ActiveSeason = {
    id: "10000000-0000-0000-0000-0000000000aa",
    name: "Spring HYROX build",
    goal: null,
    blocks: [
      block({
        id: "b-done",
        position: 0,
        programId: "hybrid",
        emphasis: "base",
        intentNote: "Re-set both qualities.",
        status: "done",
      }),
      block({
        id: "b-active",
        position: 1,
        programId: "wendler-531",
        templateRef: "FSL",
        emphasis: "strength_bias",
        intentNote: "Concentrate strength.",
        status: "active",
      }),
      block({
        id: "b-planned",
        position: 2,
        programId: "tactical-barbell",
        emphasis: "endurance_bias",
        intentNote: "Add conditioning volume.",
        status: "planned",
      }),
    ],
  };

  it("renders one card per block in position order", () => {
    const html = renderToStaticMarkup(
      <SeasonRoadmap
        season={season}
        programs={PROGRAMS}
        emphasisOptions={EMPHASIS}
        today="2026-06-18"
        upcomingEvents={[]}
        floorContext={null}
      />,
    );
    expect(html).toContain('data-testid="season-roadmap"');
    expect(html).toContain("Spring HYROX build");
    const cardCount = (html.match(/data-testid="season-block"/g) ?? []).length;
    expect(cardCount).toBe(3);
  });

  it("resolves program names from the registry and shows friendly emphasis labels", () => {
    const html = renderToStaticMarkup(
      <SeasonRoadmap
        season={season}
        programs={PROGRAMS}
        emphasisOptions={EMPHASIS}
        today="2026-06-18"
        upcomingEvents={[]}
        floorContext={null}
      />,
    );
    expect(html).toContain("Hybrid");
    expect(html).toContain("5/3/1");
    expect(html).toContain("Tactical Barbell");
    expect(html).toContain("Base");
    expect(html).toContain("Strength focus");
    expect(html).toContain("Engine focus");
    // Template ref surfaces when present.
    expect(html).toContain("FSL");
  });

  it("renders the status badges (done / active / planned)", () => {
    const html = renderToStaticMarkup(
      <SeasonRoadmap
        season={season}
        programs={PROGRAMS}
        emphasisOptions={EMPHASIS}
        today="2026-06-18"
        upcomingEvents={[]}
        floorContext={null}
      />,
    );
    expect(html).toContain("Done");
    expect(html).toContain("Active");
    expect(html).toContain("Planned");
  });

  it("shows the Remove control only on planned blocks", () => {
    const html = renderToStaticMarkup(
      <SeasonRoadmap
        season={season}
        programs={PROGRAMS}
        emphasisOptions={EMPHASIS}
        today="2026-06-18"
        upcomingEvents={[]}
        floorContext={null}
      />,
    );
    // Exactly one planned block → exactly one remove control.
    const removeCount = (
      html.match(/data-testid="season-block-remove"/g) ?? []
    ).length;
    expect(removeCount).toBe(1);
  });

  it("shows a Start-block CTA only on the next planned block, deep-linking the wizard", () => {
    const html = renderToStaticMarkup(
      <SeasonRoadmap
        season={season}
        programs={PROGRAMS}
        emphasisOptions={EMPHASIS}
        today="2026-06-18"
        upcomingEvents={[]}
        floorContext={null}
      />,
    );
    // Single planned block here → exactly one Start CTA, carrying both the
    // program preselect and the seasonBlockId activation token.
    const startCount = (
      html.match(/data-testid="season-block-start"/g) ?? []
    ).length;
    expect(startCount).toBe(1);
    expect(html).toContain("/app/program?program=tactical-barbell");
    expect(html).toContain("seasonBlockId=b-planned");
  });

  it("renders the End season + Add block affordances", () => {
    const html = renderToStaticMarkup(
      <SeasonRoadmap
        season={season}
        programs={PROGRAMS}
        emphasisOptions={EMPHASIS}
        today="2026-06-18"
        upcomingEvents={[]}
        floorContext={null}
      />,
    );
    expect(html).toContain('data-testid="season-end"');
    expect(html).toContain('data-testid="season-add-block"');
  });

  it("renders an Edit control on each planned block", () => {
    const html = renderToStaticMarkup(
      <SeasonRoadmap
        season={season}
        programs={PROGRAMS}
        emphasisOptions={EMPHASIS}
        today="2026-06-18"
        upcomingEvents={[]}
        floorContext={null}
      />,
    );
    const editCount = (html.match(/data-testid="season-block-edit"/g) ?? []).length;
    expect(editCount).toBe(1); // one planned block in this fixture
  });
});

describe("SeasonRoadmap — reorder controls", () => {
  // done(0) · active(1) · planned(2) · planned(3): reorder is confined to the
  // planned tail, so the first planned can't move up (past the active block) and
  // the last planned can't move down.
  const season: ActiveSeason = {
    id: "10000000-0000-0000-0000-0000000000bb",
    name: "Two-planned season",
    goal: null,
    blocks: [
      block({ id: "b0", position: 0, status: "done" }),
      block({ id: "b1", position: 1, status: "active" }),
      block({ id: "b2", position: 2, programId: "wendler-531", status: "planned" }),
      block({ id: "b3", position: 3, programId: "tactical-barbell", status: "planned" }),
    ],
  };

  it("offers up/down controls on each planned block", () => {
    const html = renderToStaticMarkup(
      <SeasonRoadmap
        season={season}
        programs={PROGRAMS}
        emphasisOptions={EMPHASIS}
        today="2026-06-18"
        upcomingEvents={[]}
        floorContext={null}
      />,
    );
    expect((html.match(/data-testid="season-block-up"/g) ?? []).length).toBe(2);
    expect((html.match(/data-testid="season-block-down"/g) ?? []).length).toBe(2);
  });

  it("disables moving the first planned block up (can't reorder past the active block)", () => {
    const html = renderToStaticMarkup(
      <SeasonRoadmap
        season={season}
        programs={PROGRAMS}
        emphasisOptions={EMPHASIS}
        today="2026-06-18"
        upcomingEvents={[]}
        floorContext={null}
      />,
    );
    // At least one up-control is disabled (the first planned block); at least
    // one is enabled (the second planned block can move up).
    expect(/disabled[^>]*data-testid="season-block-up"/.test(html)).toBe(true);
    expect(/data-testid="season-block-up"/.test(html)).toBe(true);
    // The first planned block has no Start CTA suppressing its up button — the
    // Start CTA is present (it's the next planned), proving sequential ordering.
    expect(html).toContain('data-testid="season-block-start"');
  });
});

describe("SeasonRoadmap — goal anchor + advisories", () => {
  function block(over: Partial<SeasonBlock> = {}): SeasonBlock {
    return {
      id: "g1",
      position: 0,
      programId: "hybrid",
      templateRef: null,
      emphasis: "base",
      intentNote: null,
      plannedWeeks: 4,
      status: "planned",
      blockId: null,
      ...over,
    };
  }

  it("renders the empty-state goal picker", () => {
    const html = renderToStaticMarkup(
      <SeasonRoadmap
        season={null}
        programs={PROGRAMS}
        emphasisOptions={EMPHASIS}
        today="2026-06-18"
        upcomingEvents={[{ id: "e1", name: "City Marathon", eventDate: "2026-09-01" }]}
        floorContext={null}
      />,
    );
    expect(html).toContain('data-testid="season-goal-select"');
    expect(html).toContain("City Marathon");
  });

  it("shows the goal pill with weeks-out and a runway warning when blocks overrun", () => {
    const season: ActiveSeason = {
      id: "s-goal",
      name: "Race build",
      goal: { type: "event", targetDate: "2026-07-16", eventId: "e1", eventName: "City 10k" },
      blocks: [
        block({ id: "a", position: 0, status: "active", plannedWeeks: 6 }),
        block({ id: "b", position: 1, status: "planned", plannedWeeks: 6 }),
      ],
    };
    const html = renderToStaticMarkup(
      <SeasonRoadmap
        season={season}
        programs={PROGRAMS}
        emphasisOptions={EMPHASIS}
        today="2026-06-18" // 4 weeks to the goal; 12 weeks of blocks → overrun
        upcomingEvents={[]}
        floorContext={null}
      />,
    );
    expect(html).toContain('data-testid="season-goal-pill"');
    expect(html).toContain("City 10k");
    expect(html).toContain("4 wks out");
    expect(html).toContain('data-testid="season-runway-warn"');
  });

  it("shows the maintenance-floor advisory on a strength-bias block", () => {
    const season: ActiveSeason = {
      id: "s-bias",
      name: "Strength block",
      goal: null,
      blocks: [block({ id: "x", position: 0, status: "planned", emphasis: "strength_bias" })],
    };
    const html = renderToStaticMarkup(
      <SeasonRoadmap
        season={season}
        programs={PROGRAMS}
        emphasisOptions={EMPHASIS}
        today="2026-06-18"
        upcomingEvents={[]}
        floorContext={null}
      />,
    );
    expect(html).toContain('data-testid="season-floor-note"');
    expect(html.toLowerCase()).toContain("maintenance floor");
  });

  it("renders a quantitative floor advisory + balance bar when context is present", () => {
    const season: ActiveSeason = {
      id: "s-bias2",
      name: "Strength block",
      goal: null,
      blocks: [block({ id: "x", position: 0, status: "planned", emphasis: "strength_bias" })],
    };
    const html = renderToStaticMarkup(
      <SeasonRoadmap
        season={season}
        programs={PROGRAMS}
        emphasisOptions={EMPHASIS}
        today="2026-06-18"
        upcomingEvents={[]}
        floorContext={{
          cardioBaselineMinPerWk: 180,
          cardioSessionsPerWk: 4,
          strengthSessionsPerWk: 3,
          cardioScalarAtFloor: 0.97,
        }}
      />,
    );
    // Read-only balance bar (60/40) + quantitative advisory (≥~60 min, 97%).
    expect(html).toContain('data-testid="season-balance-bar"');
    expect(html).toContain("Strength");
    expect(html).toContain("60 min");
    expect(html).toContain("97%");
  });
});

describe("SeasonRoadmap — template selection", () => {
  function block(over: Partial<SeasonBlock> = {}): SeasonBlock {
    return {
      id: "t1",
      position: 0,
      programId: "tactical-barbell",
      templateRef: "zulu",
      emphasis: "base",
      intentNote: null,
      plannedWeeks: 6,
      status: "planned",
      blockId: null,
      ...over,
    };
  }
  const templates = {
    "tactical-barbell": [
      { value: "operator", label: "Operator" },
      { value: "zulu", label: "Zulu" },
    ],
  };

  it("shows the friendly template label and deep-links it as ?phase= on Start", () => {
    const season: ActiveSeason = {
      id: "s-tpl",
      name: "Template season",
      goal: null,
      blocks: [block()],
    };
    const html = renderToStaticMarkup(
      <SeasonRoadmap
        season={season}
        programs={PROGRAMS}
        emphasisOptions={EMPHASIS}
        today="2026-06-18"
        upcomingEvents={[]}
        floorContext={null}
        templatesByProgram={templates}
      />,
    );
    // Friendly label, not the raw value.
    expect(html).toContain("Zulu");
    // Start CTA carries the template as the wizard ?phase= prefill.
    expect(html).toContain("seasonBlockId=t1");
    expect(html).toContain("phase=zulu");
  });

  it("omits ?phase= when a block has no template", () => {
    const season: ActiveSeason = {
      id: "s-notpl",
      name: "No-template season",
      goal: null,
      blocks: [block({ id: "n1", templateRef: null, programId: "hybrid" })],
    };
    const html = renderToStaticMarkup(
      <SeasonRoadmap
        season={season}
        programs={PROGRAMS}
        emphasisOptions={EMPHASIS}
        today="2026-06-18"
        upcomingEvents={[]}
        floorContext={null}
        templatesByProgram={templates}
      />,
    );
    expect(html).toContain("seasonBlockId=n1");
    expect(html).not.toContain("phase=");
  });
});
