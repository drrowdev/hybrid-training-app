/**
 * Unit tests for the shared strength-prescription predicate
 * (review-211 #2 — extracted to prevent drift between import-history
 * and the in-session logging path).
 */
import { describe, it, expect, vi } from "vitest";
import {
  STRENGTH_MAIN_KIND,
  prescriptionItemsHaveStrength,
  sessionPrescribesStrength,
} from "../strength-prescribed";

describe("strength-prescribed — pure JSON predicate", () => {
  it("returns true when at least one item has kind=main", () => {
    expect(
      prescriptionItemsHaveStrength([
        { kind: "warmup" },
        { kind: "main" },
        { kind: "accessory" },
      ]),
    ).toBe(true);
  });

  it("returns false when no main item is present", () => {
    expect(
      prescriptionItemsHaveStrength([
        { kind: "warmup" },
        { kind: "accessory" },
        { kind: "tendon" },
      ]),
    ).toBe(false);
  });

  it("returns false for null / undefined / empty input", () => {
    expect(prescriptionItemsHaveStrength(null)).toBe(false);
    expect(prescriptionItemsHaveStrength(undefined)).toBe(false);
    expect(prescriptionItemsHaveStrength([])).toBe(false);
  });

  it("ignores items missing the kind field entirely", () => {
    expect(
      prescriptionItemsHaveStrength([{} as { kind?: string }, { kind: null }]),
    ).toBe(false);
  });

  it("does NOT match unrelated kinds (cardio etc.)", () => {
    expect(prescriptionItemsHaveStrength([{ kind: "cardio_z2" }])).toBe(false);
  });

  it("STRENGTH_MAIN_KIND is the exact string 'main'", () => {
    expect(STRENGTH_MAIN_KIND).toBe("main");
  });
});

describe("strength-prescribed — DB-side predicate", () => {
  function mockClient(count: number | null) {
    const chain = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      // Resolves as the awaited builder.
      then: (resolve: (v: { count: number | null; error: null }) => void) =>
        resolve({ count, error: null }),
    };
    return chain as never;
  }

  it("returns true when count > 0", async () => {
    const supabase = mockClient(3);
    expect(await sessionPrescribesStrength(supabase, "s1")).toBe(true);
  });

  it("returns false when count is 0", async () => {
    const supabase = mockClient(0);
    expect(await sessionPrescribesStrength(supabase, "s1")).toBe(false);
  });

  it("returns false when count is null (defensive)", async () => {
    const supabase = mockClient(null);
    expect(await sessionPrescribesStrength(supabase, "s1")).toBe(false);
  });
});
