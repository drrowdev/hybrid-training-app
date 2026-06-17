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
  StrengthDrawer,
  ReadinessDrawer,
  EnduranceDrawer,
  ConsistencyDrawer,
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
        {
          movementId: "sq",
          slug: "back-squat",
          label: "Back Squat",
          pointCount: 6,
          slopePerWeek: 1.4,
          direction: "up",
          points: [
            { performedAt: "2026-03-01", e1rm: 140 },
            { performedAt: "2026-03-15", e1rm: 144 },
            { performedAt: "2026-04-01", e1rm: 148 },
            { performedAt: "2026-04-15", e1rm: 150 },
            { performedAt: "2026-05-01", e1rm: 152 },
            { performedAt: "2026-05-20", e1rm: 155 },
          ],
        },
        {
          movementId: "bp",
          slug: "bench-press",
          label: "Bench Press",
          pointCount: 5,
          slopePerWeek: 0.3,
          direction: "flat",
          points: [
            { performedAt: "2026-03-01", e1rm: 100 },
            { performedAt: "2026-03-20", e1rm: 101 },
            { performedAt: "2026-04-10", e1rm: 100 },
            { performedAt: "2026-05-01", e1rm: 102 },
            { performedAt: "2026-05-20", e1rm: 101 },
          ],
        },
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
      weeklyPace: [330, 326, 321, 316, 312],
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
      planStrength: true,
      planCardio: true,
      usesAdaptiveEngine: true,
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
    units: "metric",
    formatProfile: { timezone: "Europe/Helsinki" },
    relevance: { strength: true, cardio: true },
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
      "stats-tile-volume",
    ]) {
      expect(html).toContain(`data-testid="${id}"`);
    }
  });

  it("exposes the strength tile drawer affordance when there is data", () => {
    expect(html).toContain('data-testid="stats-strength-expand"');
  });

  it("exposes the recovery & load drawer affordance", () => {
    expect(html).toContain('data-testid="stats-recovery-expand"');
  });

  it("exposes the endurance and consistency drawer affordances", () => {
    expect(html).toContain('data-testid="stats-endurance-expand"');
    expect(html).toContain('data-testid="stats-consistency-expand"');
  });

  it("renders the range toggle with all three options", () => {
    expect(html).toContain('data-testid="stats-range-toggle"');
    expect(html).toContain('data-range="30d"');
    expect(html).toContain('data-range="90d"');
    expect(html).toContain('data-range="all"');
  });

  it("renders training-volume tonnage bars from real data", () => {
    expect(html).toContain('data-testid="stats-tile-volume"');
    expect(html).toContain('data-testid="stats-volume-bar"');
    // 124,000 kg total → grouped, locale-independent
    expect(html).toContain("124,000");
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
      weeklyPace: [],
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

  it("hides the strength drawer affordance when there is no lift data", () => {
    expect(html).not.toContain('data-testid="stats-strength-expand"');
  });

  it("hides the endurance drawer affordance when there are no runs", () => {
    expect(html).not.toContain('data-testid="stats-endurance-expand"');
  });
});

describe("StrengthDrawer - per-lift e1RM detail", () => {
  const open = renderToStaticMarkup(
    <StrengthDrawer open onClose={() => {}} data={bucket().strength} range="90d" />,
  );

  it("renders one detail row per lift with a sparkline", () => {
    const rows = open.match(/data-testid="stats-strength-drawer-lift"/g) ?? [];
    expect(rows).toHaveLength(2);
    // Sparkline primitive is wired in (the whole point of this slice).
    expect(open).toContain('data-testid="sparkline-line"');
  });

  it("deep-links each lift to its movement history page", () => {
    expect(open).toContain("/app/stats/movements/back-squat");
    expect(open).toContain("/app/stats/movements/bench-press");
  });

  it("renders nothing when closed", () => {
    const closed = renderToStaticMarkup(
      <StrengthDrawer open={false} onClose={() => {}} data={bucket().strength} range="90d" />,
    );
    expect(closed).toBe("");
  });
});

