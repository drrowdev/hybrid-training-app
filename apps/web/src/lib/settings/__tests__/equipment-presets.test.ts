/**
 * Unit coverage for the equipment preset definitions and the
 * read-time `resolveEquipment` fallback that bridges
 * `profiles.equipment` JSONB ↔ the legacy bar/plate columns.
 */
import { describe, expect, it } from "vitest";
import {
  COMMERCIAL_GYM_PRESET,
  HOME_GYM_PRESET,
  TRAVEL_HOTEL_PRESET,
  CUSTOM_EMPTY_PRESET,
  resolveEquipment,
} from "../equipment-presets";

describe("equipment presets — shape sanity", () => {
  it("Commercial gym preset has a full kit", () => {
    expect(COMMERCIAL_GYM_PRESET.preset).toBe("commercial_gym");
    expect(COMMERCIAL_GYM_PRESET.bars.barbellKg).toBe(20);
    expect(COMMERCIAL_GYM_PRESET.bars.trapBarKg).toBe(25);
    expect(COMMERCIAL_GYM_PRESET.bars.safetyBarKg).toBe(25);
    expect(COMMERCIAL_GYM_PRESET.plates).toEqual([25, 20, 15, 10, 5, 2.5, 1.25]);
    expect(COMMERCIAL_GYM_PRESET.dumbbells).toEqual({ minKg: 1, maxKg: 50, stepKg: 2.5 });
    expect(COMMERCIAL_GYM_PRESET.kettlebells).toEqual([8, 12, 16, 20, 24, 28, 32, 40]);
    expect(COMMERCIAL_GYM_PRESET.machines.length).toBe(10);
    expect(COMMERCIAL_GYM_PRESET.cardio.length).toBe(6);
    expect(COMMERCIAL_GYM_PRESET.accessories.dipBelt).toBe(true);
    expect(COMMERCIAL_GYM_PRESET.accessories.pullUpBar).toBe(true);
  });

  it("Home gym preset drops dumbbells, trap bar, machines and cardio", () => {
    expect(HOME_GYM_PRESET.preset).toBe("home_gym");
    expect(HOME_GYM_PRESET.bars.trapBarKg).toBeNull();
    expect(HOME_GYM_PRESET.bars.safetyBarKg).toBeNull();
    expect(HOME_GYM_PRESET.dumbbells).toBeNull();
    expect(HOME_GYM_PRESET.machines).toEqual([]);
    expect(HOME_GYM_PRESET.cardio).toEqual([]);
    expect(HOME_GYM_PRESET.kettlebells).toEqual([16, 24, 32]);
    expect(HOME_GYM_PRESET.accessories.weightedVest).toEqual({ kg: 10 });
    expect(HOME_GYM_PRESET.accessories.sandbag).toEqual({ kg: 20 });
  });

  it("Travel / hotel preset has no bar, dumbbell range only, one cable", () => {
    expect(TRAVEL_HOTEL_PRESET.preset).toBe("travel_hotel");
    expect(TRAVEL_HOTEL_PRESET.bars.barbellKg).toBe(0);
    expect(TRAVEL_HOTEL_PRESET.plates).toEqual([]);
    expect(TRAVEL_HOTEL_PRESET.dumbbells).toEqual({ minKg: 5, maxKg: 25, stepKg: 2.5 });
    expect(TRAVEL_HOTEL_PRESET.machines).toEqual(["cable_stack"]);
    expect(TRAVEL_HOTEL_PRESET.cardio).toEqual(["treadmill", "elliptical", "bike_recumbent"]);
    expect(TRAVEL_HOTEL_PRESET.accessories.bands).toBe(true);
    expect(TRAVEL_HOTEL_PRESET.accessories.dipBelt).toBe(false);
  });

  it("Custom preset is the empty starting point", () => {
    expect(CUSTOM_EMPTY_PRESET.preset).toBe("custom");
    expect(CUSTOM_EMPTY_PRESET.plates).toEqual([]);
    expect(CUSTOM_EMPTY_PRESET.kettlebells).toEqual([]);
    expect(CUSTOM_EMPTY_PRESET.machines).toEqual([]);
  });
});

describe("resolveEquipment — read-time fallback", () => {
  it("NULL equipment + NULL legacy fields → Commercial gym preset", () => {
    expect(resolveEquipment(null)).toEqual(COMMERCIAL_GYM_PRESET);
    expect(resolveEquipment({})).toEqual(COMMERCIAL_GYM_PRESET);
    expect(
      resolveEquipment({
        equipment: null,
        barbell_kg: null,
        trap_bar_kg: null,
        plate_inventory_kg: null,
      }),
    ).toEqual(COMMERCIAL_GYM_PRESET);
  });

  it("NULL equipment + migration-0038 defaults → Commercial gym preset (not a half-empty Custom)", () => {
    const out = resolveEquipment({
      equipment: null,
      barbell_kg: 20,
      trap_bar_kg: 25,
      plate_inventory_kg: [
        { weight_kg: 25, pair_count: 2 },
        { weight_kg: 20, pair_count: 2 },
        { weight_kg: 15, pair_count: 1 },
        { weight_kg: 10, pair_count: 2 },
        { weight_kg: 5, pair_count: 2 },
        { weight_kg: 2.5, pair_count: 2 },
        { weight_kg: 1.25, pair_count: 2 },
      ],
    });
    expect(out.preset).toBe("commercial_gym");
  });

  it("NULL equipment + custom legacy plate inventory → preset=custom with lifted values", () => {
    const out = resolveEquipment({
      equipment: null,
      barbell_kg: 15,
      trap_bar_kg: 28,
      plate_inventory_kg: [
        { weight_kg: 20, pair_count: 4 },
        { weight_kg: 10, pair_count: 2 },
        { weight_kg: 2.5, pair_count: 2 },
      ],
    });
    expect(out.preset).toBe("custom");
    expect(out.bars.barbellKg).toBe(15);
    expect(out.bars.trapBarKg).toBe(28);
    expect(out.bars.safetyBarKg).toBeNull();
    expect(out.plates).toEqual([20, 10, 2.5]);
  });

  it("equipment JSONB present → returned as-is via parseEquipment", () => {
    const stored = {
      preset: "home_gym",
      bars: { barbellKg: 20, trapBarKg: null, safetyBarKg: null },
      plates: [20, 10, 5],
      dumbbells: null,
      kettlebells: [16, 24],
      machines: [],
      cardio: [],
      accessories: {
        weightedVest: false,
        sandbag: false,
        dipBelt: true,
        bands: true,
        pullUpBar: true,
        rings: false,
      },
    };
    const out = resolveEquipment({ equipment: stored });
    expect(out.preset).toBe("home_gym");
    expect(out.plates).toEqual([20, 10, 5]);
    expect(out.kettlebells).toEqual([16, 24]);
    expect(out.accessories.dipBelt).toBe(true);
  });

  it("equipment JSONB with unknown machine values is silently dropped (forward-compat)", () => {
    const out = resolveEquipment({
      equipment: {
        preset: "custom",
        bars: { barbellKg: 20 },
        plates: [20],
        kettlebells: [],
        machines: ["cable_stack", "future_machine_we_dont_know_yet"],
        cardio: ["treadmill", "underwater_rower"],
        accessories: {},
      },
    });
    expect(out.machines).toEqual(["cable_stack"]);
    expect(out.cardio).toEqual(["treadmill"]);
  });
});
