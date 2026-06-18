/**
 * PlanRedesign — unit-level smoke for the timeline grid + drawer.
 *
 * Server-side rendering ensures the public contract (testids, classes,
 * URLs) doesn't drift silently. Interactive behaviour (DnD, drawer
 * open/close, swap-form submit) lives in the Playwright spec because
 * it requires a real DOM event loop.
 */
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// The component calls `useRouter()` (to refresh after a move/edit). Under the
// node-env static render used here there's no App Router context, so stub it.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
}));

import { PlanRedesign, type PlanSessionInput } from "./PlanRedesign";
import type { PrescriptionItem } from "@hta/db";

const noop = async () => {};

function strengthItems(): PrescriptionItem[] {
  return [
    {
      kind: "main",
      movementId: "m1",
      movementSlug: "front_squat",
      movementName: "Front Squat",
      sets: 3,
      reps: 5,
    } as unknown as PrescriptionItem,
  ];
}

function session(over: Partial<PlanSessionInput> = {}): PlanSessionInput {
  return {
    id: "s1",
    weekIndex: 0,
    dayIndex: 1,
    date: "2026-05-26",
    title: "Front Squat",
    isCardio: false,
    isStrength: true,
    done: false,
    skipped: false,
    slot: "single",
    items: strengthItems(),
    estDurationMin: 55,
    notes: null,
    ...over,
  };
}

function render(overrides: Partial<Parameters<typeof PlanRedesign>[0]> = {}) {
  const props: Parameters<typeof PlanRedesign>[0] = {
    archetypeName: "Endurance Focus",
    blockNumber: 1,
    blockTotal: 3,
    startedOn: "2026-05-25",
    endedOn: "2026-06-21",
    weeks: 4,
    today: "2026-05-26",
    currentWeekIndex: 0,
    sessions: [
      session(),
      session({
        id: "s2",
        weekIndex: 0,
        dayIndex: 3,
        date: "2026-05-28",
        title: "VO2 intervals",
        isCardio: true,
        isStrength: false,
      }),
      session({
        id: "s3",
        weekIndex: 0,
        dayIndex: 0,
        date: "2026-05-25",
        title: "Bench",
        done: true,
      }),
    ],
    view: "timeline",
    filter: "all",
    logHrefBase: "/app/sessions/start",
    moveAction: noop,
    skipAction: noop,
    unskipAction: noop,
    updateNotesAction: async () => ({ ok: true as const }),
    startSessionAction: noop,
    ...overrides,
  };
  return renderToStaticMarkup(<PlanRedesign {...props} />);
}

describe("PlanRedesign — header", () => {
  it("renders the program name but not the block counter", () => {
    const html = render();
    expect(html).toContain("Endurance Focus");
    // The lifetime "Block N of M" counter was removed from the plan header
    // (it reads like in-program progress and belongs on Stats instead).
    expect(html).not.toContain("Block 1 of 3");
  });

  it("does NOT render the research-citation info icon on the eyebrow", () => {
    const html = render();
    expect(html).not.toContain("ⓘ");
    expect(html).not.toContain("plan-eyebrow-info");
    expect(html).not.toContain("plan-eyebrow-blocks");
  });

  it("renders the block date range and progress meta", () => {
    const html = render();
    expect(html).toContain("Week 1 of 4");
    expect(html).toContain("of 3 sessions");
  });

  it("renders an overdue segment in the meta line when there are overdue rows", () => {
    // Default fixture today = 2026-05-26. Add a past-incomplete row so
    // the count is non-zero.
    const overdueRow = session({
      id: "s-overdue-meta",
      weekIndex: 0,
      dayIndex: 0,
      date: "2026-05-24",
      title: "Missed",
      done: false,
      skipped: false,
    });
    const html = render({ sessions: [overdueRow] });
    expect(html).toContain('data-testid="plan-meta-overdue"');
    expect(html).toMatch(/>1<\/b>\s*overdue/);
  });

  it("does NOT render an overdue segment when overdueCount === 0", () => {
    // Default fixture: s3 is done, s1 and s2 are today/future — nothing
    // overdue.
    const html = render();
    expect(html).not.toContain('data-testid="plan-meta-overdue"');
    // The meta segment text node is "<b>N</b> overdue" — make sure no
    // such literal appears outside CSS / pill testids.
    expect(html).not.toMatch(/<\/b>\s*overdue/);
  });

  it("excludes skipped past rows from the overdue count (skip wins)", () => {
    const skippedPast = session({
      id: "s-skipped-past",
      weekIndex: 0,
      dayIndex: 0,
      date: "2026-05-24",
      title: "Skipped",
      skipped: true,
    });
    const html = render({ sessions: [skippedPast] });
    expect(html).not.toContain('data-testid="plan-meta-overdue"');
  });

  it("uses plan-nav-link for the View history link", () => {
    const html = render();
    expect(html).toContain('class="plan-nav-link"');
    expect(html).toContain("View history →");
  });
});

