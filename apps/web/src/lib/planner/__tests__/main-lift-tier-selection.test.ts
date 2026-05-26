/**
 * PR W2 — main-lift resolver Surface B.
 *
 * Verifies the tier-aware candidate-pick behaviour without going
 * through the full Supabase round-trip. We exercise the same algorithm
 * the resolver uses inline (first in-band candidate with a TM, fall
 * back to first candidate with a TM regardless of band).
 *
 * The high-bar / pause-bar squat case:
 *   - Beginner (tier 0): high-bar is in band (0, 4), pause-bar gates
 *     at (2, 4). Resolver picks high-bar even though both have TMs.
 *   - Advanced (tier 3): both are in band; the first candidate in the
 *     role's slug list wins. With the canonical `STRENGTH_ROLE_CANDIDATES`
 *     order the user's TM coverage decides.
 */
import { describe, it, expect } from "vitest";
import { declaredExperienceToTier, tierInBand } from "../experience-tier";

type Row = {
  id: string;
  slug: string;
  display_name: string;
  experience_min: number;
  experience_max: number;
};

function pickInBand(
  candidateSlugs: readonly string[],
  movementBySlug: Map<string, Row>,
  tmMovementIds: Set<string>,
  tier: number | null,
): { slug: string; reason: "in_band" | "out_of_band" } | null {
  for (const slug of candidateSlugs) {
    const mv = movementBySlug.get(slug);
    if (!mv) continue;
    if (!tmMovementIds.has(mv.id)) continue;
    if (!tierInBand(tier, mv.experience_min, mv.experience_max)) continue;
    return { slug: mv.slug, reason: "in_band" };
  }
  for (const slug of candidateSlugs) {
    const mv = movementBySlug.get(slug);
    if (mv && tmMovementIds.has(mv.id)) {
      return { slug: mv.slug, reason: "out_of_band" };
    }
  }
  return null;
}

const SQUAT_CANDIDATES = [
  "back-squat-high-bar",
  "back-squat-low-bar",
  "front-squat",
  "paused-back-squat",
  "tempo-back-squat",
] as const;

const movementBySlug = new Map<string, Row>([
  ["back-squat-high-bar", { id: "1", slug: "back-squat-high-bar", display_name: "Back Squat (high-bar)", experience_min: 0, experience_max: 4 }],
  ["back-squat-low-bar", { id: "2", slug: "back-squat-low-bar", display_name: "Back Squat (low-bar)", experience_min: 0, experience_max: 4 }],
  ["front-squat", { id: "3", slug: "front-squat", display_name: "Front Squat", experience_min: 0, experience_max: 4 }],
  ["paused-back-squat", { id: "4", slug: "paused-back-squat", display_name: "Paused Back Squat", experience_min: 2, experience_max: 4 }],
  ["tempo-back-squat", { id: "5", slug: "tempo-back-squat", display_name: "Tempo Back Squat", experience_min: 2, experience_max: 4 }],
]);

describe("main-lift resolver — tier-aware variant pick (Surface B)", () => {
  it("beginner picks back-squat-high-bar over paused-back-squat", () => {
    // User has TMs for BOTH high-bar and pause-bar.
    const tms = new Set(["1", "4"]);
    const tier = declaredExperienceToTier("beginner_lt_6m");
    const pick = pickInBand(SQUAT_CANDIDATES, movementBySlug, tms, tier);
    expect(pick).not.toBeNull();
    expect(pick!.slug).toBe("back-squat-high-bar");
    expect(pick!.reason).toBe("in_band");
  });

  it("advanced (tier 3) picks the first candidate in role order they have a TM for", () => {
    // User has TMs ONLY for pause-bar — advanced is in band.
    const tms = new Set(["4"]);
    const tier = declaredExperienceToTier("advanced_5y_10y");
    const pick = pickInBand(SQUAT_CANDIDATES, movementBySlug, tms, tier);
    expect(pick).not.toBeNull();
    expect(pick!.slug).toBe("paused-back-squat");
    expect(pick!.reason).toBe("in_band");
  });

  it("beginner with TM ONLY for out-of-band variant falls back to it (don't block training)", () => {
    // Beginner has a TM only for pause-bar (which their tier shouldn't see).
    // The resolver honours the TM rather than blocking the day.
    const tms = new Set(["4"]);
    const tier = declaredExperienceToTier("beginner_lt_6m");
    const pick = pickInBand(SQUAT_CANDIDATES, movementBySlug, tms, tier);
    expect(pick).not.toBeNull();
    expect(pick!.slug).toBe("paused-back-squat");
    expect(pick!.reason).toBe("out_of_band");
  });

  it("null tier (no declaration) uses legacy first-with-TM behaviour", () => {
    const tms = new Set(["3", "4"]);
    const pick = pickInBand(SQUAT_CANDIDATES, movementBySlug, tms, null);
    expect(pick).not.toBeNull();
    expect(pick!.slug).toBe("front-squat");
    expect(pick!.reason).toBe("in_band");
  });
});