describe("ReadinessDrawer - ACWR drilldown", () => {
  const open = renderToStaticMarkup(
    <ReadinessDrawer open onClose={() => {}} readiness={readiness()} />,
  );

  it("renders the three corroborating signals", () => {
    const rows = open.match(/data-testid="stats-recovery-signal"/g) ?? [];
    expect(rows).toHaveLength(3);
  });

  it("surfaces the acute:chronic ratio and the signals-agree count", () => {
    expect(open).toContain("1.08");
    expect(open).toContain('data-testid="stats-recovery-confidence"');
    expect(open).toContain("2 of 3 signals agree");
  });

  it("notes readiness is display-only and does not link out", () => {
    expect(open).toContain("readiness never feeds workout prescription");
    expect(open).not.toContain('data-testid="stats-recovery-engine-link"');
  });

  it("flags a provisional band in cold-start (weeksOfData < 4)", () => {
    const cold = renderToStaticMarkup(
      <ReadinessDrawer
        open
        onClose={() => {}}
        readiness={readiness({
          confidence: "building",
          summary: {
            rpeDrift: { verdict: "no-data", verdictLabel: "No data", slopePerDay: 0, meanRpe: null },
            outputTrend: { direction: "no-data", detail: "Not enough PR history yet.", recentPrCount: 0, priorPrCount: 0 },
            loadBalance: { bodyAcute: 0, bodyChronic: 0, ratio: null, band: "unknown", weeksOfData: 1 },
          },
        })}
      />,
    );
    expect(cold).toContain("building baseline");
    expect(cold).toMatch(/1 week of history/);
  });

  it("renders nothing when closed", () => {
    const closed = renderToStaticMarkup(
      <ReadinessDrawer open={false} onClose={() => {}} readiness={readiness()} />,
    );
    expect(closed).toBe("");
  });
});

describe("EnduranceDrawer - pace trend + time-in-zone", () => {
  it("renders the pace sparkline series and easy-run counts", () => {
    const open = renderToStaticMarkup(
      <EnduranceDrawer open onClose={() => {}} data={bucket().endurance} range="90d" />,
    );
    // 9 of 12 runs easy, 1 dropped (from the bucket() endurance fixture)
    expect(open).toContain("9 of 12 runs counted as easy");
    expect(open).toContain("1 dropped");
    expect(open).toContain("lower = faster");
  });

  it("renders absolute per-zone minutes + bpm bands when zone data is present", () => {
    const withZones = bucket({
      endurance: {
        ...bucket().endurance,
        timeInZone: {
          kind: "ok",
          totals: { Z1: 600, Z2: 3600, Z3: 1200, Z4: 300, Z5: 0 },
          split: { easyPct: 0.7, thresholdPct: 0.2, hardPct: 0.05 },
          bands: { z1Max: 120, z2Max: 140, z3Max: 160, z4Max: 175 },
          activityCount: 6,
          droppedCount: 1,
          windowDays: 28,
          source: "measured",
        },
      },
    }).endurance;
    const open = renderToStaticMarkup(
      <EnduranceDrawer open onClose={() => {}} data={withZones} range="90d" />,
    );
    const rows = open.match(/data-testid="stats-endurance-zone-row"/g) ?? [];
    expect(rows).toHaveLength(5);
    expect(open).toContain("60 min"); // Z2 = 3600s = 60 min
    expect(open).toContain("bpm");
    expect(open).toContain("from measured HR streams");
    expect(open).toContain("70% easy");
  });

  it("shows the zone gating note when HR zones are unavailable", () => {
    const open = renderToStaticMarkup(
      <EnduranceDrawer open onClose={() => {}} data={bucket().endurance} range="90d" />,
    );
    expect(open).toContain("Connect Strava to see time-in-zone");
  });

  it("renders nothing when closed", () => {
    const closed = renderToStaticMarkup(
      <EnduranceDrawer open={false} onClose={() => {}} data={bucket().endurance} range="90d" />,
    );
    expect(closed).toBe("");
  });
});

describe("ConsistencyDrawer - rhythm summary + adherence deep link", () => {
  const props = baseProps();
  const open = renderToStaticMarkup(
    <ConsistencyDrawer open onClose={() => {}} rhythm={props.rhythm} streak={props.streak} />,
  );

  it("renders a week-by-week row per rhythm week", () => {
    const rows = open.match(/data-testid="stats-consistency-week-row"/g) ?? [];
    expect(rows).toHaveLength(props.rhythm.weeks.length);
  });

  it("surfaces the current streak and deep-links to the adherence dashboard", () => {
    expect(open).toContain("Current streak");
    expect(open).toContain('data-testid="stats-consistency-adherence-link"');
    expect(open).toContain("/app/stats/adherence");
  });

  it("renders nothing when closed", () => {
    const closed = renderToStaticMarkup(
      <ConsistencyDrawer open={false} onClose={() => {}} rhythm={props.rhythm} streak={props.streak} />,
    );
    expect(closed).toBe("");
  });
});
