/**
 * MODALITY_REGION — cardio modality → region attribution.
 *
 * Relocated out of the (removed) Strava integration folder; it is
 * general-purpose engine input. `lib/engine/region-ledger.ts` reads it for
 * every `cardio_logs` row without a `movement_id`, so an accidental key
 * rename silently zeroes cardio's region contribution.
 */
import { describe, it, expect } from "vitest";
import { MODALITY_REGION } from "../modality-region";

describe("MODALITY_REGION", () => {
  it("covers every cardio modality the engine can be handed", () => {
    expect(Object.keys(MODALITY_REGION).sort()).toEqual(
      ["bike", "other_cardio", "row", "run", "ski", "swim", "walk"].sort(),
    );
  });

  it("gives every modality a primary region and a secondary array", () => {
    for (const [modality, m] of Object.entries(MODALITY_REGION)) {
      expect(typeof m.primaryRegion, modality).toBe("string");
      expect(m.primaryRegion.length, modality).toBeGreaterThan(0);
      expect(Array.isArray(m.secondaryRegions), modality).toBe(true);
      expect(m.secondaryRegions, modality).not.toContain(m.primaryRegion);
    }
  });

  it("keeps the load-bearing attributions (run → knee, row → lumbar, swim → shoulder)", () => {
    expect(MODALITY_REGION.run?.primaryRegion).toBe("knee");
    expect(MODALITY_REGION.run?.secondaryRegions).toContain("foot_ankle_calf");
    expect(MODALITY_REGION.row?.primaryRegion).toBe("lumbar_trunk");
    expect(MODALITY_REGION.swim?.primaryRegion).toBe("shoulder_scapular");
  });
});
