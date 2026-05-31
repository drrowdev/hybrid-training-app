import { describe, it, expect } from "vitest";
import { classifyOutputTrend } from "../output-trend";

describe("classifyOutputTrend — pure heuristic classifier", () => {
  it("returns no-data when both windows are empty", () => {
    const out = classifyOutputTrend(0, 0);
    expect(out.direction).toBe("no-data");
    expect(out.recentPrCount).toBe(0);
    expect(out.priorPrCount).toBe(0);
    expect(out.detail).toMatch(/no recent prs/i);
  });

  it("rising — at least one PR and recent strictly exceeds prior by ≥1", () => {
    const out = classifyOutputTrend(2, 1);
    expect(out.direction).toBe("rising");
    expect(out.detail).toMatch(/absorbed/i);
  });

  it("rising — first PRs after a dry prior window", () => {
    expect(classifyOutputTrend(1, 0).direction).toBe("rising");
    expect(classifyOutputTrend(3, 0).direction).toBe("rising");
  });

  it("falling — strictly fewer PRs in the recent window", () => {
    const out = classifyOutputTrend(0, 2);
    expect(out.direction).toBe("falling");
    expect(out.detail).toMatch(/slipping/i);
  });

  it("falling — even small regressions count", () => {
    expect(classifyOutputTrend(1, 2).direction).toBe("falling");
    expect(classifyOutputTrend(2, 3).direction).toBe("falling");
  });

  it("flat — recent == prior (when non-zero)", () => {
    const out = classifyOutputTrend(1, 1);
    expect(out.direction).toBe("flat");
    expect(out.detail).toMatch(/steady/i);
  });

  it("flat — when recent matches prior but neither dominates (e.g. 2 vs 2)", () => {
    expect(classifyOutputTrend(2, 2).direction).toBe("flat");
  });

  it("detail mentions counts singular vs plural correctly", () => {
    expect(classifyOutputTrend(1, 0).detail).toMatch(/1 new pr\b/i);
    expect(classifyOutputTrend(3, 0).detail).toMatch(/3 new prs\b/i);
    expect(classifyOutputTrend(0, 1).detail).toMatch(/0 prs?\b/i);
  });
});
