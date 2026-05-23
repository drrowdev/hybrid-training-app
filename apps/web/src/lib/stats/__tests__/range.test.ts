/**
 * Range parser — Phase 2 ?range=30d|90d|all toggle.
 */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_RANGE,
  parseRange,
  rangeWindowDays,
} from "../range";

describe("parseRange", () => {
  it("accepts the three canonical tokens", () => {
    expect(parseRange("30d")).toBe("30d");
    expect(parseRange("90d")).toBe("90d");
    expect(parseRange("all")).toBe("all");
  });

  it("falls back to 30d on undefined / empty / invalid input", () => {
    expect(parseRange(undefined)).toBe(DEFAULT_RANGE);
    expect(parseRange("")).toBe(DEFAULT_RANGE);
    expect(parseRange("banana")).toBe(DEFAULT_RANGE);
    expect(parseRange("60d")).toBe(DEFAULT_RANGE);
    expect(parseRange("ALL")).toBe(DEFAULT_RANGE); // case-sensitive on purpose
  });

  it("picks the first entry when handed an array (duplicate query keys)", () => {
    expect(parseRange(["90d", "30d"])).toBe("90d");
    expect(parseRange(["banana", "30d"])).toBe(DEFAULT_RANGE);
  });
});

describe("rangeWindowDays", () => {
  it("maps tokens to window in days; all = null", () => {
    expect(rangeWindowDays("30d")).toBe(30);
    expect(rangeWindowDays("90d")).toBe(90);
    expect(rangeWindowDays("all")).toBeNull();
  });
});
