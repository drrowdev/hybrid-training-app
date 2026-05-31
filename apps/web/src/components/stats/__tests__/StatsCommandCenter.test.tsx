/**
 * StatsCommandCenter — render contract for the Direction-C2 bento.
 *
 * The repo intentionally avoids @testing-library/react (see notes on
 * `CardioPrescriptionList.test.tsx`); we drive these via
 * `renderToStaticMarkup` and assert the rendered surface contract. Data
 * correctness is covered by the Phase-1 query suites (strength-progress,
 * endurance-progress, progress-verdict, weekly-rhythm, streak). Here we
 * verify two things the wiring must never get wrong:
 *   1. The populated state renders every hero cell + bento tile testid.
 *   2. The cold-start state renders honest empty states (no fabricated
 *      zeros, no crash on null latest bodyweight / no-run cardio).
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  StatsCommandCenter,
  type StatsCommandCenterProps,
  type StatsRangeBucket,
} from "../StatsCommandCenter";
import type { Readiness } from "@/lib/stats/readiness";

export function bucket(overrides: Partial<StatsRangeBucket> = {}): StatsRangeBucket {
  return {
    adherence: {
      completed: 18,
      scheduled: 24,
      skipped: 2,
      missed: 4,
      ratio: 0.75,
      onTime: 16,
      lateLogged: 2,
      accidentallyMissed: 4,
    },
    prs: { uniqueMovementCount: 3, topThree: [], windowDays: 90 },
    volume: {
      totalKg: 124000,
      weeklyKg: [38000, 41000, 45000],
      weekStarts: ["2026-05-11", "2026-05-18", "2026-05-25"],
      windowDays: 90,
    },
    strength: {
      direction: "up",
      perLift: [
        { movementId: "sq", label: "Back Squat", pointCount: 6, slopePerWeek: 1.4, direction: "up" },
        { movementId: "bp", label: "Bench Press", pointCount: 5, slopePerWeek: 0.3, direction: "flat" },
      ],
      detail: "Squat and bench trending up over the window.",
      windowDays: 90,
    },
    endurance: {
      direction: "up",
      easyPaceSecPerKm: 318,
      slopeSecPerKmPerWeek: -2.1,
      sampleRuns: 9,
      droppedRuns: 1,
      totalRuns: 12,
      timeInZone: { kind: "no-strava" },
      detail: "Easy pace improving ~2s/km per week.",
      windowDays: 90,
    },
    verdict: {
      verdict: "up",
      label: "Progressing",
      proofChips: [
        { modality: "strength", direction: "up", text: "Squat +1.4 kg/wk" },
        { modality: "endurance", direction: "up", text: "Easy pace -2s/km/wk" },
      ],
      detail: "Both modalities moving the right way.",
    },
    ...overrides,
  };
}

export function readiness(overrides: Partial<Readiness> = {}): Readiness {
  return {
    verdict: "productive",
    verdictLabel: "Productive",
    headline: "Load is in the productive band.",
    subtext: "Acute:chronic ratio sits in the sweet spot.",
    confidence: "agree",
    signalsAgree: 2,
    gaugeMarkerPct: 58,
    summary: {
      rpeDrift: { verdict: "stable", verdictLabel: "Stable", slopePerDay: 0.004, meanRpe: 7.2 },
      outputTrend: { direction: "rising", detail: "PRs up vs prior block.", recentPrCount: 3, priorPrCount: 1 },
      loadBalance: {
        bodyAcute: 410,
        bodyChronic: 380,
        ratio: 1.08,
        band: "productive",
        weeksOfData: 8,
      },
    },
    ...overrides,
  };
}

export function baseProps(overrides: Partial<StatsCommandCenterProps> = {}): StatsCommandCenterProps {
  return {
    initialRange: "90d",
    byRange: { "30d": bucket(), "90d": bucket(), all: bucket() },
    block: {
      blockId: "blk-1",
      archetypeName: "Hybrid Base",
      weeks: 4,
      daysPerWeek: 4,
      currentWeek: 2,
      currentDayInWeek: 3,
      totalScheduled: 16,
      scheduledToDate: 7,
      logged: 6,
      skipped: 1,
    },
    readiness: readiness(),
    streak: {
      currentStreakWeeks: 5,
      weeklyTarget: 4,
      thisWeekCompleted: 2,
      thisWeekTarget: 4,
      hasActiveBlock: true,
    },
    rhythm: {
      weeks: [
        { weekStart: "2026-05-11", strengthCount: 2, cardioCount: 2, plannedCount: 4 },
        { weekStart: "2026-05-18", strengthCount: 3, cardioCount: 1, plannedCount: 4 },
        { weekStart: "2026-05-25", strengthCount: 2, cardioCount: 2, plannedCount: 4 },
      ],
    },
    freshness: [
      { region: "lower", regionLabel: "Lower body", freshness: 0.82, band: "fresh", accent: "success" },
      { region: "upper", regionLabel: "Upper body", freshness: 0.41, band: "recovering", accent: "warning" },
    ],
    bodyweight: {
      latest: { date: "2026-05-29", kg: 82.5 },
      delta30dKg: -0.6,
      series: [
        { date: "2026-05-01", kg: 83.1 },
        { date: "2026-05-15", kg: 82.8 },
        { date: "2026-05-29", kg: 82.5 },
      ],
    },
    decisionTrace: {
      headline: "Today's session: Lower strength",
      reasons: [
        { text: "Lower body is fresh, so the engine scheduled squat volume." },
        { text: "Cardio kept easy to protect tomorrow's interval session." },
      ],
      noBlock: false,
      restDay: false,
    },
    units: "metric",
    formatProfile: { timezone: "Europe/Helsinki" },
    ...overrides,
  };
}

describe("StatsCommandCenter - populated state", () => {
  const html = renderToStaticMarkup(<StatsCommandCenter {...baseProps()} />);

  it("renders the hero cells", () => {
    expect(html).toContain('data-testid="stats-progress-verdict"');
    expect(html).toContain('data-testid="stats-readiness-cell"');
    expect(html).toContain('data-testid="stats-card-adherence"');
  });

  it("renders all six bento tiles", () => {
    for (const id of [
      "stats-tile-strength",
      "stats-tile-endurance",
      "stats-card-freshness",
      "stats-tile-consistency",
      "stats-card-bodyweight",
      "stats-tile-decision-trace",
    ]) {
      expect(html).toContain(`data-testid="${id}"`);
    }
  });

  it("renders the range toggle with all three options", () => {
    expect(html).toContain('data-testid="stats-range-toggle"');
    expect(html).toContain('data-range="30d"');
    expect(html).toContain('data-range="90d"');
    expect(html).toContain('data-range="all"');
  });

  it("surfaces real decision-trace reasons (not a template)", () => {
    expect(html).toContain("Lower body is fresh");
    expect(html).toContain('data-testid="stats-decision-reason"');
  });

  it("renders the active-block context", () => {
    expect(html).toContain('data-testid="stats-card-active-block"');
    expect(html).toContain("Hybrid Base");
  });

  it("renders bodyweight from real data", () => {
    expect(html).toContain('data-testid="stats-card-bodyweight"');
    expect(html).toContain("82.5");
  });
});

describe("StatsCommandCenter - cold-start state", () => {
  const coldBucket: StatsRangeBucket = bucket({
    strength: { direction: "building", perLift: [], detail: "Log a few more sessions to see lift trends.", windowDays: 30 },
    endurance: {
      direction: "no-run-data",
      easyPaceSecPerKm: null,
      slopeSecPerKmPerWeek: null,
      sampleRuns: 0,
      droppedRuns: 0,
      totalRuns: 0,
      timeInZone: { kind: "no-strava" },
      detail: "Connect Strava or log runs to see pace and zone trends.",
      windowDays: 30,
    },
    verdict: { verdict: "building", label: "Building baseline", proofChips: [], detail: "Not enough data yet." },
    prs: { uniqueMovementCount: 0, topThree: [], windowDays: 30 },
  });

  const html = renderToStaticMarkup(
    <StatsCommandCenter
      {...baseProps({
        initialRange: "30d",
        byRange: { "30d": coldBucket, "90d": coldBucket, all: coldBucket },
        block: null,
        readiness: readiness({
          verdict: "building",
          verdictLabel: "Building",
          confidence: "building",
          signalsAgree: 0,
          summary: {
            rpeDrift: { verdict: "no-data", verdictLabel: "No data", slopePerDay: 0, meanRpe: null },
            outputTrend: { direction: "flat", detail: "Not enough PR history yet.", recentPrCount: 0, priorPrCount: 0 },
            loadBalance: { bodyAcute: 0, bodyChronic: 0, ratio: null, band: "unknown", weeksOfData: 1 },
          },
        }),
        streak: { currentStreakWeeks: 0, weeklyTarget: 3, thisWeekCompleted: 0, thisWeekTarget: 3, hasActiveBlock: false },
        bodyweight: { latest: null, delta30dKg: null, series: [] },
        decisionTrace: { headline: "No active block", reasons: [], noBlock: true, restDay: false },
      })}
    />,
  );

  it("renders without throwing on null bodyweight + no-run cardio + no block", () => {
    expect(html).toContain('data-testid="stats-bento"');
  });

  it("shows an honest empty bodyweight state instead of a fake zero", () => {
    expect(html).toContain("No bodyweight logged");
  });

  it("still renders the hero cells in the building state", () => {
    expect(html).toContain('data-testid="stats-progress-verdict"');
    expect(html).toContain('data-testid="stats-readiness-cell"');
  });
});
