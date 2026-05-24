import { describe, it, expect } from "vitest";
import { detectTmAnchoredPr } from "../tm-anchored-pr";

const base = {
  weightKg: 100,
  reps: 5,
  rpe: null,
  kind: "main" as const,
  prescribedReps: 5,
  isTopSet: true,
  tmKg: 140,
};

describe("detectTmAnchoredPr", () => {
  it("no TM → all flags false, e1rm null", () => {
    const r = detectTmAnchoredPr({ ...base, tmKg: null });
    expect(r).toEqual({ isWeightPr: false, isRepPr: false, isE1rmPr: false, e1rmKg: null });
  });

  it("weight exactly at TM (no epsilon margin) → no Weight PR", () => {
    const r = detectTmAnchoredPr({ ...base, weightKg: 140, reps: 1, tmKg: 140 });
    expect(r.isWeightPr).toBe(false);
  });

  it("e1RM exactly at TM (single rep below epsilon) → no e1RM PR", () => {
    // Epley at reps=1 is weight × 31/30. Pick weight so the estimate
    // sits just under TM + epsilon: 135 × 31/30 ≈ 139.5 < 140 + 0.5.
    const r = detectTmAnchoredPr({ ...base, weightKg: 135, reps: 1, tmKg: 140 });
    expect(r.isE1rmPr).toBe(false);
  });

  it("weight just above TM + epsilon → Weight PR", () => {
    const r = detectTmAnchoredPr({ ...base, weightKg: 141, reps: 1, tmKg: 140 });
    expect(r.isWeightPr).toBe(true);
  });

  it("weight 0.4 above TM (inside epsilon) → no Weight PR", () => {
    const r = detectTmAnchoredPr({ ...base, weightKg: 140.4, reps: 1, tmKg: 140 });
    expect(r.isWeightPr).toBe(false);
  });

  it("e1RM beats TM → e1RM PR", () => {
    // 130 × 5 Epley ≈ 151.7 > 140 + 0.5
    const r = detectTmAnchoredPr({ ...base, weightKg: 130, reps: 5, tmKg: 140 });
    expect(r.isE1rmPr).toBe(true);
    expect(r.isWeightPr).toBe(false);
  });

  it("top set + reps > prescribed → Rep PR", () => {
    const r = detectTmAnchoredPr({
      ...base,
      weightKg: 100,
      reps: 10,
      prescribedReps: 5,
      isTopSet: true,
      tmKg: 140,
    });
    expect(r.isRepPr).toBe(true);
  });

  it("not a top set → no Rep PR even when reps exceed prescription", () => {
    const r = detectTmAnchoredPr({
      ...base,
      reps: 10,
      prescribedReps: 5,
      isTopSet: false,
    });
    expect(r.isRepPr).toBe(false);
  });

  it("missing prescribedReps → no Rep PR", () => {
    const r = detectTmAnchoredPr({
      ...base,
      reps: 99,
      prescribedReps: null,
      isTopSet: true,
    });
    expect(r.isRepPr).toBe(false);
  });

  it("warmup → all flags false", () => {
    const r = detectTmAnchoredPr({ ...base, kind: "warmup", weightKg: 999, reps: 1 });
    expect(r).toEqual({ isWeightPr: false, isRepPr: false, isE1rmPr: false, e1rmKg: null });
  });

  it("accessory → all flags false", () => {
    const r = detectTmAnchoredPr({ ...base, kind: "accessory", weightKg: 999, reps: 1 });
    expect(r.isWeightPr).toBe(false);
    expect(r.isE1rmPr).toBe(false);
    expect(r.isRepPr).toBe(false);
  });

  it("tendon → all flags false", () => {
    const r = detectTmAnchoredPr({ ...base, kind: "tendon", weightKg: 999, reps: 5 });
    expect(r.isWeightPr).toBe(false);
  });

  it("combined: heavier than TM + extra reps → Weight + Rep + e1RM PR", () => {
    const r = detectTmAnchoredPr({
      ...base,
      weightKg: 145,
      reps: 8,
      prescribedReps: 5,
      isTopSet: true,
      tmKg: 140,
    });
    expect(r.isWeightPr).toBe(true);
    expect(r.isRepPr).toBe(true);
    expect(r.isE1rmPr).toBe(true);
    expect(r.e1rmKg).not.toBeNull();
  });

  it("top set with reps ≥ 1 surfaces e1rmKg even when no PR fires", () => {
    const r = detectTmAnchoredPr({
      ...base,
      weightKg: 80,
      reps: 5,
      prescribedReps: 5,
      isTopSet: true,
      tmKg: 200,
    });
    expect(r.isWeightPr).toBe(false);
    expect(r.isRepPr).toBe(false);
    expect(r.isE1rmPr).toBe(false);
    expect(r.e1rmKg).not.toBeNull();
  });

  it("non-top set → e1rmKg is null", () => {
    const r = detectTmAnchoredPr({ ...base, isTopSet: false });
    expect(r.e1rmKg).toBeNull();
  });

  it("invalid weight / reps → all flags false", () => {
    expect(
      detectTmAnchoredPr({ ...base, weightKg: 0 }).isWeightPr,
    ).toBe(false);
    expect(
      detectTmAnchoredPr({ ...base, reps: 0 }).isE1rmPr,
    ).toBe(false);
  });
});
