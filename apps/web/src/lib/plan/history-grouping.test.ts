/**
 * History month-grouping helper test.
 */
import { describe, it, expect } from "vitest";
import { groupBlocksByMonth } from "./history-grouping";
import type { BlockWithCompletionStats } from "@/lib/planner/queries";

function block(id: string, startedOn: string): BlockWithCompletionStats {
  return {
    id,
    archetype: "strength_anchor",
    archetypeName: "Strength anchor",
    status: "completed",
    weeks: 4,
    daysPerWeek: 4,
    startedOn,
    endedOn: null,
    totalSessions: 0,
    loggedSessions: 0,
    skippedSessions: 0,
  } as unknown as BlockWithCompletionStats;
}

describe("groupBlocksByMonth", () => {
  it("groups consecutive blocks by month preserving input order", () => {
    const groups = groupBlocksByMonth(
      [
        block("a", "2026-04-22"),
        block("b", "2026-04-01"),
        block("c", "2026-03-15"),
      ],
      "en-US",
    );
    expect(groups.map((g) => g.key)).toEqual(["2026-04", "2026-03"]);
    expect(groups[0]!.blocks.map((b) => b.id)).toEqual(["a", "b"]);
    expect(groups[1]!.blocks.map((b) => b.id)).toEqual(["c"]);
    expect(groups[0]!.label).toMatch(/April 2026/i);
    expect(groups[1]!.label).toMatch(/March 2026/i);
  });

  it("buckets undated blocks under 'Undated'", () => {
    const groups = groupBlocksByMonth([block("x", "")], "en-US");
    expect(groups[0]!.key).toBe("unknown");
    expect(groups[0]!.label).toBe("Undated");
  });

  it("returns an empty array for no input", () => {
    expect(groupBlocksByMonth([])).toEqual([]);
  });
});
