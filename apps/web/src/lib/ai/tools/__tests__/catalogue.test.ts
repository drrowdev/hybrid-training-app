import { describe, expect, it } from "vitest";
import { catalogue, getProfile, getKnowledge } from "..";

describe("catalogue", () => {
  it("exports exactly 12 tools in the ADR 0003 order", () => {
    expect(catalogue.length).toBe(12);
    expect(catalogue.map((t) => t.name)).toEqual([
      "getProfile",
      "getActiveBlock",
      "getRecentSessions",
      "getWeeklyAggregates",
      "getPrTimeline",
      "getEngineState",
      "getMemories",
      "getKnowledge",
      "getSessionDetail",
      "getCardioAnalysis",
      "getLiftProgress",
      "getBodyweightTrend",
    ]);
  });

  it("every tool has a non-empty description and Zod schemas", () => {
    for (const t of catalogue) {
      expect(t.description.length).toBeGreaterThan(10);
      expect(t.inputSchema).toBeDefined();
      expect(t.outputSchema).toBeDefined();
    }
  });

  it("named exports match catalogue entries", () => {
    expect(getProfile.name).toBe("getProfile");
    expect(getKnowledge.name).toBe("getKnowledge");
  });
});
