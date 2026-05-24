import { describe, expect, it } from "vitest";
import {
  DEFAULT_WARMUP_SCHEME,
  generateWarmupItems,
  isWellFormedScheme,
  resolveWarmupScheme,
  type WarmupScheme,
} from "../warmups";

describe("generateWarmupItems", () => {
  it("default scheme + 85% top set → 3 warmups at 34/42.5/51% × 5/3/2", () => {
    const items = generateWarmupItems("sq", 85, DEFAULT_WARMUP_SCHEME);
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.percentTm)).toEqual([34, 42.5, 51]);
    expect(items.map((i) => i.reps)).toEqual([5, 3, 2]);
    expect(items.every((i) => i.kind === "warmup")).toBe(true);
    expect(items.every((i) => i.movementId === "sq")).toBe(true);
  });

  it("setCount: 0 returns empty array", () => {
    const skip: WarmupScheme = { setCount: 0, percentLadder: [], repLadder: [] };
    expect(generateWarmupItems("sq", 85, skip)).toEqual([]);
  });

  it("malformed length mismatch falls back to default", () => {
    const bad = {
      setCount: 3,
      percentLadder: [40, 50],
      repLadder: [5, 3, 2],
    } as WarmupScheme;
    const items = generateWarmupItems("sq", 85, bad);
    expect(items.map((i) => i.percentTm)).toEqual([34, 42.5, 51]);
    expect(items.map((i) => i.reps)).toEqual([5, 3, 2]);
  });

  it("100% TM top set → 40/50/60 × 5/3/2 with default scheme", () => {
    const items = generateWarmupItems("dl", 100, DEFAULT_WARMUP_SCHEME);
    expect(items.map((i) => i.percentTm)).toEqual([40, 50, 60]);
    expect(items.map((i) => i.reps)).toEqual([5, 3, 2]);
  });

  it("rounds to nearest 0.5%: top 73%, ladder entry 50% → 36.5%", () => {
    const scheme: WarmupScheme = {
      setCount: 1,
      percentLadder: [50],
      repLadder: [5],
    };
    const items = generateWarmupItems("bp", 73, scheme);
    // 73 * 0.50 = 36.5 — exact half, no rounding artifact.
    expect(items[0]!.percentTm).toBe(36.5);
  });

  it("rounds 33.3333… down to 33.5 (nearest half)", () => {
    // 66.6666… * 50% = 33.3333…, nearest 0.5 is 33.5.
    const scheme: WarmupScheme = {
      setCount: 1,
      percentLadder: [50],
      repLadder: [5],
    };
    const items = generateWarmupItems("bp", 200 / 3, scheme);
    expect(items[0]!.percentTm).toBe(33.5);
  });

  it("copies movementSlug + movementName onto each warmup", () => {
    const items = generateWarmupItems("sq", 85, DEFAULT_WARMUP_SCHEME, {
      movementSlug: "back_squat",
      movementName: "Back Squat",
    });
    expect(items.every((i) => i.movementSlug === "back_squat")).toBe(true);
    expect(items.every((i) => i.movementName === "Back Squat")).toBe(true);
  });

  it("intensityLabel matches the rounded percentTm", () => {
    const items = generateWarmupItems("sq", 85, DEFAULT_WARMUP_SCHEME);
    expect(items.map((i) => i.intensityLabel)).toEqual([
      "34% TM",
      "42.5% TM",
      "51% TM",
    ]);
  });

  it("returns [] when topWorkingPercent is 0 or negative", () => {
    expect(generateWarmupItems("sq", 0, DEFAULT_WARMUP_SCHEME)).toEqual([]);
    expect(generateWarmupItems("sq", -10, DEFAULT_WARMUP_SCHEME)).toEqual([]);
  });
});

describe("isWellFormedScheme / resolveWarmupScheme", () => {
  it("accepts the default scheme", () => {
    expect(isWellFormedScheme(DEFAULT_WARMUP_SCHEME)).toBe(true);
  });

  it("accepts skip-warmups (setCount 0 + empty ladders)", () => {
    expect(
      isWellFormedScheme({ setCount: 0, percentLadder: [], repLadder: [] }),
    ).toBe(true);
  });

  it("rejects mismatched ladder lengths", () => {
    expect(
      isWellFormedScheme({ setCount: 3, percentLadder: [40, 50], repLadder: [5, 3, 2] }),
    ).toBe(false);
  });

  it("rejects out-of-range setCount", () => {
    expect(
      isWellFormedScheme({ setCount: 6, percentLadder: [10, 20, 30, 40, 50, 60], repLadder: [5, 5, 5, 5, 5, 5] }),
    ).toBe(false);
    expect(
      isWellFormedScheme({ setCount: -1, percentLadder: [], repLadder: [] }),
    ).toBe(false);
  });

  it("resolveWarmupScheme falls back on null/undefined/malformed", () => {
    expect(resolveWarmupScheme(null)).toEqual(DEFAULT_WARMUP_SCHEME);
    expect(resolveWarmupScheme(undefined)).toEqual(DEFAULT_WARMUP_SCHEME);
    expect(resolveWarmupScheme({ foo: "bar" })).toEqual(DEFAULT_WARMUP_SCHEME);
    expect(
      resolveWarmupScheme({ setCount: 2, percentLadder: [50], repLadder: [5] }),
    ).toEqual(DEFAULT_WARMUP_SCHEME);
  });

  it("resolveWarmupScheme preserves a valid custom scheme", () => {
    const custom: WarmupScheme = {
      setCount: 2,
      percentLadder: [50, 65],
      repLadder: [5, 3],
    };
    expect(resolveWarmupScheme(custom)).toEqual(custom);
  });
});
