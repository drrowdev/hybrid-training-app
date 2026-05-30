/**
 * AMRAP detection tests — covers the detectAmrap helper across the
 * variant encodings curated archetypes use (rep strings with "+",
 * canonical numeric reps + label match, top-set notes fallback).
 */
import { describe, it, expect } from "vitest";
import { detectAmrap, isHeavyWeek, summariseAmrap } from "../amrap";
import type { Prescription, PrescriptionItem } from "@hta/db";

/**
 * Cast helper — PrescriptionItem.reps is typed as number, but the runtime
 * also accepts the open-rep string encoding ("5+", "3+", "1+"). The test
 * fixtures construct both shapes, so we widen at the boundary.
 */
const mainItem = (overrides: Partial<{ reps: number | string; intensityLabel: string; notes: string; movementId: string; isAmrap: boolean }>): PrescriptionItem =>
  ({
    movementId: overrides.movementId ?? "mv-1",
    kind: "main",
    reps: overrides.reps,
    intensityLabel: overrides.intensityLabel,
    notes: overrides.notes,
    isAmrap: overrides.isAmrap,
  } as unknown as PrescriptionItem);

describe("detectAmrap", () => {
  it("returns null for empty prescriptions", () => {
    expect(detectAmrap({ items: [] }, 0)).toBeNull();
  });

  it("detects a '5+' rep-string marker", () => {
    const presc: Prescription = { items: [mainItem({ reps: "5+" })] };
    const out = detectAmrap(presc, 0);
    expect(out?.target).toBe(5);
    expect(out?.weekIndex).toBe(0);
  });

  it("detects a '3+' marker", () => {
    const presc: Prescription = { items: [mainItem({ reps: "3+" })] };
    expect(detectAmrap(presc, 1)?.target).toBe(3);
  });

  it("detects a '1+' marker", () => {
    const presc: Prescription = { items: [mainItem({ reps: "1+" })] };
    expect(detectAmrap(presc, 2)?.target).toBe(1);
  });

  it("ignores accessory or non-main items", () => {
    const presc: Prescription = {
      items: [
        { movementId: "mv-1", kind: "accessory", reps: 10 } as unknown as PrescriptionItem,
        { movementId: "mv-2", kind: "warmup", reps: 5 } as unknown as PrescriptionItem,
      ],
    };
    expect(detectAmrap(presc, 0)).toBeNull();
  });

  it("detects a reps=1 top set with a 'peak' intensity label", () => {
    const presc: Prescription = { items: [mainItem({ reps: 1, intensityLabel: "Heavy peak" })] };
    expect(detectAmrap(presc, 2)?.target).toBe(1);
  });

  it("falls back to top-set notes when reps is numeric", () => {
    const presc: Prescription = { items: [mainItem({ reps: 5, notes: "top set" })] };
    expect(detectAmrap(presc, 0)?.target).toBe(5);
  });

  it("rejects unrecognised reps strings like '7+'", () => {
    const presc: Prescription = { items: [mainItem({ reps: "7+" })] };
    expect(detectAmrap(presc, 0)).toBeNull();
  });

  it("returns null when no items qualify", () => {
    const presc: Prescription = { items: [mainItem({ reps: 8 })] };
    expect(detectAmrap(presc, 0)).toBeNull();
  });

  // ADR 0007 — explicit isAmrap marker overrides the heuristics.
  it("detects an explicit isAmrap:true numeric top set (reps=5)", () => {
    const presc: Prescription = { items: [mainItem({ reps: 5, isAmrap: true })] };
    expect(detectAmrap(presc, 0)?.target).toBe(5);
  });

  it("opts out an explicit isAmrap:false top set even when reps=3 + 'top set'", () => {
    const presc: Prescription = {
      items: [mainItem({ reps: 3, notes: "top set", isAmrap: false })],
    };
    expect(detectAmrap(presc, 1)).toBeNull();
  });

  it("opts out an explicit isAmrap:false set even with a 'peak' label", () => {
    const presc: Prescription = {
      items: [mainItem({ reps: 1, intensityLabel: "Heavy peak", isAmrap: false })],
    };
    expect(detectAmrap(presc, 2)).toBeNull();
  });

  it("legacy top set (no isAmrap flag) is still detected via notes (backward compat)", () => {
    const presc: Prescription = { items: [mainItem({ reps: 3, notes: "top set" })] };
    expect(detectAmrap(presc, 0)?.target).toBe(3);
  });
});

describe("isHeavyWeek + summariseAmrap", () => {
  it("week 2 is heavy week; weeks 0/1 are early", () => {
    expect(isHeavyWeek(2)).toBe(true);
    expect(isHeavyWeek(0)).toBe(false);
    expect(isHeavyWeek(1)).toBe(false);
    expect(isHeavyWeek(3)).toBe(false);
  });

  it("summariseAmrap reflects week classification", () => {
    const heavy = summariseAmrap(6, 1, 2);
    expect(heavy.isHeavyWeek).toBe(true);
    expect(heavy.isEarlyWeek).toBe(false);

    const early = summariseAmrap(12, 5, 0);
    expect(early.isHeavyWeek).toBe(false);
    expect(early.isEarlyWeek).toBe(true);

    const deload = summariseAmrap(5, 5, 3);
    expect(deload.isHeavyWeek).toBe(false);
    expect(deload.isEarlyWeek).toBe(false);
  });
});
