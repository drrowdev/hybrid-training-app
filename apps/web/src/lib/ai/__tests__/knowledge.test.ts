import { describe, expect, it } from "vitest";

import {
  ARCHETYPES_SUMMARY,
  CALIBRATION_POLICY_TEXT,
  CONSTANTS_TABLE_TEXT,
} from "../knowledge";
import { SYSTEM_PROMPT, SYSTEM_PROMPT_VERSION } from "../system-prompt";

describe("knowledge embedding", () => {
  it("surfaces one summary row per built-in archetype", () => {
    expect(ARCHETYPES_SUMMARY.length).toBeGreaterThanOrEqual(5);
    for (const a of ARCHETYPES_SUMMARY) {
      expect(a.id).toMatch(/^[a-z_]+$/);
      expect(a.name.length).toBeGreaterThan(0);
      expect(a.description.length).toBeGreaterThan(0);
    }
  });

  it("CP-1..CP-5 are all named in the calibration policy", () => {
    for (const cp of ["CP-1", "CP-2", "CP-3", "CP-4", "CP-5"]) {
      expect(CALIBRATION_POLICY_TEXT).toContain(cp);
    }
  });

  it("CP-2 constants table names the core engine knobs", () => {
    expect(CONSTANTS_TABLE_TEXT).toContain("ATL decay");
    expect(CONSTANTS_TABLE_TEXT).toContain("CTL decay");
    expect(CONSTANTS_TABLE_TEXT).toContain("Recovery multiplier");
    expect(CONSTANTS_TABLE_TEXT).toContain("Confidence-bias");
    expect(CONSTANTS_TABLE_TEXT).toContain("Bucket count");
  });
});

describe("system prompt", () => {
  it("is non-empty, versioned, and binds the read-only contract", () => {
    expect(SYSTEM_PROMPT_VERSION).toBe("v1");
    expect(SYSTEM_PROMPT.length).toBeGreaterThan(500);
    // Voice + contract beats
    expect(SYSTEM_PROMPT).toMatch(/read/i);
    expect(SYSTEM_PROMPT).toContain("getEngineSnapshot");
    expect(SYSTEM_PROMPT).toContain("clinician");
    expect(SYSTEM_PROMPT).toMatch(/at most twice/i);
    expect(SYSTEM_PROMPT).toContain("Memories");
  });
});
