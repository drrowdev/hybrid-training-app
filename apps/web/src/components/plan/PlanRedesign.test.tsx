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
    programFamilyName: "SxC",
    startedOn: "2026-05-25",
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
    moveAction: noop,
    skipAction: noop,
    unskipAction: noop,
    updateNotesAction: async () => ({ ok: true as const }),
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

  it("renders state-aware program actions through the header slot", () => {
    const html = render({
      headerActions: <button type="button">Edit program</button>,
    });
    expect(html).toContain("Edit program");
  });
});

describe("PlanRedesign — expandable program overview", () => {
  it("renders the overview by default with one expandable row per week", () => {
    const html = render();
    expect(html).toContain('data-testid="plan-timeline"');
    expect(html).toContain('data-testid="plan-timeline-week-0"');
    expect(html).toContain('data-testid="plan-timeline-week-3"');
  });

  it("renders full session names in readable agenda rows", () => {
    const html = render();
    expect(html).toContain('class="plan-agenda-session"');
    expect(html).toContain("Front Squat");
    expect(html).toContain("VO2 intervals");
  });

  it("marks the today agenda day and session status", () => {
    const html = render();
    // Today (2026-05-26) is week 0, day 1 (Tue).
    expect(html).toContain('data-testid="plan-day-cell-0-1"');
    // React attribute order isn't deterministic across versions, so
    // check that the today cell carries both markers — not their
    // adjacency.
    expect(html).toContain('data-today="true"');
    expect(html).toContain('data-state="today"');
    expect(html).toContain(">Today<");
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
    expect(html).toContain(">Today<");
  });

  it("marks completed sessions with a clear success status", () => {
    const html = render();
    expect(html).toContain('class="plan-agenda-day completed"');
    expect(html).toContain('data-state="completed"');
    expect(html).toContain('class="plan-agenda-session done"');
    expect(html).toContain('class="plan-session-status done"');
    expect(html).toContain("✓ Done");
  });

  it("keeps Today visible when the current day is also completed", () => {
    const html = render({ today: "2026-05-25" });
    expect(html).toContain(
      'class="plan-agenda-day today completed" data-today="true" data-state="today-completed"',
    );
    expect(html).toContain('class="plan-day-today-marker">Today</span>');
    expect(html).toContain("✓ Done");
  });

  it("styles only the completed workout when a two-a-day is mixed", () => {
    const html = render({
      sessions: [
        session({
          id: "am",
          dayIndex: 0,
          date: "2026-05-25",
          slot: "am",
          done: true,
        }),
        session({
          id: "pm",
          dayIndex: 0,
          date: "2026-05-25",
          slot: "pm",
          done: false,
        }),
      ],
    });
    expect(html).not.toContain('class="plan-agenda-day completed"');
    expect(html).toContain('class="plan-agenda-session done"');
  });

  it("renders 'Rest' pills on empty day cells", () => {
    const html = render();
    expect(html).toContain("Rest");
  });
});

