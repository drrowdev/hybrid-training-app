import { describe, it, expect } from "vitest";
import { cleanPrescriptionNotes } from "../clean-prescription-notes";

describe("cleanPrescriptionNotes", () => {
  it("returns null for null/undefined/empty", () => {
    expect(cleanPrescriptionNotes(null)).toBeNull();
    expect(cleanPrescriptionNotes(undefined)).toBeNull();
    expect(cleanPrescriptionNotes("")).toBeNull();
  });

  it("strips leaked Weekly tissue floor prefix", () => {
    expect(cleanPrescriptionNotes("Weekly tissue floor: carry")).toBeNull();
    expect(cleanPrescriptionNotes("Weekly tissue floor: heavy isometric")).toBeNull();
  });

  it("strips leaked Functional minimum prefix", () => {
    expect(cleanPrescriptionNotes("Functional minimum: single leg")).toBeNull();
  });

  it("strips leaked Per-muscle volume prefix", () => {
    expect(cleanPrescriptionNotes("Per-muscle volume: side delts")).toBeNull();
  });

  it("is case-insensitive on the prefix", () => {
    expect(cleanPrescriptionNotes("weekly tissue floor: foo")).toBeNull();
    expect(cleanPrescriptionNotes("FUNCTIONAL MINIMUM: bar")).toBeNull();
  });

  it("passes through user-meaningful notes unchanged", () => {
    expect(cleanPrescriptionNotes("top set")).toBe("top set");
    expect(cleanPrescriptionNotes("Stretch-loaded chest isolation that the press's mid-range misses.")).toBe(
      "Stretch-loaded chest isolation that the press's mid-range misses.",
    );
    expect(cleanPrescriptionNotes("Power emphasis: explosive intent (3–5 reps, full recovery)")).toBe(
      "Power emphasis: explosive intent (3–5 reps, full recovery)",
    );
  });
});
