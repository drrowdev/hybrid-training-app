import { describe, it, expect } from "vitest";
import { detectPrs, PR_KIND_LABEL, prValueSuffix } from "../pr";

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

describe("detectPrs — three kinds", () => {
  it("first ever set on a movement → weight PR + e1RM PR (no reps-at-weight PR)", () => {
    const res = detectPrs({ weight: 100, reps: 5 }, []);
    const kinds = res.hits.map((h) => h.kind);
    expect(kinds).toContain("weight");
    expect(kinds).toContain("e1rm");
    expect(kinds).not.toContain("reps_at_weight");
  });

  it("heavier weight than ever → weight PR fires", () => {
    const history = [
      { weight: 100, reps: 5, performed_at: daysAgo(7) },
      { weight: 105, reps: 3, performed_at: daysAgo(3) },
    ];
    const res = detectPrs({ weight: 110, reps: 1 }, history);
    const weightHit = res.hits.find((h) => h.kind === "weight");
    expect(weightHit).toBeDefined();
    expect(weightHit?.value).toBe(110);
    expect(weightHit?.previousBest).toBe(105);
    expect(weightHit?.daysSincePrevious).toBe(3);
  });

  it("same weight, more reps → reps-at-weight PR fires (no weight PR)", () => {
    const history = [
      { weight: 100, reps: 3, performed_at: daysAgo(10) },
      { weight: 100, reps: 5, performed_at: daysAgo(7) },
    ];
    const res = detectPrs({ weight: 100, reps: 6 }, history);
    const kinds = res.hits.map((h) => h.kind);
    expect(kinds).toContain("reps_at_weight");
    expect(kinds).not.toContain("weight");
  });

  it("higher estimated 1RM → e1RM PR fires", () => {
    const history = [
      // 100 × 5 → Epley = 116.67
      { weight: 100, reps: 5, performed_at: daysAgo(7) },
    ];
    // 110 × 3 → Epley = 121, higher than 116.67
    const res = detectPrs({ weight: 110, reps: 3 }, history);
    const e1rmHit = res.hits.find((h) => h.kind === "e1rm");
    expect(e1rmHit).toBeDefined();
  });

  it("grinder RPE 10 set is excluded from PR detection", () => {
    const res = detectPrs({ weight: 200, reps: 5, rpe: 10 }, []);
    expect(res.hits).toHaveLength(0);
  });

  it("RPE 9 set is eligible for PRs", () => {
    const res = detectPrs({ weight: 200, reps: 5, rpe: 9 }, []);
    expect(res.hits.length).toBeGreaterThan(0);
  });

  it("zero weight / reps yields no PRs", () => {
    expect(detectPrs({ weight: 0, reps: 5 }, []).hits).toHaveLength(0);
    expect(detectPrs({ weight: 100, reps: 0 }, []).hits).toHaveLength(0);
  });

  it("tied performance does not fire a PR", () => {
    const history = [{ weight: 100, reps: 5, performed_at: daysAgo(7) }];
    const res = detectPrs({ weight: 100, reps: 5 }, history);
    expect(res.hits.find((h) => h.kind === "weight")).toBeUndefined();
    expect(res.hits.find((h) => h.kind === "reps_at_weight")).toBeUndefined();
  });

  it("conservative dispatcher prevents low-RPE inflation from firing false e1RM PRs", () => {
    const history = [
      // Heavy historical set with no RPE: Epley = 110 × (1 + 3/30) = 121
      { weight: 110, reps: 3, performed_at: daysAgo(7) },
    ];
    // New set 100 × 5 @ RPE 6 — RPE-based 1RM = 100/0.774 = 129, BUT Epley = 116.67
    // Conservative dispatcher takes min = 116.67. Not a PR over 121.
    const res = detectPrs({ weight: 100, reps: 5, rpe: 6 }, history);
    expect(res.hits.find((h) => h.kind === "e1rm")).toBeUndefined();
  });
});

describe("PR_KIND_LABEL + prValueSuffix", () => {
  it("every kind has a plain-English label", () => {
    expect(PR_KIND_LABEL.weight).toBe("Weight PR");
    expect(PR_KIND_LABEL.reps_at_weight).toBe("Reps PR");
    expect(PR_KIND_LABEL.e1rm).toBe("Estimated 1RM PR");
  });

  it("suffix matches the value unit", () => {
    expect(prValueSuffix("weight")).toBe("kg");
    expect(prValueSuffix("reps_at_weight")).toBe("reps");
    expect(prValueSuffix("e1rm")).toBe("kg est.");
  });
});
