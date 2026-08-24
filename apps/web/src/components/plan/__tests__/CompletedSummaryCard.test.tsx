/**
 * CompletedSummaryBody — what a lifter sees in the drawer after logging.
 *
 * Asserts on rendered values and structure, not on prose.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CompletedSummaryBody } from "../CompletedSummaryCard";
import type { CompletedSessionSummary } from "@/lib/sessions/completed-summary-action";
import type { RecapMovement } from "@/lib/sessions/session-recap";

function summary(over: Partial<CompletedSessionSummary> = {}): CompletedSessionSummary {
  return {
    sessionId: "s1",
    performedAtIso: "2026-06-22T07:00:00Z",
    durationMin: 49,
    distanceKm: null,
    avgHrBpm: null,
    maxHrBpm: null,
    modalityLabel: null,
    rpe: 7.1,
    isCardio: false,
    units: "metric",
    lifts: [],
    ...over,
  };
}

const squat: RecapMovement = {
  movementId: "mv-squat",
  name: "Squat",
  groups: [
    {
      kind: "main",
      entries: [
        { sets: 3, measure: { type: "reps", reps: 5 }, weightKg: 100 },
        { sets: 1, measure: { type: "reps", reps: 3 }, weightKg: 110 },
      ],
    },
  ],
  warmupSets: 3,
  skippedSets: 0,
  skipReasons: [],
};

const ready = (s: CompletedSessionSummary) =>
  renderToStaticMarkup(<CompletedSummaryBody state="ready" summary={s} />);

describe("CompletedSummaryBody", () => {
  it("shows each lift with its sets, reps and loads", () => {
    const html = ready(summary({ lifts: [squat] }));
    expect(html).toContain("Squat");
    expect(html).toContain("3×5");
    expect(html).toContain("100 kg");
    // The top single was a different load, so it must not be folded away.
    expect(html).toContain("1×3");
    expect(html).toContain("110 kg");
  });

  it("counts warm-ups instead of listing them", () => {
    expect(ready(summary({ lifts: [squat] }))).toContain("3 warm-ups");
  });

  it("renders loads in the lifter's unit", () => {
    const html = ready(summary({ units: "imperial", lifts: [squat] }));
    expect(html).toContain("lb");
    expect(html).not.toContain("100 kg");
  });

  it("shows a bodyweight set without inventing a load", () => {
    const html = ready(
      summary({
        lifts: [
          {
            ...squat,
            warmupSets: 0,
            groups: [
              {
                kind: "accessory",
                entries: [{ sets: 3, measure: { type: "reps", reps: 10 }, weightKg: null }],
              },
            ],
          },
        ],
      }),
    );
    expect(html).toContain("3×10");
    expect(html).not.toContain("0 kg");
  });

  it("shows a hold as time and a carry as distance", () => {
    const html = ready(
      summary({
        lifts: [
          {
            ...squat,
            warmupSets: 0,
            groups: [
              {
                kind: "tendon",
                entries: [{ sets: 3, measure: { type: "duration", seconds: 30 }, weightKg: null }],
              },
              {
                kind: "accessory",
                entries: [{ sets: 2, measure: { type: "distance", metres: 30 }, weightKg: 24 }],
              },
            ],
          },
        ],
      }),
    );
    expect(html).toContain("3×30");
    expect(html).toContain("s");
    expect(html).toContain("2×30");
    expect(html).toContain("24 kg");
  });

  it("keeps a fully skipped lift visible, with its reason", () => {
    const html = ready(
      summary({
        lifts: [
          {
            movementId: "mv-ohp",
            name: "Overhead Press",
            groups: [],
            warmupSets: 0,
            skippedSets: 2,
            // The column stores the allowlist slug; the drawer must not.
            skipReasons: ["pain"],
          },
        ],
      }),
    );
    expect(html).toContain("Overhead Press");
    expect(html).toContain("2 skipped");
    expect(html).toContain("Pain");
    expect(html).not.toContain("(pain)");
  });

  it("distinguishes a session that failed to load from one with nothing in it", () => {
    const failed = renderToStaticMarkup(
      <CompletedSummaryBody state="unavailable" summary={null} />,
    );
    expect(failed).toContain('role="alert"');
    expect(failed).not.toContain('data-testid="plan-drawer-recap-empty"');

    const empty = ready(summary({ durationMin: null, rpe: null }));
    expect(empty).not.toContain('role="alert"');
    expect(empty).toContain('data-testid="plan-drawer-recap-empty"');
  });

  it("still shows cardio stats for a session with no lifts", () => {
    const html = ready(summary({ isCardio: true, distanceKm: 8.36, avgHrBpm: 152 }));
    expect(html).toContain("8.36 km");
    expect(html).toContain("152 bpm");
    expect(html).not.toContain('data-testid="plan-drawer-recap-empty"');
  });

  it("renders distance in the lifter's unit too, not just loads", () => {
    const html = ready(summary({ isCardio: true, distanceKm: 8.36, units: "imperial" }));
    expect(html).toContain("mi");
    expect(html).not.toContain("8.36 km");
  });

  it("renders one row per lift", () => {
    const html = ready(
      summary({ lifts: [squat, { ...squat, movementId: "mv-bench", name: "Bench Press" }] }),
    );
    expect(html.match(/data-testid="plan-drawer-recap-movement"/g)).toHaveLength(2);
  });
});
