import { describe, expect, it } from "vitest";
import {
  buildPlanPhaseGroups,
  inferProgramStartWeekIndex,
  relativeProgramSegments,
  shiftSegmentsForInsertedWeeks,
  shiftWeekIndexForInsertedWeeks,
} from "../program-overview";
import type { ProgramEngine } from "@hta/program-core";

const activation = [
  { startWeekIndex: 0, label: "Base", kind: "phase" as const },
  { startWeekIndex: 4, label: "Rest and test", kind: "test" as const },
  { startWeekIndex: 5, label: "Armor", kind: "phase" as const },
  { startWeekIndex: 8, label: "Operator Blue", kind: "phase" as const },
  { startWeekIndex: 13, label: "Peak", kind: "test" as const },
  { startWeekIndex: 14, label: "Operator Black", kind: "deload" as const },
];

describe("relativeProgramSegments", () => {
  it("rebases a later program start to week zero", () => {
    expect(relativeProgramSegments(activation, 5, 20, "Activation")).toEqual([
      { startWeekIndex: 0, label: "Armor", kind: "phase" },
      { startWeekIndex: 3, label: "Operator Blue", kind: "phase" },
      { startWeekIndex: 8, label: "Peak", kind: "test" },
      { startWeekIndex: 9, label: "Operator Black", kind: "deload" },
    ]);
  });

  describe("inferProgramStartWeekIndex", () => {
    it("recovers the materialized start from the first matching engine ref", () => {
      const engine = {
        timeline: () => [
          { ref: "base-a", index: 0, label: "Base A", kind: "training", weekLabel: "1" },
          { ref: "base-b", index: 1, label: "Base B", kind: "training", weekLabel: "1" },
          { ref: "base-c", index: 2, label: "Base C", kind: "training", weekLabel: "2" },
          { ref: "armor-a", index: 3, label: "Armor A", kind: "training", weekLabel: "6" },
        ],
      } as unknown as ProgramEngine;
      expect(
        inferProgramStartWeekIndex(engine, {}, ["external-cardio", "armor-a"]),
      ).toBe(2);
    });
  });

  it("falls back to the program label when no segments are available", () => {
    expect(relativeProgramSegments([], 0, 4, "Custom program")).toEqual([
      { startWeekIndex: 0, label: "Custom program" },
    ]);
  });
});

describe("buildPlanPhaseGroups", () => {
  it("turns segment starts into inclusive phase ranges", () => {
    expect(
      buildPlanPhaseGroups(
        [
          { startWeekIndex: 0, label: "Armor" },
          { startWeekIndex: 3, label: "Operator" },
          { startWeekIndex: 9, label: "Peak" },
        ],
        12,
      ),
    ).toEqual([
      { startWeekIndex: 0, endWeekIndex: 2, label: "Armor" },
      { startWeekIndex: 3, endWeekIndex: 8, label: "Operator" },
      { startWeekIndex: 9, endWeekIndex: 11, label: "Peak" },
    ]);
  });

  describe("shiftSegmentsForInsertedWeeks", () => {
    it("shifts a program week past every recovery week before it", () => {
      expect(shiftWeekIndexForInsertedWeeks(0, [2, 5])).toBe(0);
      expect(shiftWeekIndexForInsertedWeeks(2, [2, 5])).toBe(3);
      expect(shiftWeekIndexForInsertedWeeks(4, [5, 2, 2])).toBe(6);
    });

    it("moves later phase boundaries past an inserted recovery week", () => {
      expect(
        shiftSegmentsForInsertedWeeks(
          [
            { startWeekIndex: 0, label: "Armor" },
            { startWeekIndex: 3, label: "Operator" },
            { startWeekIndex: 8, label: "Peak" },
          ],
          [2],
          11,
        ),
      ).toEqual([
        { startWeekIndex: 0, label: "Armor" },
        { startWeekIndex: 2, label: "Recovery week", kind: "deload" },
        { startWeekIndex: 3, label: "Armor" },
        { startWeekIndex: 4, label: "Operator" },
        { startWeekIndex: 9, label: "Peak" },
      ]);
    });
  });
});
