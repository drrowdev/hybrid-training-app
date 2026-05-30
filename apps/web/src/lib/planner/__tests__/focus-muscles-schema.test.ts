/**
 * Tests for the focus-muscle Zod allowlist schema.
 *
 * Mirrors the DB CHECK constraints from migration 0079:
 *  - max 2 entries
 *  - membership in the 12-muscle allowlist
 *
 * The DB is the final guard, but Zod validation server-side keeps the
 * RLS layer from returning Postgres errors. See
 * `apps/web/src/lib/planner/focus-muscles.ts`.
 */
import { describe, expect, it } from "vitest";
import {
  FOCUS_MUSCLE_ALLOWLIST,
  FOCUS_MUSCLE_MAX,
  focusMusclesSchema,
  isFocusMuscle,
  formatFocusMuscles,
} from "../focus-muscles";

describe("focusMusclesSchema — allowlist", () => {
  it("accepts every member of FOCUS_MUSCLE_ALLOWLIST", () => {
    for (const m of FOCUS_MUSCLE_ALLOWLIST) {
      const r = focusMusclesSchema.safeParse([m]);
      expect(r.success).toBe(true);
    }
  });

  it("rejects an excluded muscle (lower_back)", () => {
    const r = focusMusclesSchema.safeParse(["lower_back"]);
    expect(r.success).toBe(false);
  });

  it("rejects an excluded muscle (abs / core)", () => {
    expect(focusMusclesSchema.safeParse(["abs"]).success).toBe(false);
  });

  it("rejects an unknown string", () => {
    expect(focusMusclesSchema.safeParse(["pectoralis_minor"]).success).toBe(false);
  });
});

describe("focusMusclesSchema — size cap", () => {
  it(`rejects ${FOCUS_MUSCLE_MAX + 1} entries`, () => {
    const r = focusMusclesSchema.safeParse(["biceps", "triceps", "quads"]);
    expect(r.success).toBe(false);
  });

  it("accepts 0 entries (no focus → engine baseline)", () => {
    const r = focusMusclesSchema.safeParse([]);
    expect(r.success).toBe(true);
    expect(r.data).toEqual([]);
  });

  it("accepts 1 entry", () => {
    const r = focusMusclesSchema.safeParse(["forearms"]);
    expect(r.success).toBe(true);
    expect(r.data).toEqual(["forearms"]);
  });

  it("accepts the maximum allowed entries", () => {
    const r = focusMusclesSchema.safeParse(["biceps", "triceps"]);
    expect(r.success).toBe(true);
    expect(r.data).toEqual(["biceps", "triceps"]);
  });

  it("de-duplicates a doubled selection (preserves order)", () => {
    const r = focusMusclesSchema.safeParse(["biceps", "biceps"]);
    expect(r.success).toBe(true);
    expect(r.data).toEqual(["biceps"]);
  });
});

describe("isFocusMuscle", () => {
  it("returns true for allowlist members", () => {
    expect(isFocusMuscle("biceps")).toBe(true);
    expect(isFocusMuscle("side_delts")).toBe(true);
  });

  it("returns false for excluded muscles", () => {
    expect(isFocusMuscle("lower_back")).toBe(false);
    expect(isFocusMuscle("medial_delts")).toBe(false); // not the canonical spelling
  });
});

describe("formatFocusMuscles", () => {
  it("returns an empty string for no focus", () => {
    expect(formatFocusMuscles([])).toBe("");
  });

  it("renders practitioner labels in order", () => {
    expect(formatFocusMuscles(["biceps", "forearms"])).toBe("Biceps, Forearms");
  });

  it("silently drops invalid entries", () => {
    expect(formatFocusMuscles(["biceps", "fake_muscle", "triceps"])).toBe(
      "Biceps, Triceps",
    );
  });

  it("uses 'Medial delts' for side_delts (UI vocabulary)", () => {
    expect(formatFocusMuscles(["side_delts"])).toBe("Medial delts");
  });
});