describe("PlanRedesign — view toggle", () => {
  it("flags the Program tab as active when view=timeline", () => {
    const html = render({ view: "timeline" });
    expect(html).toContain('data-testid="plan-view-tab-timeline"');
    // The active tab carries data-active="true" — attribute ordering
    // varies, so we assert presence both ways.
    expect(html).toContain('data-active="true"');
    expect(html).toContain(">Program</button>");
    expect(html).toContain(">Calendar</button>");
  });

  it("renders the Month grid when view=month", () => {
    const html = render({ view: "month" });
    expect(html).toContain('data-testid="plan-month-grid"');
    expect(html).not.toContain('data-testid="plan-timeline"');
  });

  it("renders Season inside the same program shell and tab strip", () => {
    const html = render({
      view: "season",
      seasonEnabled: true,
      seasonContent: (
        <section data-testid="season-content-fixture">Season roadmap</section>
      ),
    });
    expect(html).toContain('data-testid="plan-redesign"');
    expect(html).toContain("Active program");
    expect(html).toContain("Endurance Focus");
    expect(html).toContain('data-testid="plan-view-tab-timeline"');
    expect(html).toContain('data-testid="plan-view-tab-month"');
    expect(html).toContain('data-testid="plan-view-tab-season"');
    expect(html).toContain('data-testid="plan-season-view"');
    expect(html).toContain('data-testid="season-content-fixture"');
    expect(html).not.toContain('href="/app/plan?view=season"');
    expect(html).not.toContain('data-testid="plan-timeline"');
    expect(html).not.toContain('data-testid="plan-month-grid"');
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
    expect(html).toContain('class="plan-session-status overdue"');
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


describe("PlanRedesign — phase and week hierarchy", () => {
  it("renders seven readable agenda days inside the current week", () => {
    const html = render();
    for (let d = 0; d < 7; d++) {
      expect(html).toContain(`data-testid="plan-day-cell-0-${d}"`);
    }
  });

  it("distinguishes current and upcoming weeks with semantic classes", () => {
    const html = render();
    expect(html).toContain('class="plan-week current"');
    expect(html).toContain('class="plan-week upcoming"');
    expect(html).toContain("Current");
    expect(html).toContain("Upcoming");
  });

  it("marks an unfinished past week neutrally, with no attention warning", () => {
    // Missing a session carries no penalty, so a behind-you week is reported
    // plainly rather than flagged: no amber rail, no "Needs attention" tag.
    const html = render({ currentWeekIndex: 4 });
    expect(html).toContain("Program window complete");
    expect(html).toContain('class="plan-week past"');
    expect(html).toContain("Past");
    expect(html).not.toContain("Needs attention");
    expect(html).not.toContain("attention");
    expect(html).not.toContain('class="plan-week current"');
  });

  it("keeps every week upcoming before the program starts", () => {
    const html = render({ currentWeekIndex: -1 });
    expect(html).toContain("Starts 25 May");
    expect(html).not.toContain('class="plan-week current"');
  });
});


describe("PlanRedesign — mobile overview", () => {
  it("keeps the Program / Calendar control visible on phones", () => {
    const html = render();
    expect(html).toMatch(
      /@media\s*\(\s*max-width:\s*768px\s*\)[\s\S]*?\.plan-view-toggle\s*\{[\s\S]*?display:\s*inline-flex\s*!important/,
    );
  });

  it("stacks the week agenda to one column instead of hiding it", () => {
    const html = render();
    expect(html).toMatch(
      /@media\s*\(\s*max-width:\s*768px\s*\)[\s\S]*?\.plan-agenda-grid\s*\{\s*grid-template-columns:\s*1fr/,
    );
    expect(html).not.toContain('data-testid="plan-this-week"');
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

  it("keeps the header + close button clear of the status bar / notch", async () => {
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

    // Regression: the mobile block must be declared AFTER the base
    // `.plan-drawer .drawer-head { padding: 18px 20px }` rule. Both selectors
    // have identical specificity, so when the media query came first the base
    // `padding` shorthand won and reset the safe-area offset — dropping the
    // title and × close button under the status bar / Dynamic Island.
    const baseHead = html.indexOf(".plan-drawer .drawer-head {");
    const mobileBlock = html.search(/@media\s*\(\s*max-width:\s*768px\s*\)\s*\{\s*\.plan-drawer\s*\{/);
    expect(baseHead).toBeGreaterThan(-1);
    expect(mobileBlock).toBeGreaterThan(baseHead);

    const mobileCss = html.slice(mobileBlock);
    // Grab handle clears the safe area, so the sheet's own chrome starts below it.
    expect(mobileCss).toMatch(
      /\.drawer-drag-handle\s*\{[\s\S]*?margin:\s*calc\(env\(safe-area-inset-top[\s\S]*?\)/,
    );
    // Only the body scrolls, so the header never slides back under the notch.
    expect(mobileCss).toMatch(/\.plan-drawer\s*\{[\s\S]*?overflow:\s*hidden/);
    expect(mobileCss).toMatch(/\.plan-drawer \.drawer-head\s*\{[\s\S]*?position:\s*static/);
    expect(mobileCss).toMatch(/\.plan-drawer \.drawer-body\s*\{[\s\S]*?overflow-y:\s*auto/);
    // × gets a 44px minimum touch target.
    expect(mobileCss).toMatch(
      /\.plan-drawer \.close\s*\{[\s\S]*?min-width:\s*44px[\s\S]*?min-height:\s*44px/,
    );
  });
});

describe("SessionDrawer — Plan review-only mode", () => {
  it("keeps schedule controls but removes workout logging actions", async () => {
    const { SessionDrawer } = await import("./PlanRedesign");
    const html = renderToStaticMarkup(
      <SessionDrawer
        session={session({ date: "2026-05-25" })}
        today="2026-05-26"
        weeks={4}
        onClose={() => {}}
        moveAction={noop}
        skipAction={noop}
        unskipAction={noop}
        updateNotesAction={async () => ({ ok: true as const })}
        allowLogging={false}
      />,
    );
    expect(html).toContain('data-testid="plan-drawer-swap"');
    expect(html).toContain('data-testid="plan-drawer-skip"');
    expect(html).not.toContain('data-testid="plan-drawer-mark-done"');
    expect(html).not.toContain('data-testid="overdue-log-');
  });

  it("removes the link-a-logged-activity control on a cardio session too", async () => {
    // Reported from use: a Plan cardio drawer showed no Mark done (correct —
    // logging is Today's) but still offered "Link a logged activity", which
    // completes the slot just as surely. It sat outside the `allowLogging`
    // gate its siblings were behind.
    const { SessionDrawer } = await import("./PlanRedesign");
    const html = renderToStaticMarkup(
      <SessionDrawer
        session={session({ isCardio: true, isStrength: false })}
        today="2026-05-26"
        weeks={4}
        onClose={() => {}}
        moveAction={noop}
        skipAction={noop}
        unskipAction={noop}
        updateNotesAction={async () => ({ ok: true as const })}
        allowLogging={false}
      />,
    );
    expect(html).not.toContain('data-testid="link-activity-control"');
    // The empty flex wrapper carries a 12px margin, so the element must go too
    // (the class name still appears in the inline <style> block, so match the
    // attribute rather than the bare string).
    expect(html).not.toContain('class="drawer-cta-extras"');
    // Schedule controls are unaffected.
    expect(html).toContain('data-testid="plan-drawer-skip"');
  });

  it("still offers it when logging IS allowed (the Today rail)", async () => {
    const { SessionDrawer } = await import("./PlanRedesign");
    const html = renderToStaticMarkup(
      <SessionDrawer
        session={session({ isCardio: true, isStrength: false })}
        today="2026-05-26"
        weeks={4}
        onClose={() => {}}
        moveAction={noop}
        skipAction={noop}
        unskipAction={noop}
        updateNotesAction={async () => ({ ok: true as const })}
      />,
    );
    expect(html).toContain('data-testid="link-activity-control"');
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

  it("moves optional text beside the set number and keeps the value clean", async () => {
    const { SessionDrawer } = await import("./PlanRedesign");
    const items = Array.from({ length: 5 }, (_, index) => ({
      movementId: "ohp",
      movementName: "Overhead Press",
      kind: "back_off" as const,
      sets: 1,
      reps: 8,
      percentTm: 65,
      intensityLabel: "65% 1RM",
      repRange: { min: 8, max: 10 },
      ...(index >= 3 ? { optional: true } : {}),
    }));
    const html = renderToStaticMarkup(
      <SessionDrawer
        session={session({ items })}
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
    expect(html).toContain('class="set-row optional-set-row"');
    expect(html).toContain(
      '<span class="n">4<span class="optional-marker"> · optional</span></span>',
    );
    expect(html).toContain(
      '<span class="v"><span>65% 1RM × 8–10</span></span>',
    );
    expect(html).not.toContain("65% 1RM × 8–10 · optional");
    expect(html).toContain("overflow-wrap: anywhere");
    // The name column must stay able to shrink AND the value column must not be
    // an intrinsic `auto` track, or a long value squeezes the movement name to
    // zero width and `overflow-wrap: anywhere` breaks it one letter per line.
    expect(html).toContain("grid-template-columns: 36px minmax(0, 1fr) minmax(0, auto)");
    expect(html).not.toMatch(/\.set-row \.v \{[^}]*white-space: nowrap/);
    expect(html).toMatch(
      /@media\s*\(\s*max-width:\s*520px\s*\)[\s\S]*?optional-set-row[\s\S]*?grid-template-columns:\s*88px/,
    );
    expect(html).not.toMatch(
      /\.optional-marker\s*\{[^}]*opacity:/,
    );
  });
});

describe("SessionDrawer — ✎ Edit on a COMPLETED session opens the full session view", () => {
  /**
   * Owner report: "The edit button in the drawer for a finished session doesn't
   * really do anything smart. It offers me to edit the sets but that doesn't
   * make sense to do after a workout is already complete."
   *
   * Editing a PRESCRIPTION after the work is logged is meaningless, so for a
   * completed slot ✎ Edit navigates to the logged session
   * (`/app/sessions/<completedSessionId>`) — the single home (plan §6.9) for
   * "edit what actually happened".
   */
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
  const COMPLETED_ID = "c0ffee00-0000-4000-8000-000000000001";

  /** The single `<a …data-testid="plan-drawer-edit">` tag, or null. */
  function editAnchorTag(html: string): string | null {
    const m = html.match(/<a\s[^>]*data-testid="plan-drawer-edit"[^>]*>/);
    return m ? m[0] : null;
  }

  it("renders Edit as a link to the logged session, not a prescription-editor toggle", async () => {
    const { SessionDrawer } = await import("./PlanRedesign");
    const html = renderToStaticMarkup(
      <SessionDrawer
        session={session({ done: true, completedSessionId: COMPLETED_ID })}
        {...base}
      />,
    );
    // The Edit control ITSELF is the anchor to the full session view.
    const anchor = editAnchorTag(html);
    expect(anchor).not.toBeNull();
    expect(anchor).toContain(`href="/app/sessions/${COMPLETED_ID}"`);
    expect(html).not.toMatch(/<button[^>]*data-testid="plan-drawer-edit"/);
  });

  it("never renders the in-drawer prescription editor for a completed session", async () => {
    const { SessionDrawer } = await import("./PlanRedesign");
    const html = renderToStaticMarkup(
      <SessionDrawer
        session={session({ done: true, completedSessionId: COMPLETED_ID })}
        {...base}
      />,
    );
    // MovementEditList's root — the "edit the sets" surface the owner rejected.
    expect(html).not.toContain('data-testid="plan-drawer-edit-movements"');
    // …and Edit is not even a toggle that could reveal it: no aria-pressed.
    expect(html).not.toMatch(/data-testid="plan-drawer-edit"[^>]*aria-pressed/);
    expect(html).not.toMatch(/aria-pressed="[^"]*"[^>]*data-testid="plan-drawer-edit"/);
  });

  it("keeps exactly ONE affordance pointing at the full session view", async () => {
    // `CompletedSummaryCard` used to render its own "View full session →"
    // button to the same URL. Two buttons to one destination in one short
    // drawer is a worse affordance than one in the action row, so the card's
    // link was removed when ✎ Edit took over the destination.
    const { SessionDrawer } = await import("./PlanRedesign");
    const html = renderToStaticMarkup(
      <SessionDrawer
        session={session({ done: true, completedSessionId: COMPLETED_ID })}
        {...base}
      />,
    );
    expect(html).not.toContain('data-testid="plan-drawer-view-session"');
    const hrefCount = html.split(`href="/app/sessions/${COMPLETED_ID}"`).length - 1;
    expect(hrefCount).toBe(1);
  });

  it("leaves an UNFINISHED session on the in-drawer prescription editor toggle", async () => {
    const { SessionDrawer } = await import("./PlanRedesign");
    const html = renderToStaticMarkup(
      <SessionDrawer session={session()} {...base} />,
    );
    expect(html).toMatch(
      /<button[^>]*data-testid="plan-drawer-edit"[^>]*aria-pressed="false"/,
    );
    expect(html).not.toContain("Edit session");
  });

  it("keeps the toggle for a done slot that has no logged session to open", async () => {
    // `done` without `completedSessionId` (e.g. a slot marked done off-app):
    // there is no session view to navigate to, so today's behaviour stands.
    const { SessionDrawer } = await import("./PlanRedesign");
    const html = renderToStaticMarkup(
      <SessionDrawer session={session({ done: true })} {...base} />,
    );
    expect(html).toMatch(
      /<button[^>]*data-testid="plan-drawer-edit"[^>]*aria-pressed="false"/,
    );
  });

  it("keeps Plan's review-only stance intact (allowLogging=false)", async () => {
    // DC-K4 — navigation is not a mutation. Plan already exposed this
    // destination via the summary card, so the link adds no new capability;
    // the logging actions must still be absent.
    const { SessionDrawer } = await import("./PlanRedesign");
    const html = renderToStaticMarkup(
      <SessionDrawer
        session={session({ done: true, completedSessionId: COMPLETED_ID })}
        {...base}
        allowLogging={false}
      />,
    );
    const anchor = editAnchorTag(html);
    expect(anchor).not.toBeNull();
    expect(anchor).toContain(`href="/app/sessions/${COMPLETED_ID}"`);
    expect(html).not.toContain('data-testid="plan-drawer-mark-done"');
    expect(html).not.toContain('data-testid="plan-drawer-edit-movements"');

    const unfinished = renderToStaticMarkup(
      <SessionDrawer session={session()} {...base} allowLogging={false} />,
    );
    expect(unfinished).toMatch(
      /<button[^>]*data-testid="plan-drawer-edit"[^>]*aria-pressed="false"/,
    );
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
