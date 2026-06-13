/**
 * Swap-candidate ranking — pure scoring/ordering.
 */
import { describe, it, expect } from "vitest";
import {
  scoreSwapCandidate,
  rankSwapCandidates,
  type SwapMovementFields,
} from "../swap-ranking";

function mv(over: Partial<SwapMovementFields> & { id: string }): SwapMovementFields {
  return {
    id: over.id,
    slug: over.slug ?? over.id,
    display_name: over.display_name ?? over.id,
    equipment: over.equipment ?? null,
    primary_muscles: over.primary_muscles ?? [],
    secondary_muscles: over.secondary_muscles ?? [],
    primary_region: over.primary_region ?? null,
    functional_roles: over.functional_roles ?? [],
    bulletproof_roles: over.bulletproof_roles ?? [],
    is_compound: over.is_compound ?? null,
    is_supported: over.is_supported ?? null,
  };
}

const ORIGINAL = mv({
  id: "back-squat",
  display_name: "Back Squat",
  primary_muscles: ["quads", "glutes"],
  primary_region: "knee",
  functional_roles: [],
  bulletproof_roles: [],
  is_compound: true,
  is_supported: false,
});

describe("scoreSwapCandidate", () => {
  it("scores a same-muscle, same-region alternative higher than an unrelated one", () => {
    const frontSquat = mv({
      id: "front-squat",
      primary_muscles: ["quads", "glutes"],
      primary_region: "knee",
      is_compound: true,
      is_supported: false,
    });
    const legExtension = mv({
      id: "leg-extension",
      primary_muscles: ["quads"],
      primary_region: "knee",
      is_compound: false,
      is_supported: true,
    });
    expect(scoreSwapCandidate(ORIGINAL, frontSquat)).toBeGreaterThan(
      scoreSwapCandidate(ORIGINAL, legExtension),
    );
  });

  it("rewards shared functional/bulletproof roles", () => {
    const orig = mv({ id: "o", functional_roles: ["pull"], bulletproof_roles: ["hsr"] });
    const shared = mv({ id: "a", functional_roles: ["pull"], bulletproof_roles: ["hsr"] });
    const none = mv({ id: "b" });
    expect(scoreSwapCandidate(orig, shared)).toBeGreaterThan(scoreSwapCandidate(orig, none));
  });

  it("is zero for a candidate with no overlap at all", () => {
    const unrelated = mv({ id: "x", primary_muscles: ["calves"], primary_region: "foot_ankle_calf" });
    expect(scoreSwapCandidate(ORIGINAL, unrelated)).toBe(0);
  });
});

describe("rankSwapCandidates", () => {
  it("surfaces same-muscle candidates in the top slice even when they trail in input order (rank-before-slice)", () => {
    // Regression: the swap-candidates route must rank the WHOLE pattern bucket and
    // THEN slice to the limit. If the same-muscle alternatives sit at the end of an
    // arbitrary DB ordering, a naive slice-before-rank would drop them entirely.
    const orig = mv({ id: "dragon-flag", primary_muscles: ["abs"], primary_region: "lumbar_trunk" });
    const unrelated = Array.from({ length: 30 }, (_, i) =>
      mv({ id: `iso-${i}`, display_name: `Iso ${String(i).padStart(2, "0")}`, primary_muscles: ["biceps"] }),
    );
    const abCandidates = [
      mv({ id: "plank", display_name: "Plank", primary_muscles: ["abs"], primary_region: "lumbar_trunk" }),
      mv({ id: "ab-wheel", display_name: "Ab Wheel", primary_muscles: ["abs"], primary_region: "lumbar_trunk" }),
    ];
    // ab movements LAST, as an arbitrary DB order might return them.
    const ranked = rankSwapCandidates(orig, [...unrelated, ...abCandidates]).slice(0, 5);
    const topIds = ranked.map((c) => c.id);
    expect(topIds).toContain("plank");
    expect(topIds).toContain("ab-wheel");
    expect(ranked.filter((c) => c.recommended).map((c) => c.id).sort()).toEqual(["ab-wheel", "plank"]);
  });

  it("orders best-first and flags the closest matches as recommended", () => {
    const candidates = [
      mv({ id: "leg-extension", display_name: "Leg Extension", primary_muscles: ["quads"], primary_region: "knee", is_compound: false }),
      mv({ id: "front-squat", display_name: "Front Squat", primary_muscles: ["quads", "glutes"], primary_region: "knee", is_compound: true, is_supported: false }),
      mv({ id: "calf-raise", display_name: "Calf Raise", primary_muscles: ["calves"], primary_region: "foot_ankle_calf" }),
    ];
    const ranked = rankSwapCandidates(ORIGINAL, candidates);
    expect(ranked[0]!.id).toBe("front-squat");
    expect(ranked[0]!.recommended).toBe(true);
    // The unrelated calf raise sorts last and is not recommended.
    expect(ranked[ranked.length - 1]!.id).toBe("calf-raise");
    expect(ranked[ranked.length - 1]!.recommended).toBe(false);
  });

  it("breaks score ties alphabetically", () => {
    const a = mv({ id: "a", display_name: "Zercher Squat", primary_muscles: ["quads", "glutes"], primary_region: "knee", is_compound: true, is_supported: false });
    const b = mv({ id: "b", display_name: "Anderson Squat", primary_muscles: ["quads", "glutes"], primary_region: "knee", is_compound: true, is_supported: false });
    const ranked = rankSwapCandidates(ORIGINAL, [a, b]);
    expect(ranked.map((r) => r.display_name)).toEqual(["Anderson Squat", "Zercher Squat"]);
  });

  it("does not flag a weak (pattern-only) match as recommended", () => {
    const weak = mv({ id: "weak", display_name: "Unrelated", primary_muscles: ["calves"] });
    const ranked = rankSwapCandidates(ORIGINAL, [weak]);
    expect(ranked[0]!.recommended).toBe(false);
  });
});
