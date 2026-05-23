import { describe, expect, it } from "vitest";
import {
  eventStatus,
  formatPace,
  formatPerformance,
  formatRelativeEventDate,
  modalityLabel,
  priorityLabel,
} from "../format";

describe("formatRelativeEventDate", () => {
  it("returns 'today' when dates match", () => {
    expect(formatRelativeEventDate("2026-06-01", "2026-06-01")).toBe("today");
  });
  it("handles tomorrow and yesterday", () => {
    expect(formatRelativeEventDate("2026-06-02", "2026-06-01")).toBe("tomorrow");
    expect(formatRelativeEventDate("2026-05-31", "2026-06-01")).toBe("yesterday");
  });
  it("uses days under 14", () => {
    expect(formatRelativeEventDate("2026-06-08", "2026-06-01")).toBe("in 7 days");
    expect(formatRelativeEventDate("2026-05-29", "2026-06-01")).toBe("3 days ago");
  });
  it("uses weeks under 60 days", () => {
    expect(formatRelativeEventDate("2026-07-01", "2026-06-01")).toBe("in 4 weeks");
  });
  it("uses months under a year", () => {
    expect(formatRelativeEventDate("2026-12-01", "2026-06-01")).toBe("in 6 months");
  });
  it("uses years past a year", () => {
    expect(formatRelativeEventDate("2028-06-01", "2026-06-01")).toBe("in 2 years");
  });
});

describe("eventStatus", () => {
  it("flags 'today' on the day", () => {
    expect(eventStatus("2026-06-01", "2026-06-01", "A")).toBe("today");
  });
  it("flags 'tapering' inside the A 14-day window", () => {
    expect(eventStatus("2026-06-10", "2026-06-01", "A")).toBe("tapering");
    expect(eventStatus("2026-06-20", "2026-06-01", "A")).toBe("upcoming");
  });
  it("uses the 7-day window for B and never tapers C", () => {
    expect(eventStatus("2026-06-08", "2026-06-01", "B")).toBe("tapering");
    expect(eventStatus("2026-06-10", "2026-06-01", "B")).toBe("upcoming");
    expect(eventStatus("2026-06-02", "2026-06-01", "C")).toBe("upcoming");
  });
  it("returns 'past' for already-elapsed dates", () => {
    expect(eventStatus("2026-05-30", "2026-06-01", "A")).toBe("past");
  });
});

describe("modalityLabel + priorityLabel", () => {
  it("labels the known modalities", () => {
    expect(modalityLabel("run")).toBe("Run");
    expect(modalityLabel("strength")).toBe("Strength meet");
    expect(modalityLabel("padel")).toBe("Padel");
  });
  it("falls back to the raw string for unknown modalities", () => {
    expect(modalityLabel("freestyle")).toBe("freestyle");
    expect(modalityLabel(null)).toBe("Unspecified");
  });
  it("labels priorities", () => {
    expect(priorityLabel("A")).toMatch(/peak/i);
    expect(priorityLabel("B")).toMatch(/important/i);
    expect(priorityLabel("C")).toMatch(/logged/i);
  });
});

describe("formatPace", () => {
  it("formats seconds as M:SS", () => {
    expect(formatPace(270)).toBe("4:30");
    expect(formatPace(305)).toBe("5:05");
  });
});

describe("formatPerformance", () => {
  it("returns null when nothing useful is set", () => {
    expect(formatPerformance("run", null)).toBeNull();
    expect(formatPerformance("run", {})).toBeNull();
  });
  it("formats a run target", () => {
    const s = formatPerformance("run", {
      targetDistanceKm: 21.0975,
      targetTime: "1:35:00",
      paceSecPerKm: 270,
    });
    expect(s).toContain("21.0975 km");
    expect(s).toContain("1:35:00");
    expect(s).toContain("4:30/km");
  });
  it("formats a bike target with power", () => {
    const s = formatPerformance("bike", { targetDistanceKm: 40, avgPowerW: 240 });
    expect(s).toContain("40 km");
    expect(s).toContain("240 W");
  });
  it("formats a strength meet total + lifts", () => {
    const s = formatPerformance("strength", {
      targetTotal: 500,
      lifts: { squat: 180, bench: 130, deadlift: 190 },
    });
    expect(s).toContain("Total 500 kg");
    expect(s).toContain("squat 180kg");
    expect(s).toContain("deadlift 190kg");
  });
  it("formats a padel rank", () => {
    expect(formatPerformance("padel", { targetRank: "Liiga 3" })).toBe("Liiga 3");
  });
  it("falls back to description for other modalities", () => {
    expect(formatPerformance("other", { description: "first sprint tri" })).toBe(
      "first sprint tri",
    );
  });
});
