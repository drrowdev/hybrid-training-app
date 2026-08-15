/**
 * ADR 0070 — prescribed-snapshot resolver.
 *
 * The engine's ability to autoregulate (e.g. Tactical Barbell's "3–5 sets, more
 * if you feel good") depends on knowing whether a set landed as programmed, so
 * these cases pin what may and may not be recorded as a prescription.
 */
import { describe, expect, it } from "vitest";
import {
  resolvePrescribedSnapshot,
  validateSubmittedTarget,
  TARGET_VALIDATION_TOLERANCE,
} from "./prescribed-snapshot";

const roundToPlate = (kg: number) => Math.round(kg / 2.5) * 2.5;

describe("resolvePrescribedSnapshot", () => {
  it("returns an empty snapshot for a free-form log (no item)", () => {
    expect(resolvePrescribedSnapshot(null)).toEqual({
      targetWeightKg: null,
      targetReps: null,
      prescribed: null,
    });
  });

  it("resolves load from percentTm x TM, plate-rounded", () => {
    const r = resolvePrescribedSnapshot(
      { kind: "main", percentTm: 75, reps: 5 },
      { tmKg: 100, roundToPlate },
    );
    expect(r.targetWeightKg).toBe(75);
    expect(r.targetReps).toBe(5);
  });

  it("uses an explicit target weight when there is no percentage (5/3/1 warm-up ramp)", () => {
    const r = resolvePrescribedSnapshot(
      { kind: "warmup", targetWeightKg: 42.4, reps: 5 },
      { roundToPlate },
    );
    expect(r.targetWeightKg).toBe(42.5);
  });

  it("DC-K4: never records the UI's last-logged fallback as a prescribed load", () => {
    // An unanchored movement with no TM determines no load. The logger still
    // shows a seeded weight, but storing it would manufacture a false
    // "on target" result for every set of that movement.
    const r = resolvePrescribedSnapshot(
      { kind: "accessory", reps: 10 },
      { tmKg: null, roundToPlate },
    );
    expect(r.targetWeightKg).toBeNull();
    expect(r.targetReps).toBe(10);
  });

  it("returns no load when a percentage has no training max to resolve against", () => {
    const r = resolvePrescribedSnapshot(
      { kind: "main", percentTm: 80, reps: 3 },
      { tmKg: null, roundToPlate },
    );
    expect(r.targetWeightKg).toBeNull();
  });

  it("captures optionality so a discretionary set is not read as a missed one", () => {
    const required = resolvePrescribedSnapshot({ kind: "main", reps: 5 });
    const optional = resolvePrescribedSnapshot({
      kind: "main",
      reps: 5,
      optional: true,
      setRange: { min: 3, max: 5 },
    });
    expect(required.prescribed?.optional).toBeUndefined();
    expect(optional.prescribed?.optional).toBe(true);
    expect(optional.prescribed?.setRange).toEqual({ min: 3, max: 5 });
  });

  it("records the percentage basis so 1RM-based programs are not read as TM-based", () => {
    const tb = resolvePrescribedSnapshot(
      { kind: "main", percentTm: 75, reps: 5 },
      { tmKg: 100, basis: "1RM", roundToPlate },
    );
    const wendler = resolvePrescribedSnapshot(
      { kind: "main", percentTm: 75, reps: 5 },
      { tmKg: 100, basis: "TM", roundToPlate },
    );
    expect(tb.prescribed?.basis).toBe("1RM");
    expect(wendler.prescribed?.basis).toBe("TM");
    expect(tb.prescribed?.percentTm).toBe(75);
  });

  it("omits basis when there is no percentage for it to qualify", () => {
    const r = resolvePrescribedSnapshot(
      { kind: "accessory", reps: 10 },
      { basis: "1RM" },
    );
    expect(r.prescribed?.basis).toBeUndefined();
  });

  it("carries AMRAP and effort targets", () => {
    const r = resolvePrescribedSnapshot({
      kind: "main",
      reps: 5,
      isAmrap: true,
      targetRir: { min: 1, max: 1 },
      repRange: { min: 8, max: 10 },
    });
    expect(r.prescribed?.isAmrap).toBe(true);
    expect(r.prescribed?.targetRir).toEqual({ min: 1, max: 1 });
    expect(r.prescribed?.repRange).toEqual({ min: 8, max: 10 });
  });

  it("resolves holds and carries as duration / distance work, not reps", () => {
    const hold = resolvePrescribedSnapshot({
      kind: "tendon",
      holdSec: { min: 30, max: 30 },
    });
    expect(hold.targetReps).toBeNull();

    const carry = resolvePrescribedSnapshot({
      kind: "accessory",
      distanceM: { min: 20, max: 20 },
    });
    expect(carry.targetReps).toBeNull();
  });

  it("returns a null blob when the item carries nothing worth recording", () => {
    expect(resolvePrescribedSnapshot({ reps: 5 }).prescribed).toBeNull();
  });
});

describe("validateSubmittedTarget", () => {
  it("accepts a submitted value that matches the prescription", () => {
    expect(validateSubmittedTarget(100, 100)).toBe(100);
  });

  it("returns the SUBMITTED value, not the server's, when within tolerance", () => {
    // The user saw 102.5 (plate rounding); the server derived 100. What was on
    // screen is the truth we want to keep.
    expect(validateSubmittedTarget(102.5, 100)).toBe(102.5);
  });

  it("rejects a fabricated value far from the prescription", () => {
    expect(validateSubmittedTarget(40, 100)).toBeNull();
  });

  it("rejects rather than substituting — a wrong target is worse than none", () => {
    expect(validateSubmittedTarget(500, 100)).toBeNull();
  });

  it("trusts the client when the server has nothing to check against", () => {
    // Unanchored movement: only the client knows what was rendered.
    expect(validateSubmittedTarget(60, null)).toBe(60);
  });

  it("returns null when nothing was submitted", () => {
    expect(validateSubmittedTarget(null, 100)).toBeNull();
    expect(validateSubmittedTarget(undefined, 100)).toBeNull();
  });

  it("rejects negatives", () => {
    expect(validateSubmittedTarget(-5, 100)).toBeNull();
  });

  it("honours the tolerance boundary", () => {
    const justInside = 100 * (1 + TARGET_VALIDATION_TOLERANCE);
    const justOutside = 100 * (1 + TARGET_VALIDATION_TOLERANCE) + 0.5;
    expect(validateSubmittedTarget(justInside, 100)).toBe(justInside);
    expect(validateSubmittedTarget(justOutside, 100)).toBeNull();
  });

  it("handles a zero expected target (bodyweight work)", () => {
    expect(validateSubmittedTarget(0, 0)).toBe(0);
    expect(validateSubmittedTarget(20, 0)).toBeNull();
  });
});
