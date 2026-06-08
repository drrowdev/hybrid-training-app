/**
 * ADR 0040 — interference-aware accessory headroom.
 *
 * Pins: the all-running anchor (running cardio → 0 bonus → byte-identical), the
 * strength-emphasis gate (no bonus on cardio-led / non-strength archetypes), the
 * threshold (a token low-interference dose earns nothing; a real saving earns the
 * +1), the cap, and the modality-key mapping.
 */
import { describe, it, expect } from "vitest";
import {
  computeInterferenceVolumeBonus,
  scalarModalityKey,
  INTERFERENCE_BONUS_MAX_ITEMS,
} from "../interference-volume";

describe("ADR 0040 — scalarModalityKey", () => {
  it("maps planner modalities (and null default) to scalar keys", () => {
    expect(scalarModalityKey("running")).toBe("run");
    expect(scalarModalityKey(null)).toBe("run");
    expect(scalarModalityKey("cycling")).toBe("bike");
    expect(scalarModalityKey("rowing")).toBe("row");
    expect(scalarModalityKey("swimming")).toBe("swim");
    expect(scalarModalityKey("ski_erg")).toBe("ski");
    expect(scalarModalityKey("elliptical")).toBe("other_cardio");
  });
});

describe("ADR 0040 — computeInterferenceVolumeBonus", () => {
  it("is 0 when planned == default (byte-identical anchor)", () => {
    expect(
      computeInterferenceVolumeBonus({
        defaultMinutesByModality: { bike: 200 },
        plannedMinutesByModality: { bike: 200 },
        archetypeId: "strength_anchor",
      }),
    ).toBe(0);
    expect(
      computeInterferenceVolumeBonus({
        defaultMinutesByModality: { run: 200 },
        plannedMinutesByModality: { run: 200 },
        archetypeId: "concurrent_hybrid",
      }),
    ).toBe(0);
  });

  it("is 0 for non-strength archetypes even when the plan diversifies", () => {
    for (const id of ["endurance_anchor", "rebuild", "maintenance"] as const) {
      expect(
        computeInterferenceVolumeBonus({
          defaultMinutesByModality: { run: 200 },
          plannedMinutesByModality: { bike: 200 },
          archetypeId: id,
        }),
      ).toBe(0);
    }
  });

  it("is 0 when there is no planned cardio", () => {
    expect(
      computeInterferenceVolumeBonus({
        defaultMinutesByModality: {},
        plannedMinutesByModality: {},
        archetypeId: "concurrent_hybrid",
      }),
    ).toBe(0);
  });

  it("grants +1 when the planned mix diversifies substantially below the default", () => {
    expect(
      computeInterferenceVolumeBonus({
        defaultMinutesByModality: { run: 200 },
        plannedMinutesByModality: { bike: 200 },
        archetypeId: "strength_anchor",
      }),
    ).toBe(INTERFERENCE_BONUS_MAX_ITEMS);
    expect(
      computeInterferenceVolumeBonus({
        defaultMinutesByModality: { run: 200 },
        plannedMinutesByModality: { run: 100, bike: 100 },
        archetypeId: "concurrent_hybrid",
      }),
    ).toBe(1);
  });

  it("is 0 for a token diversification below threshold", () => {
    // 45 min run→bike saves only ~0.027 scalar < 0.04 threshold.
    expect(
      computeInterferenceVolumeBonus({
        defaultMinutesByModality: { run: 45 },
        plannedMinutesByModality: { bike: 45 },
        archetypeId: "strength_anchor",
      }),
    ).toBe(0);
  });

  it("does NOT reward making the plan HIGHER-interference than default", () => {
    // e.g. a cyclist whose protected sessions are forced back to running.
    expect(
      computeInterferenceVolumeBonus({
        defaultMinutesByModality: { bike: 200 },
        plannedMinutesByModality: { run: 200 },
        archetypeId: "strength_anchor",
      }),
    ).toBe(0);
  });

  it("never exceeds the cap", () => {
    const bonus = computeInterferenceVolumeBonus({
      defaultMinutesByModality: { run: 600 },
      plannedMinutesByModality: { bike: 600 },
      archetypeId: "strength_anchor",
    });
    expect(bonus).toBeLessThanOrEqual(INTERFERENCE_BONUS_MAX_ITEMS);
  });
});
