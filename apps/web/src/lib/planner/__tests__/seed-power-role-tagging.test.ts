/**
 * Regression — seed catalogue must tag plyo/Olympic movements with the
 * `power_*` functionalRoles the experience-tier filter in
 * `accessory-picker.ts` and `power-emphasis-transform.ts` looks for.
 *
 * Without these tags, beginner / novice users would see power cleans and
 * depth jumps surface as accessory choices. See `experience-tier-scope.md`.
 *
 * Loads the actual runtime seed (no mock) so any future seed row that
 * drops the tag — directly or via a helper override — trips this test.
 */
import { describe, expect, it } from "vitest";
import { SEED_MOVEMENTS } from "@hta/db/seeds/movements";

describe("seed catalogue — power_* functionalRoles tagging", () => {
  it("every olympic-pattern movement carries power_olympic", () => {
    const olympic = SEED_MOVEMENTS.filter((m) => m.pattern === "olympic");
    expect(olympic.length).toBeGreaterThan(0);
    for (const m of olympic) {
      const roles = m.functionalRoles ?? [];
      expect(
        roles.includes("power_olympic"),
        `${m.slug} (olympic) missing power_olympic — has [${roles.join(", ")}]`,
      ).toBe(true);
    }
  });

  it("every plyometric-pattern movement carries power_plyometric or power_ballistic", () => {
    const plyo = SEED_MOVEMENTS.filter((m) => m.pattern === "plyometric");
    expect(plyo.length).toBeGreaterThan(0);
    for (const m of plyo) {
      const roles = m.functionalRoles ?? [];
      const tagged =
        roles.includes("power_plyometric") || roles.includes("power_ballistic");
      expect(
        tagged,
        `${m.slug} (plyometric) missing power_plyometric/power_ballistic — has [${roles.join(", ")}]`,
      ).toBe(true);
    }
  });
});
