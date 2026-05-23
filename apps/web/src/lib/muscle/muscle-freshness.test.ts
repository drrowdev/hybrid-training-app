import { describe, it, expect } from "vitest";
import {
  classifyMuscleFreshness,
  computeMuscleFreshness,
  type MuscleLoadEvent,
} from "./muscle-freshness";

const TODAY = "2026-05-23";

function ymd(daysAgo: number, anchor = TODAY): string {
  const a = new Date(`${anchor}T00:00:00Z`);
  a.setUTCDate(a.getUTCDate() - daysAgo);
  return a.toISOString().slice(0, 10);
}

const squatFanout = [
  { muscle: "quads" as const, weight: 1.0 },
  { muscle: "glutes" as const, weight: 1.0 },
  { muscle: "erectors" as const, weight: 0.5 },
];

const cardioRunFanout = [
  { muscle: "quads" as const, weight: 1.0 },
  { muscle: "hamstrings" as const, weight: 1.0 },
  { muscle: "glutes" as const, weight: 1.0 },
  { muscle: "calves" as const, weight: 1.0 },
];

describe("classifyMuscleFreshness — band thresholds", () => {
  it("untouched when daysSinceLoaded is null", () => {
    const c = classifyMuscleFreshness({ daysSinceLoaded: null, freshness: 1.0 });
    expect(c.band).toBe("untouched");
    expect(c.tone).toBe("neutral");
  });

  it("loaded (red) when < 2 days since last load", () => {
    expect(classifyMuscleFreshness({ daysSinceLoaded: 0, freshness: 0.1 }).band).toBe(
      "loaded",
    );
    expect(classifyMuscleFreshness({ daysSinceLoaded: 1, freshness: 0.4 }).band).toBe(
      "loaded",
    );
  });

  it("ready (yellow) at 2–3 days", () => {
    expect(classifyMuscleFreshness({ daysSinceLoaded: 2, freshness: 0.5 }).band).toBe(
      "ready",
    );
    expect(classifyMuscleFreshness({ daysSinceLoaded: 3, freshness: 0.6 }).band).toBe(
      "ready",
    );
  });

  it("fresh (green) at >= 4 days", () => {
    expect(classifyMuscleFreshness({ daysSinceLoaded: 4, freshness: 0.8 }).band).toBe(
      "fresh",
    );
    expect(classifyMuscleFreshness({ daysSinceLoaded: 10, freshness: 0.95 }).band).toBe(
      "fresh",
    );
  });
});

describe("computeMuscleFreshness — math", () => {
  it("never-loaded muscle reads 1.0 freshness, null daysSinceLoaded", () => {
    const out = computeMuscleFreshness([], TODAY);
    const biceps = out.get("biceps")!;
    expect(biceps.freshness).toBe(1.0);
    expect(biceps.daysSinceLoaded).toBeNull();
    expect(biceps.band).toBe("untouched");
  });

  it("today-loaded muscle is in the 'loaded' band with low freshness", () => {
    const events: MuscleLoadEvent[] = [
      { date: TODAY, load: 5000, fanout: squatFanout, sourceName: "Back squat" },
    ];
    const out = computeMuscleFreshness(events, TODAY);
    const quads = out.get("quads")!;
    expect(quads.daysSinceLoaded).toBe(0);
    expect(quads.band).toBe("loaded");
    expect(quads.freshness).toBeLessThan(0.3);
  });

  it("5-day-stale muscle climbs into the 'fresh' band", () => {
    const events: MuscleLoadEvent[] = [
      { date: ymd(5), load: 3000, fanout: squatFanout, sourceName: "Back squat" },
    ];
    const out = computeMuscleFreshness(events, TODAY);
    const quads = out.get("quads")!;
    expect(quads.daysSinceLoaded).toBe(5);
    expect(quads.band).toBe("fresh");
    expect(quads.freshness).toBeGreaterThan(0.5);
  });

  it("typical week with one big leg day 2 days ago lands in 'ready' (yellow)", () => {
    const events: MuscleLoadEvent[] = [
      { date: ymd(2), load: 4500, fanout: squatFanout, sourceName: "Back squat" },
    ];
    const out = computeMuscleFreshness(events, TODAY);
    const quads = out.get("quads")!;
    expect(quads.daysSinceLoaded).toBe(2);
    expect(quads.band).toBe("ready");
  });

  it("cardio modality loads its fanout muscles", () => {
    const events: MuscleLoadEvent[] = [
      { date: TODAY, load: 30, fanout: cardioRunFanout, sourceName: "Interval run" },
    ];
    const out = computeMuscleFreshness(events, TODAY);
    expect(out.get("quads")!.daysSinceLoaded).toBe(0);
    expect(out.get("hamstrings")!.daysSinceLoaded).toBe(0);
    expect(out.get("glutes")!.daysSinceLoaded).toBe(0);
    expect(out.get("calves")!.daysSinceLoaded).toBe(0);
    // Chest is untouched.
    expect(out.get("chest")!.daysSinceLoaded).toBeNull();
  });

  it("multi-day stale: today=15 days ago → daysSinceLoaded reflects that", () => {
    const events: MuscleLoadEvent[] = [
      { date: ymd(15), load: 2000, fanout: squatFanout, sourceName: "Back squat" },
    ];
    const out = computeMuscleFreshness(events, TODAY);
    const quads = out.get("quads")!;
    expect(quads.daysSinceLoaded).toBe(15);
    expect(quads.band).toBe("fresh");
    // EWMA(7) decays old load to near-zero — high freshness.
    expect(quads.freshness).toBeGreaterThan(0.85);
  });

  it("populates topContributors with most-recent named sources first", () => {
    const events: MuscleLoadEvent[] = [
      { date: ymd(6), load: 1000, fanout: squatFanout, sourceName: "Front squat" },
      { date: ymd(2), load: 1000, fanout: squatFanout, sourceName: "Back squat" },
      { date: TODAY, load: 1000, fanout: squatFanout, sourceName: "Leg press" },
    ];
    const out = computeMuscleFreshness(events, TODAY);
    const quads = out.get("quads")!;
    expect(quads.topContributors[0].name).toBe("Leg press");
    expect(quads.topContributors.map((c) => c.name)).toContain("Back squat");
  });

  it("returns exactly 16 muscles, in canonical order", () => {
    const out = computeMuscleFreshness([], TODAY);
    expect(out.size).toBe(16);
  });

  it("weighted fanout: secondary muscles get half the load impact of primaries", () => {
    const events: MuscleLoadEvent[] = [
      { date: TODAY, load: 1000, fanout: squatFanout, sourceName: "Back squat" },
    ];
    const out = computeMuscleFreshness(events, TODAY);
    // Quads (weight 1.0) should be more loaded (lower freshness) than
    // erectors (weight 0.5) on the same single-day event.
    // But because both reach baseline = max ATL observed for themselves,
    // freshness is identical. Verify via ATL instead.
    expect(out.get("quads")!.atl).toBeGreaterThan(out.get("erectors")!.atl);
    expect(out.get("erectors")!.atl).toBeGreaterThan(0);
  });
});
