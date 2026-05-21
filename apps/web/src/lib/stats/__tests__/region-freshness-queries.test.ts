import { describe, it, expect } from "vitest";
import { classifyFreshness } from "../region-freshness-queries";

describe("classifyFreshness — 5-band plain-language labels", () => {
  it("≥0.85 → Fresh (ok)", () => {
    expect(classifyFreshness(0.85)).toEqual({ band: "fresh", label: "Fresh", tone: "ok" });
    expect(classifyFreshness(1.0).band).toBe("fresh");
  });

  it("0.55–0.85 → Ready (ok)", () => {
    expect(classifyFreshness(0.84).band).toBe("ready");
    expect(classifyFreshness(0.55).band).toBe("ready");
  });

  it("0.30–0.55 → Light load lingering (caution)", () => {
    expect(classifyFreshness(0.54).band).toBe("lingering");
    expect(classifyFreshness(0.30).band).toBe("lingering");
  });

  it("0.10–0.30 → Recovering (warn)", () => {
    expect(classifyFreshness(0.29).band).toBe("recovering");
    expect(classifyFreshness(0.10).band).toBe("recovering");
  });

  it("<0.10 → Heavily loaded (warn)", () => {
    expect(classifyFreshness(0.09).band).toBe("heavily-loaded");
    expect(classifyFreshness(0).band).toBe("heavily-loaded");
  });

  it("Bands are monotonic: lower freshness never produces a 'fresher' label", () => {
    const points = [0.0, 0.1, 0.3, 0.55, 0.85, 1.0];
    const rank: Record<string, number> = {
      "heavily-loaded": 0,
      recovering: 1,
      lingering: 2,
      ready: 3,
      fresh: 4,
    };
    const ranks = points.map((p) => rank[classifyFreshness(p).band]!);
    for (let i = 1; i < ranks.length; i++) {
      expect(ranks[i]).toBeGreaterThanOrEqual(ranks[i - 1]!);
    }
  });
});
