import { describe, it, expect } from "vitest";
import {
  renumber,
  applyReorder,
  nextPlannedBlock,
  seasonProgress,
  isSeasonEmphasis,
  type SeasonBlockLite,
} from "../season-logic";

describe("renumber", () => {
  it("collapses gaps to contiguous 0-based positions in order", () => {
    const out = renumber([
      { position: 5, id: "c" },
      { position: 0, id: "a" },
      { position: 2, id: "b" },
    ]);
    expect(out.map((b) => [b.id, b.position])).toEqual([
      ["a", 0],
      ["b", 1],
      ["c", 2],
    ]);
  });
});

describe("applyReorder", () => {
  it("maps each id to its new index", () => {
    const m = applyReorder(["a", "b", "c"], ["c", "a", "b"]);
    expect(m.get("c")).toBe(0);
    expect(m.get("a")).toBe(1);
    expect(m.get("b")).toBe(2);
  });
  it("rejects a non-permutation (missing / extra / duplicate / unknown)", () => {
    expect(() => applyReorder(["a", "b"], ["a"])).toThrow(RangeError);
    expect(() => applyReorder(["a", "b"], ["a", "b", "c"])).toThrow(RangeError);
    expect(() => applyReorder(["a", "b"], ["a", "a"])).toThrow(RangeError);
    expect(() => applyReorder(["a", "b"], ["a", "z"])).toThrow(RangeError);
  });
});

describe("nextPlannedBlock", () => {
  const blocks: SeasonBlockLite[] = [
    { id: "0", position: 0, status: "done" },
    { id: "1", position: 1, status: "active" },
    { id: "2", position: 2, status: "planned" },
    { id: "3", position: 3, status: "planned" },
  ];
  it("returns the first planned block by position", () => {
    expect(nextPlannedBlock(blocks)?.id).toBe("2");
  });
  it("returns null when nothing is planned", () => {
    expect(nextPlannedBlock(blocks.filter((b) => b.status !== "planned"))).toBeNull();
  });
});

describe("seasonProgress", () => {
  it("counts done, total, and the active index", () => {
    const p = seasonProgress([
      { id: "0", position: 0, status: "done" },
      { id: "1", position: 1, status: "done" },
      { id: "2", position: 2, status: "active" },
      { id: "3", position: 3, status: "planned" },
    ]);
    expect(p).toEqual({ done: 2, total: 4, activeIndex: 2 });
  });
});

describe("isSeasonEmphasis", () => {
  it("accepts known tags and rejects junk", () => {
    expect(isSeasonEmphasis("strength_bias")).toBe(true);
    expect(isSeasonEmphasis("base")).toBe(true);
    expect(isSeasonEmphasis("nonsense")).toBe(false);
    expect(isSeasonEmphasis(42)).toBe(false);
  });
});
