/**
 * archetypeDisplayName — label resolution across archetype, custom, and the new
 * platform-program blocks (migration 0103: archetype NULL, identity in
 * program_id/program_family, brand-neutral label in notes).
 */
import { describe, expect, it } from "vitest";
import { archetypeDisplayName } from "../queries";

describe("archetypeDisplayName", () => {
  it("resolves a known archetype slug to its display name", () => {
    expect(archetypeDisplayName("strength_anchor")).toBeTruthy();
    expect(archetypeDisplayName("strength_anchor")).not.toBe("strength_anchor");
  });

  it("uses notes for a custom block", () => {
    expect(archetypeDisplayName("custom", "My block")).toBe("My block");
    expect(archetypeDisplayName("custom", "  ")).toBe("Custom block");
  });

  it("falls back to a brand-neutral label for a platform block (null archetype)", () => {
    expect(archetypeDisplayName(null)).toBe("Training block");
    expect(archetypeDisplayName(null, "  ")).toBe("Training block");
    // a platform block's notes label is surfaced when present
    expect(archetypeDisplayName(null, "5/3/1 — platform program")).toBe(
      "5/3/1 — platform program",
    );
  });

  it("treats a legacy 'program:' placeholder like a platform block", () => {
    expect(archetypeDisplayName("program:531")).toBe("Training block");
  });

  it("returns an unknown slug verbatim (defensive)", () => {
    expect(archetypeDisplayName("totally_unknown")).toBe("totally_unknown");
  });
});
