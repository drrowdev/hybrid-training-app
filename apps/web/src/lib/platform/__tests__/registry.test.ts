import { describe, it, expect } from "vitest";
import {
  getProgramEngine,
  getNativeProgramEngine,
  isNativeProgram,
  isKnownProgram,
  PROGRAM_CATALOG,
  selectablePrograms,
} from "../registry";

describe("program registry", () => {
  it("resolves each shipped engine by its stable id", () => {
    expect(getProgramEngine("wendler-531")?.meta.family).toBe("531");
    expect(getProgramEngine("tactical-barbell")?.meta.family).toBe("tactical-barbell");
    expect(getProgramEngine("green-protocol")?.meta.family).toBe("tactical-barbell-green");
    expect(getProgramEngine("tactical-barbell-zulu-ht")?.meta.name).toBe("Zulu/HT");
  });

  it("resolves the native Hybrid engine through the native registry only", () => {
    expect(isNativeProgram("hybrid")).toBe(true);
    expect(getNativeProgramEngine("hybrid")?.meta.family).toBe("hybrid");
    // Hybrid is NOT a foreign per-session engine.
    expect(getProgramEngine("hybrid")).toBeUndefined();
    // Foreign engines are not native.
    expect(isNativeProgram("wendler-531")).toBe(false);
    expect(getNativeProgramEngine("wendler-531")).toBeUndefined();
  });

  it("reports unknown programs", () => {
    expect(isKnownProgram("wendler-531")).toBe(true);
    expect(isKnownProgram("hybrid")).toBe(true);
    expect(isKnownProgram("nope")).toBe(false);
    expect(getProgramEngine("nope")).toBeUndefined();
  });

  it("the catalogue exposes every engine with a selectable flag", () => {
    const ids = PROGRAM_CATALOG.map((p) => p.id).sort();
    expect(ids).toEqual([
      "green-protocol",
      "hybrid",
      "hyrox",
      "tactical-barbell",
      "tactical-barbell-zulu-ht",
      "wendler-531",
    ]);
    expect(PROGRAM_CATALOG.every((p) => p.name && p.summary)).toBe(true);
  });

  it("Hybrid leads the catalogue as the headline goal-driven program", () => {
    expect(PROGRAM_CATALOG[0]?.id).toBe("hybrid");
  });

  it("Zulu/HT is a building block — not a headline selectable program", () => {
    const ids = selectablePrograms().map((p) => p.id).sort();
    expect(ids).toEqual(["green-protocol", "hybrid", "hyrox", "tactical-barbell", "wendler-531"]);
    expect(ids).not.toContain("tactical-barbell-zulu-ht");
  });

  it("every selectable program's engine exposes a setup schema", () => {
    for (const p of selectablePrograms()) {
      const engine = getProgramEngine(p.id) ?? getNativeProgramEngine(p.id);
      const fields = engine!.describeSetup().fields;
      expect(Array.isArray(fields)).toBe(true);
      expect(fields.length).toBeGreaterThan(0);
    }
  });
});
