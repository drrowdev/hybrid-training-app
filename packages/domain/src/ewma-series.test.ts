import { describe, expect, it } from "vitest";
import { daysBetween, ewmaSeries, finalEwma } from "./ewma-series";

describe("daysBetween — DC-C1 calendar walk", () => {
  it("includes both endpoints", () => {
    expect(daysBetween("2026-05-01", "2026-05-03")).toEqual([
      "2026-05-01",
      "2026-05-02",
      "2026-05-03",
    ]);
  });

  it("returns single day for equal endpoints", () => {
    expect(daysBetween("2026-05-15", "2026-05-15")).toEqual(["2026-05-15"]);
  });

  it("returns empty for reversed range", () => {
    expect(daysBetween("2026-05-10", "2026-05-01")).toEqual([]);
  });

  it("crosses month boundary cleanly", () => {
    const days = daysBetween("2026-04-29", "2026-05-02");
    expect(days).toEqual([
      "2026-04-29",
      "2026-04-30",
      "2026-05-01",
      "2026-05-02",
    ]);
  });
});

describe("finalEwma — current ATL/CTL state", () => {
  it("returns 0 over an empty calendar", () => {
    const empty = new Map<string, number>();
    expect(finalEwma(empty, "2026-05-01", "2026-05-07", 7)).toBe(0);
  });

  it("approaches the steady-state value with a constant input", () => {
    // 100/day for many days → EWMA should converge to 100.
    const load = new Map<string, number>();
    const startMs = Date.UTC(2026, 3, 1); // April 1
    for (let i = 0; i < 60; i++) {
      const iso = new Date(startMs + i * 86400000).toISOString().slice(0, 10);
      load.set(iso, 100);
    }
    const ewma = finalEwma(load, "2026-04-01", "2026-05-30", 7);
    expect(ewma).toBeGreaterThan(99);
    expect(ewma).toBeLessThan(101);
  });

  it("decays toward zero after a layoff", () => {
    // Heavy load for 14 days, then 14 days off.
    const load = new Map<string, number>();
    const start = new Date("2026-05-01");
    for (let i = 0; i < 14; i++) {
      const d = new Date(start);
      d.setUTCDate(start.getUTCDate() + i);
      load.set(d.toISOString().slice(0, 10), 200);
    }
    // Days 14..27 (no entries → 0).
    const after = finalEwma(load, "2026-05-01", "2026-05-28", 7);
    expect(after).toBeLessThan(50); // dropped significantly from ~200
  });

  it("matches single-step EWMA on a known sequence (worked example)", () => {
    // alpha_7 = 2/8 = 0.25
    // day 1: prev=0, val=100 → 0.25*100 + 0.75*0 = 25
    // day 2: prev=25, val=0 → 0 + 0.75*25 = 18.75
    // day 3: prev=18.75, val=200 → 50 + 0.75*18.75 = 64.0625
    const load = new Map([
      ["2026-05-01", 100],
      ["2026-05-03", 200],
    ]);
    const ewma = finalEwma(load, "2026-05-01", "2026-05-03", 7);
    expect(ewma).toBeCloseTo(64.0625, 4);
  });
});

describe("ewmaSeries — per-day EWMA values", () => {
  it("returns one value per day in the range", () => {
    const load = new Map([["2026-05-02", 100]]);
    const series = ewmaSeries(load, "2026-05-01", "2026-05-05", 7);
    expect([...series.keys()]).toEqual([
      "2026-05-01",
      "2026-05-02",
      "2026-05-03",
      "2026-05-04",
      "2026-05-05",
    ]);
    expect(series.get("2026-05-01")).toBe(0);
    expect(series.get("2026-05-02")).toBeCloseTo(25, 4);
  });
});
