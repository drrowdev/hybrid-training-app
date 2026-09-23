import { describe, expect, it } from "vitest";
import { readProgramLoadBasis, resolveProgramWorkingMax, type ProgramLoadBasis } from "./program-load-basis";
import { resolveLoadReference, resolveTargetLoadKg } from "./target-load";
import { resolvePrescribedSnapshot } from "./prescribed-snapshot";

describe("DC-R6 program-owned loading basis", () => {
  it("uses the issued basis for reference labels and saved snapshots despite conflicting account defaults", () => {
    const oneRm = { percentTm: 80, meta: { programLoadBasis: {
      version: 1, kind: "one-rm", percent: 100, roundingKg: null,
    } } };
    const working = { percentTm: 80, meta: { programLoadBasis: {
      version: 1, kind: "working-max", kg: 100,
    } } };
    expect(resolveLoadReference(oneRm, { tmKg: 85, oneRmKg: 100 })).toEqual({ kg: 100, basis: "1RM" });
    expect(resolveLoadReference(working, { tmKg: 100, oneRmKg: 100 })).toEqual({ kg: 100, basis: "TM" });
    expect(resolveLoadReference(working)).toEqual({ kg: 100, basis: "TM" });
    expect(resolvePrescribedSnapshot(oneRm, { oneRmKg: 100, basis: "TM" }).prescribed?.basis).toBe("1RM");
    expect(resolvePrescribedSnapshot(working, { oneRmKg: 100, basis: "1RM" }).prescribed?.basis).toBe("TM");
    expect(resolveLoadReference({}, { tmKg: 85, oneRmKg: 100 })).toEqual({ kg: 85, basis: "TM" });
    expect(resolveLoadReference({}, { tmKg: 100, oneRmKg: 100 })).toEqual({ kg: 100, basis: "1RM" });
    expect(resolvePrescribedSnapshot({ percentTm: 80 }, { tmKg: 100 }).prescribed?.basis).toBeUndefined();
  });

  it("keeps two programs' working percentages independent for the same shared measurement", () => {
    const strength: ProgramLoadBasis = { version: 1, kind: "one-rm", percent: 90, roundingKg: 2.5 };
    const hybrid: ProgramLoadBasis = { version: 1, kind: "one-rm", percent: 85, roundingKg: 2.5 };
    expect(resolveProgramWorkingMax(strength, 100)).toBe(90);
    expect(resolveProgramWorkingMax(hybrid, 100)).toBe(85);
    expect(resolveProgramWorkingMax({ ...hybrid, percent: 80 }, 100)).toBe(80);
    expect(resolveProgramWorkingMax(strength, 100)).toBe(90);
    expect(resolveProgramWorkingMax(strength, 120)).toBe(107.5);
  });
  it("retains an engine-owned working max without re-deriving it from a changed account measurement", () => {
    const basis: ProgramLoadBasis = { version: 1, kind: "working-max", kg: 121 };
    expect(resolveProgramWorkingMax(basis, 142.5)).toBe(121);
    expect(resolveProgramWorkingMax(basis, 150)).toBe(121);
    expect(resolveProgramWorkingMax(basis, null)).toBe(121);
  });
  it("does not invent a measured max and preserves basis rounding before session percentage", () => {
    const basis: ProgramLoadBasis = { version: 1, kind: "one-rm", percent: 90, roundingKg: 5 };
    expect(resolveProgramWorkingMax(basis, null)).toBeNull();
    expect(resolveProgramWorkingMax(basis, 0)).toBeNull();
    expect(resolveProgramWorkingMax(basis, 142.5)).toBe(130);
    expect(resolveProgramWorkingMax({ ...basis, percent: 100, roundingKg: null }, 142.5)).toBe(142.5);
  });
  it("uses the issued program basis across displayed and persisted targets, never another slot's default", () => {
    const item = { kind: "main", percentTm: 80, meta: {
      programLoadBasis: { version: 1, kind: "one-rm", percent: 90, roundingKg: 2.5 },
    } };
    const ctx = { tmKg: 60, oneRmKg: 100 };
    expect(resolveTargetLoadKg(item, ctx)).toBe(72);
    expect(resolvePrescribedSnapshot(item, ctx).targetWeightKg).toBe(72);
    expect(resolveTargetLoadKg(item, { ...ctx, tmKg: 120 })).toBe(72);
    expect(resolveTargetLoadKg(item, { tmKg: 120 })).toBeNull();
    expect(resolveTargetLoadKg({ kind: "main", percentTm: 80 }, ctx)).toBe(48);
  });
  it("retains system-load conversion and absolute rehab loads", () => {
    expect(resolveTargetLoadKg({ kind: "main", percentTm: 80, meta: {
      programLoadBasis: { version: 1, kind: "working-max", kg: 120 },
    } }, { tmKg: 200, isSystemLoad: true, bodyweightKg: 80 })).toBe(16);
    expect(resolveTargetLoadKg({ kind: "tendon", targetWeightKg: 7.5 }, { tmKg: 200 })).toBe(7.5);
  });
  it("distinguishes untouched legacy data from invalid new settings", () => {
    expect(readProgramLoadBasis(undefined)).toBeNull();
    expect(readProgramLoadBasis(null)).toBeNull();
    for (const value of [{}, { version: 2 }, { version: 1, kind: "working-max", kg: 0 },
      { version: 1, kind: "one-rm", percent: 90, roundingKg: 0 },
      { version: 1, kind: "one-rm", percent: Number.NaN, roundingKg: 2.5 }]) {
      expect(() => readProgramLoadBasis(value)).toThrow();
    }
  });
});
