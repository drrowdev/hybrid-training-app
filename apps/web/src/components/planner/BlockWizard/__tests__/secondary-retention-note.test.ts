/**
 * ADR 0044 (UX) — "secondary focus = retention" honesty copy.
 *
 * In a cardio-led block the lifting volume sits at/below MEV, so a strength or
 * muscle secondary focus MAINTAINS the quality rather than developing it. The
 * wizard must say so up front. The note appears ONLY for a cardio primary; every
 * other primary (where the secondary genuinely develops) returns null.
 */
import { describe, expect, it } from "vitest";
import { secondaryRetentionNote } from "../Step3Secondary";

describe("secondaryRetentionNote", () => {
  it("flags strength + muscle as retention in a cardio-led block", () => {
    expect(secondaryRetentionNote("cardio", "strength")).toMatch(/maintains strength/i);
    expect(secondaryRetentionNote("cardio", "muscle")).toMatch(/maintains size/i);
  });

  it("is silent for a cardio secondary (it develops, not maintains)", () => {
    expect(secondaryRetentionNote("cardio", "cardio")).toBeNull();
  });

  it("is silent for non-cardio primaries (strength develops in a strength/muscle block)", () => {
    expect(secondaryRetentionNote("strength", "muscle")).toBeNull();
    expect(secondaryRetentionNote("muscle", "strength")).toBeNull();
    expect(secondaryRetentionNote(null, "strength")).toBeNull();
    expect(secondaryRetentionNote(undefined, "strength")).toBeNull();
  });
});
