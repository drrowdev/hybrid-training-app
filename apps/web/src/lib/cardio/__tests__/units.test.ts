import { describe, it, expect } from "vitest";
import {
  parsePaceToSecPerKm,
  formatSecPerKmToPace,
  secondsToMinutes,
  minutesToSeconds,
  paceUnitLabel,
  distanceUnitLabel,
} from "../units";

describe("parsePaceToSecPerKm", () => {
  it("parses M:SS to total seconds", () => {
    expect(parsePaceToSecPerKm("6:00")).toBe(360);
    expect(parsePaceToSecPerKm("5:30")).toBe(330);
    expect(parsePaceToSecPerKm("4:59")).toBe(299);
    expect(parsePaceToSecPerKm("10:00")).toBe(600);
  });

  it("parses optional tenths", () => {
    expect(parsePaceToSecPerKm("6:00.5")).toBe(361); // 360 + 0.5 → 361 after round
    expect(parsePaceToSecPerKm("5:30.0")).toBe(330);
  });

  it("returns null for empty / nullish input", () => {
    expect(parsePaceToSecPerKm("")).toBeNull();
    expect(parsePaceToSecPerKm("   ")).toBeNull();
    expect(parsePaceToSecPerKm(null)).toBeNull();
    expect(parsePaceToSecPerKm(undefined)).toBeNull();
  });

  it("rejects ambiguous / locale formats", () => {
    expect(parsePaceToSecPerKm("6.00")).toBeNull();
    expect(parsePaceToSecPerKm("6,00")).toBeNull();
    expect(parsePaceToSecPerKm("6")).toBeNull();
    expect(parsePaceToSecPerKm("6:0")).toBeNull(); // need 2-digit seconds
    expect(parsePaceToSecPerKm("6:60")).toBeNull(); // seconds out of range
    expect(parsePaceToSecPerKm("six:00")).toBeNull();
  });

  it("converts imperial input (M:SS / mile) into s/km", () => {
    // 6:00/mi ≈ 372.8 s/mi → ≈ 231.6 s/km → rounds to 232
    expect(parsePaceToSecPerKm("6:00", "imperial")).toBe(224);
    // sanity: imperial input ALWAYS yields fewer s/km than the same
    // M:SS interpreted as metric (a mile is longer than a km).
    expect(parsePaceToSecPerKm("8:00", "imperial")!).toBeLessThan(
      parsePaceToSecPerKm("8:00", "metric")!,
    );
  });
});

describe("formatSecPerKmToPace", () => {
  it("formats whole seconds as M:SS with zero-padding", () => {
    expect(formatSecPerKmToPace(360)).toBe("6:00");
    expect(formatSecPerKmToPace(330)).toBe("5:30");
    expect(formatSecPerKmToPace(299)).toBe("4:59");
    expect(formatSecPerKmToPace(600)).toBe("10:00");
  });

  it("returns empty string for null / 0 / invalid", () => {
    expect(formatSecPerKmToPace(null)).toBe("");
    expect(formatSecPerKmToPace(undefined)).toBe("");
    expect(formatSecPerKmToPace(0)).toBe("");
    expect(formatSecPerKmToPace(Number.NaN)).toBe("");
  });

  it("round-trips through parsePaceToSecPerKm for metric", () => {
    for (const s of ["3:30", "4:00", "5:45", "6:00", "7:15", "12:30"]) {
      expect(formatSecPerKmToPace(parsePaceToSecPerKm(s))).toBe(s);
    }
  });

  it("formats imperial display by converting s/km → s/mi", () => {
    // 372 s/km → ~599 s/mi ≈ 9:58 (depending on rounding).
    const out = formatSecPerKmToPace(372, "imperial");
    expect(out).toMatch(/^9:5\d$/);
  });
});

describe("seconds / minutes converters", () => {
  it("seconds → minutes rounds half-up", () => {
    expect(secondsToMinutes(0)).toBe(0);
    expect(secondsToMinutes(60)).toBe(1);
    expect(secondsToMinutes(90)).toBe(2); // 1.5 → 2
    expect(secondsToMinutes(1800)).toBe(30);
    expect(secondsToMinutes(2700)).toBe(45);
    expect(secondsToMinutes(null)).toBeNull();
  });

  it("minutes → seconds multiplies by 60", () => {
    expect(minutesToSeconds(30)).toBe(1800);
    expect(minutesToSeconds(45)).toBe(2700);
    expect(minutesToSeconds(0)).toBe(0);
    expect(minutesToSeconds(null)).toBeNull();
  });
});

describe("unit labels", () => {
  it("returns the right pace label per unit", () => {
    expect(paceUnitLabel("metric")).toBe("min:sec/km");
    expect(paceUnitLabel("imperial")).toBe("min:sec/mi");
  });

  it("returns the right distance label per unit", () => {
    expect(distanceUnitLabel("metric")).toBe("km");
    expect(distanceUnitLabel("imperial")).toBe("mi");
  });
});