describe("PlanRedesign — timeline grid", () => {
  it("renders the timeline by default with one row per week", () => {
    const html = render();
    expect(html).toContain('data-testid="plan-timeline"');
    expect(html).toContain('data-testid="plan-timeline-week-0"');
    expect(html).toContain('data-testid="plan-timeline-week-3"');
  });

  it("paints session pills with the strength or cardio modifier class", () => {
    const html = render();
    expect(html).toMatch(/session-pill strength[^"]*"[^>]*>Front Squat/);
    expect(html).toMatch(/session-pill cardio[^"]*"[^>]*>VO2 intervals/);
  });

  it("marks the today cell with data-today=true and a TODAY chip", () => {
    const html = render();
    // Today (2026-05-26) is week 0, day 1 (Tue).
    expect(html).toContain('data-testid="plan-day-cell-0-1"');
    // React attribute order isn't deterministic across versions, so
    // check that the today cell carries both markers — not their
    // adjacency.
    expect(html).toContain('data-today="true"');
    expect(html).toContain("TODAY");
  });

  it("highlights today even when today is a REST day (no session)", () => {
    // today=2026-05-27 is week 0, day 2 (Wed) — no session lands there in
    // the fixture. The cell still resolves its date via the grid anchor,
    // so it carries the today highlight (regression: previously a rest
    // cell had a null date and never highlighted).
    const html = render({ today: "2026-05-27" });
    // Timeline rest cell 0-2 is flagged today (attrs render before the
    // testid in JSX order).
    expect(html).toMatch(
      /data-today="true"[^>]*data-testid="plan-day-cell-0-2"/,
    );
    // The "This week" rail's rest row for the same day also highlights +
    // shows the TODAY chip.
    expect(html).toMatch(/data-today="true"[^>]*data-testid="plan-rail-2"/);
    expect(html).toContain("TODAY");
  });

  it("marks done sessions with the 'done' modifier + a check, not the faded 'muted' style", () => {
    const html = render();
    // s3 is on 2026-05-25 (before today) AND done → 'done' modifier (clear,
    // not faded). A past-AND-incomplete session would get 'muted' instead.
    expect(html).toMatch(/session-pill strength done[^"]*"[^>]*>/);
    expect(html).toMatch(/done-check[^>]*>\s*\u2713/);
    // A done session is NOT muted (no fade/line-through).
    expect(html).not.toMatch(/session-pill strength done muted/);
  });

  it("renders 'Rest' pills on empty day cells", () => {
    const html = render();
    expect(html).toContain("Rest");
  });
});

describe("PlanRedesign — view toggle + filter", () => {
  it("flags the Timeline tab as active when view=timeline", () => {
    const html = render({ view: "timeline" });
    expect(html).toContain('data-testid="plan-view-tab-timeline"');
    // The active tab carries data-active="true" — attribute ordering
    // varies, so we assert presence both ways.
    expect(html).toContain('data-active="true"');
    // And the month tab is inactive.
    expect(html).toMatch(/plan-view-tab-month[\s\S]*?data-active="false"/);
  });

  it("renders the Month grid when view=month", () => {
    const html = render({ view: "month" });
    expect(html).toContain('data-testid="plan-month-grid"');
    expect(html).not.toContain('data-testid="plan-timeline"');
  });

  it("flags the active filter via data-active", () => {
    const html = render({ filter: "strength" });
    expect(html).toContain('data-testid="plan-filter-strength"');
    expect(html).toMatch(/plan-filter-strength[\s\S]*?data-active="true"/);
    expect(html).toMatch(/plan-filter-all[\s\S]*?data-active="false"/);
  });
});

describe("PlanRedesign — overdue badge", () => {
  // A row dated 2026-05-25 (yesterday) with neither completion nor skip
  // is overdue relative to today=2026-05-26. The existing fixture's `s3`
  // is on that date but is `done: true`, so we override its done flag.
  const overdueRow = session({
    id: "s-overdue",
    weekIndex: 0,
    dayIndex: 0,
    date: "2026-05-25",
    title: "Missed Bench",
    done: false,
    skipped: false,
  });

  it("renders the Overdue pill on a past-incomplete row", () => {
    const html = render({ sessions: [overdueRow, session()] });
    expect(html).toContain('data-testid="overdue-pill-s-overdue"');
    expect(html).toMatch(/Overdue · 1d/);
    // And the host pill carries the overdue modifier class.
    expect(html).toMatch(/session-pill strength[^"]*overdue/);
  });

  it("does NOT render the Overdue pill on completed past rows", () => {
    const completed = session({
      id: "s-completed",
      weekIndex: 0,
      dayIndex: 0,
      date: "2026-05-25",
      title: "Bench",
      done: true,
    });
    const html = render({ sessions: [completed] });
    expect(html).not.toContain('data-testid="overdue-pill-s-completed"');
  });

  it("does NOT render the Overdue pill on skipped past rows", () => {
    const skipped = session({
      id: "s-skipped",
      weekIndex: 0,
      dayIndex: 0,
      date: "2026-05-25",
      title: "Skipped Bench",
      skipped: true,
    });
    const html = render({ sessions: [skipped] });
    expect(html).not.toContain('data-testid="overdue-pill-s-skipped"');
  });

  it("does NOT render the Overdue pill on today's or future rows", () => {
    const todayRow = session({ id: "s-today", date: "2026-05-26" });
    const futureRow = session({
      id: "s-future",
      weekIndex: 0,
      dayIndex: 3,
      date: "2026-05-28",
    });
    const html = render({ sessions: [todayRow, futureRow] });
    expect(html).not.toContain('data-testid="overdue-pill-s-today"');
    expect(html).not.toContain('data-testid="overdue-pill-s-future"');
  });
});


describe("PlanRedesign — this week rail", () => {
  it("renders a 7-row rail for the current week", () => {
    const html = render();
    for (let d = 0; d < 7; d++) {
      expect(html).toContain(`data-testid="plan-rail-${d}"`);
    }
  });

  it("marks done sessions with a ✓ status and future ones with Strength/Cardio kind", () => {
    const html = render();
    // Done rows render a ✓ glyph (aria-label="Done") instead of a text tag.
    expect(html).toContain('aria-label="Done"');
    expect(html).toContain(">✓<");
    expect(html).toContain(">Strength<");
    expect(html).toContain(">Cardio<");
  });
});


describe("PlanRedesign — mobile (<=768px) collapses to This-week rail only", () => {
  it("emits @media (max-width: 768px) rules that hide .plan-view-toggle and .plan-main", () => {
    const html = render();
    // styled-jsx inlines the CSS into the SSR markup. Assert the mobile
    // rules are present and target the toggle + main containers so the
    // rail card is the only visible plan surface on a phone.
    expect(html).toMatch(/@media\s*\(\s*max-width:\s*768px\s*\)[\s\S]*?\.plan-view-toggle\s*\{\s*display:\s*none/);
    expect(html).toMatch(/@media\s*\(\s*max-width:\s*768px\s*\)[\s\S]*?\.plan-main\s*\{\s*display:\s*none/);
  });

  it("uses !important on the mobile hide rules so the rule wins regardless of source order in the cascade (regression: PR #202's hide rule was silently overridden by a later base .plan-main { display: flex })", () => {
    const html = render();
    expect(html).toMatch(/\.plan-main\s*\{\s*display:\s*none\s*!important/);
    expect(html).toMatch(/\.plan-view-toggle\s*\{\s*display:\s*none\s*!important/);
    expect(html).toMatch(/\.plan-filter\s*\{\s*display:\s*none\s*!important/);
  });

  it("still renders the This-week rail (the only mobile surface) and its 7 day slots", () => {
    const html = render();
    expect(html).toContain('data-testid="plan-this-week"');
    for (let d = 0; d < 7; d++) {
      expect(html).toContain(`data-testid="plan-rail-${d}"`);
    }
  });
});


describe("PlanRedesign — mobile drawer (full-screen sheet, swipe-down dismiss)", () => {
  it("ships the @media (max-width:768px) sheet rules + slide-up keyframe via SessionDrawer's style block", async () => {
    const { SessionDrawer } = await import("./PlanRedesign");
    const html = renderToStaticMarkup(
      <SessionDrawer
        session={session()}
        today="2026-05-26"
        weeks={4}
        logHrefBase="/app/sessions/start"
        onClose={() => {}}
        moveAction={noop}
        skipAction={noop}
        unskipAction={noop}
        updateNotesAction={async () => ({ ok: true as const })}
        startSessionAction={noop}
      />,
    );
    expect(html).toMatch(/@media\s*\(\s*max-width:\s*768px\s*\)[\s\S]*?\.plan-drawer\s*\{[\s\S]*?inset:\s*0/);
    expect(html).toContain("@keyframes plan-drawer-slide-up");
    expect(html).toMatch(/@media\s*\(\s*max-width:\s*768px\s*\)[\s\S]*?\.drawer-drag-handle\s*\{[\s\S]*?display:\s*flex/);
  });
});

describe("SessionDrawer — drag handle + sheet markup", () => {
  it("renders a drag handle with the close-affordance aria-label and dialog role", async () => {
    const { SessionDrawer } = await import("./PlanRedesign");
    const html = renderToStaticMarkup(
      <SessionDrawer
        session={session()}
        today="2026-05-26"
        weeks={4}
        logHrefBase="/app/sessions/start"
        onClose={() => {}}
        moveAction={noop}
        skipAction={noop}
        unskipAction={noop}
        updateNotesAction={async () => ({ ok: true as const })}
        startSessionAction={noop}
      />,
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('data-testid="plan-drawer-drag-handle"');
    // Drag handle is touch-only — review-202 #3 removed role="button" /
    // tabIndex and marked it aria-hidden so assistive tech doesn't
    // present a fake button without a keyboard handler. Keyboard close
    // path is Escape + the X button.
    expect(html).toContain('aria-hidden="true"');
  });

  it("hides Mark done + Skip once the workout is complete", async () => {
    const { SessionDrawer } = await import("./PlanRedesign");
    const base = {
      today: "2026-05-26",
      weeks: 4,
      logHrefBase: "/app/sessions/start",
      onClose: () => {},
      moveAction: noop,
      skipAction: noop,
      unskipAction: noop,
      updateNotesAction: async () => ({ ok: true as const }),
      startSessionAction: noop,
    };
    const open = renderToStaticMarkup(<SessionDrawer session={session()} {...base} />);
    expect(open).toContain('data-testid="plan-drawer-mark-done"');
    expect(open).toContain('data-testid="plan-drawer-skip"');

    const done = renderToStaticMarkup(
      <SessionDrawer session={session({ done: true })} {...base} />,
    );
    expect(done).not.toContain('data-testid="plan-drawer-mark-done"');
    expect(done).not.toContain('data-testid="plan-drawer-skip"');
    expect(done).not.toContain('data-testid="plan-drawer-unskip"');
    // Swap day + Edit remain available on a completed session.
    expect(done).toContain('data-testid="plan-drawer-swap"');
    expect(done).toContain('data-testid="plan-drawer-edit"');
  });
});

describe("shouldDismissSwipe — pointer-release threshold", () => {
  it("dismisses on a long downward pull (>100px)", async () => {
    const { shouldDismissSwipe } = await import("./PlanRedesign");
    expect(shouldDismissSwipe({ finalDy: 150, velocity: 0 })).toBe(true);
    expect(shouldDismissSwipe({ finalDy: 101, velocity: 0 })).toBe(true);
  });

  it("dismisses on a fast fling (>0.5 px/ms) even with short distance", async () => {
    const { shouldDismissSwipe } = await import("./PlanRedesign");
    expect(shouldDismissSwipe({ finalDy: 40, velocity: 0.8 })).toBe(true);
  });

  it("snaps back when neither threshold is met", async () => {
    const { shouldDismissSwipe } = await import("./PlanRedesign");
    expect(shouldDismissSwipe({ finalDy: 50, velocity: 0.2 })).toBe(false);
    expect(shouldDismissSwipe({ finalDy: 100, velocity: 0.5 })).toBe(false);
    expect(shouldDismissSwipe({ finalDy: 0, velocity: 0 })).toBe(false);
  });
});

describe("pressStartsOnInteractive — drag-vs-control guard", () => {
  // A minimal element-like whose `closest` mimics matching an ancestor selector.
  const el = (matches: boolean) => ({ closest: () => (matches ? {} : null) });

  it("returns true when the press lands on an interactive control (e.g. the × close button)", async () => {
    const { pressStartsOnInteractive } = await import("./PlanRedesign");
    expect(pressStartsOnInteractive(el(true))).toBe(true);
  });

  it("returns false on the bare drag region (no interactive ancestor)", async () => {
    const { pressStartsOnInteractive } = await import("./PlanRedesign");
    expect(pressStartsOnInteractive(el(false))).toBe(false);
  });

  it("is null-safe", async () => {
    const { pressStartsOnInteractive } = await import("./PlanRedesign");
    expect(pressStartsOnInteractive(null)).toBe(false);
    expect(pressStartsOnInteractive({})).toBe(false);
  });
});
