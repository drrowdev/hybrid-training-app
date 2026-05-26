import { describe, it, expect } from "vitest";
import {
  SET_KINDS,
  SET_KIND_LABELS,
  setKindLabel,
  type SetKind,
} from "../set-kind-labels";

describe("SET_KIND_LABELS", () => {
  it("has a label and caption defined for each SetKind", () => {
    for (const kind of SET_KINDS) {
      const entry = SET_KIND_LABELS[kind];
      expect(entry).toBeDefined();
      expect(entry.label).toBeTruthy();
      expect(entry.caption).toBeTruthy();
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.caption.length).toBeGreaterThan(0);
    }
  });

  it("labels are humanised — no underscores or ALL-CAPS slugs", () => {
    for (const kind of SET_KINDS) {
      const { label } = SET_KIND_LABELS[kind];
      expect(label).not.toMatch(/_/);
      // Single all-caps words are slug-y and not user-friendly. Allow
      // mixed case with at most a hyphen (e.g. "Warm-up").
      expect(label).not.toMatch(/^[A-Z0-9-]+$/);
    }
  });

  it("renames back_off to 'Supplemental' (regression guard)", () => {
    expect(SET_KIND_LABELS.back_off.label).toBe("Supplemental");
    // Captions should not leak the internal slug.
    expect(SET_KIND_LABELS.back_off.caption).not.toMatch(/back[-_ ]?off/i);
  });

  it("covers exactly the five SetKind variants", () => {
    const keys = Object.keys(SET_KIND_LABELS).sort();
    expect(keys).toEqual(
      (["accessory", "back_off", "main", "tendon", "warmup"] satisfies SetKind[]).sort(),
    );
  });
});

describe("setKindLabel", () => {
  it("returns the configured label for known kinds", () => {
    expect(setKindLabel("back_off")).toBe("Supplemental");
    expect(setKindLabel("warmup")).toBe("Warm-up");
    expect(setKindLabel("main")).toBe("Main");
  });

  it("falls back to a humanised slug for unknown kinds", () => {
    expect(setKindLabel("power_potentiation")).toBe("power potentiation");
  });
});
