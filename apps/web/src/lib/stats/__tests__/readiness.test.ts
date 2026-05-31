import { describe, it, expect } from "vitest";
import { composeReadiness, READINESS_BUILDING_WEEK_THRESHOLD } from "../readiness";
import type { LoadBalance } from "../load-balance";
import type { RpeDrift } from "../rpe-drift-queries";
import type { OutputTrend } from "../output-trend";

function lb(ratio: number | null, weeksOfData: number): LoadBalance {
  const acute = ratio == null ? 0 : ratio * 1000;
  const chronic = ratio == null ? 0 : 1000;
  const band =
    ratio == null
      ? "unknown"
      : ratio < 0.8
      ? "detraining"
      : ratio < 1.3
      ? "productive"
      : ratio < 1.5
      ? "pushing"
      : "spiking";
  return { bodyAcute: acute, bodyChronic: chronic, ratio, band, weeksOfData };
}

function drift(verdict: RpeDrift["verdict"]): RpeDrift {
  return {
    verdict,
    verdictLabel: verdict,
    slopePerDay: verdict === "rising" ? 0.05 : verdict === "easing" ? -0.05 : 0,
    meanRpe: 7,
    points: [],
  };
}

function output(direction: OutputTrend["direction"]): OutputTrend {
  return {
    direction,
    detail: direction,
    recentPrCount: direction === "rising" ? 2 : direction === "falling" ? 0 : 1,
    priorPrCount: direction === "rising" ? 0 : direction === "falling" ? 2 : 1,
  };
}

describe("composeReadiness — verdict matrix", () => {
  it("cold-start: weeksOfData < 4 → 'building' regardless of signals", () => {
    const r = composeReadiness(lb(1.0, 1), drift("rising"), output("falling"));
    expect(r.verdict).toBe("building");
    expect(r.confidence).toBe("building");
    expect(r.signalsAgree).toBe(0);
    expect(r.headline).toContain(`1 of ${READINESS_BUILDING_WEEK_THRESHOLD}`);
    expect(r.subtext).toMatch(/bands personalize/i);
  });

  it("cold-start exact-threshold boundary: weeks == 4 → no longer building", () => {
    const r = composeReadiness(lb(1.0, 4), drift("stable"), output("rising"));
    expect(r.verdict).not.toBe("building");
    expect(r.confidence).not.toBe("building");
  });

  it("productive + signals agree → 'productive' / 'agree' / 3", () => {
    const r = composeReadiness(lb(1.05, 8), drift("stable"), output("rising"));
    expect(r.verdict).toBe("productive");
    expect(r.confidence).toBe("agree");
    expect(r.signalsAgree).toBe(3);
    expect(r.subtext).toMatch(/being absorbed/i);
  });

  it("productive + rising effort + falling output → 'watch' / 'mixed'", () => {
    const r = composeReadiness(lb(1.05, 8), drift("rising"), output("falling"));
    expect(r.verdict).toBe("watch");
    expect(r.confidence).toBe("mixed");
    // headline band stays "productive", but the agreement is degraded.
    expect(r.signalsAgree).toBeLessThan(3);
    expect(r.subtext).toMatch(/mild overreach/i);
  });

  it("pushing + stable effort + rising output → 'pushing-tolerated' / 'agree'", () => {
    const r = composeReadiness(lb(1.42, 8), drift("stable"), output("rising"));
    expect(r.verdict).toBe("pushing-tolerated");
    expect(r.confidence).toBe("agree");
    expect(r.signalsAgree).toBe(3);
  });

  it("spiking + rising effort + falling output → 'overreaching' / 'mixed'", () => {
    const r = composeReadiness(lb(1.55, 8), drift("rising"), output("falling"));
    expect(r.verdict).toBe("overreaching");
    expect(r.confidence).toBe("mixed");
    expect(r.signalsAgree).toBeLessThan(3);
    expect(r.subtext).toMatch(/lighter week/i);
  });

  it("pushing + rising effort + falling output → 'overreaching'", () => {
    const r = composeReadiness(lb(1.35, 8), drift("rising"), output("falling"));
    expect(r.verdict).toBe("overreaching");
  });

  it("detraining → 'detraining' verdict regardless of corroborators", () => {
    const r = composeReadiness(lb(0.5, 8), drift("stable"), output("flat"));
    expect(r.verdict).toBe("detraining");
    expect(r.subtext).toMatch(/baseline/i);
  });

  it("gauge marker position is clamp(ratio/2.0, 0, 1) * 100", () => {
    expect(composeReadiness(lb(1.0, 8), drift("stable"), output("flat")).gaugeMarkerPct).toBe(50);
    expect(composeReadiness(lb(0.5, 8), drift("stable"), output("flat")).gaugeMarkerPct).toBe(25);
    // Clamped at 100 above 2.0.
    expect(composeReadiness(lb(2.5, 8), drift("stable"), output("flat")).gaugeMarkerPct).toBe(100);
    // No ratio → 0.
    expect(composeReadiness(lb(null, 8), drift("no-data"), output("no-data")).gaugeMarkerPct).toBe(0);
  });

  it("summary echoes the underlying signals so the card can render them", () => {
    const r = composeReadiness(lb(1.05, 8), drift("stable"), output("rising"));
    expect(r.summary.loadBalance.ratio).toBeCloseTo(1.05);
    expect(r.summary.rpeDrift.verdict).toBe("stable");
    expect(r.summary.outputTrend.direction).toBe("rising");
  });

  it("productive with no-data corroborators stays 'productive' but agreement < 3", () => {
    const r = composeReadiness(lb(1.0, 8), drift("no-data"), output("no-data"));
    expect(r.verdict).toBe("productive");
    expect(r.signalsAgree).toBeLessThan(3);
    expect(r.confidence).toBe("mixed");
  });

  it("productive + easing effort + flat output → still 'productive' / 'agree'", () => {
    const r = composeReadiness(lb(0.95, 8), drift("easing"), output("flat"));
    expect(r.verdict).toBe("productive");
    expect(r.signalsAgree).toBe(3);
    expect(r.confidence).toBe("agree");
  });
});
