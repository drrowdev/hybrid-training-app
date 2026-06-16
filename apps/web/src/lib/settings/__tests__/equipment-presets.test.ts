/**
 * Unit coverage for the equipment preset definitions and the
 * read-time `resolveEquipment` fallback that bridges
 * `profiles.equipment` JSONB ↔ the legacy bar/plate columns.
 */
import { describe, expect, it } from "vitest";
import {
  COMMERCIAL_GYM_PRESET,
  FUNCTIONAL_GYM_PRESET,
  HOME_GYM_PRESET,
  TRAVEL_HOTEL_PRESET,
  BODYWEIGHT_ONLY_PRESET,
  CUSTOM_EMPTY_PRESET,
  hasLoadableMainLift,
  presetKeyForScheme,
  resolveEquipment,
} from "../equipment-presets";
import { parseEquipment } from "../equipment-schema";

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
    expect(HOME_GYM_PRESET.accessories.weightedVest).toEqual([10]);
    expect(HOME_GYM_PRESET.accessories.sandbag).toEqual([20]);
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

  it("Bodyweight-only preset zeroes the bars and loadable kit", () => {
    expect(BODYWEIGHT_ONLY_PRESET.preset).toBe("bodyweight_only");
    expect(BODYWEIGHT_ONLY_PRESET.bars.barbellKg).toBe(0);
    expect(BODYWEIGHT_ONLY_PRESET.bars.trapBarKg).toBeNull();
    expect(BODYWEIGHT_ONLY_PRESET.bars.safetyBarKg).toBeNull();
    expect(BODYWEIGHT_ONLY_PRESET.plates).toEqual([]);
    expect(BODYWEIGHT_ONLY_PRESET.dumbbells).toBeNull();
    expect(BODYWEIGHT_ONLY_PRESET.kettlebells).toEqual([]);
    expect(BODYWEIGHT_ONLY_PRESET.machines).toEqual([]);
    expect(BODYWEIGHT_ONLY_PRESET.cardio).toEqual([]);
    // Pull-up bar is the realistic floor for bodyweight programmes.
    expect(BODYWEIGHT_ONLY_PRESET.accessories.pullUpBar).toBe(true);
    expect(BODYWEIGHT_ONLY_PRESET.accessories.dipBelt).toBe(false);
    expect(BODYWEIGHT_ONLY_PRESET.accessories.weightedVest).toEqual([]);
  });
});

describe("Functional gym preset", () => {
  it("has the expected shape — barbells, bumper plates, full KB range, conditioning ergs, no machines", () => {
    expect(FUNCTIONAL_GYM_PRESET).toEqual({
      preset: "functional_gym",
      bars: { barbellKg: 20, trapBarKg: null, safetyBarKg: null },
      plates: [25, 20, 15, 10, 5, 2.5, 1.25],
      dumbbells: { minKg: 5, maxKg: 50, stepKg: 2.5 },
      kettlebells: [8, 12, 16, 20, 24, 28, 32],
      machines: [],
      cardio: ["rower", "ski_erg", "bike_air", "treadmill"],
      accessories: {
        weightedVest: [9],
        sandbag: [25],
        dipBelt: false,
        dipBeltMaxKg: null,
        bands: true,
        bandStrength: "medium",
        ankleWeights: false,
        pullUpBar: true,
        rings: true,
        sled: true,
        wallBall: true,
      },
    });
  });
});

describe("parseEquipment — legacy weighted-vest / sandbag coercion", () => {
  const blob = (overrides: Record<string, unknown>) => ({
    preset: "custom",
    bars: { barbellKg: 20 },
    plates: [],
    kettlebells: [],
    machines: [],
    cardio: [],
    accessories: overrides,
  });

  it("`false` → []", () => {
    const out = parseEquipment(blob({ weightedVest: false, sandbag: false }));
    expect(out.accessories.weightedVest).toEqual([]);
    expect(out.accessories.sandbag).toEqual([]);
  });

  it("missing → []", () => {
    const out = parseEquipment(blob({}));
    expect(out.accessories.weightedVest).toEqual([]);
    expect(out.accessories.sandbag).toEqual([]);
  });

  it("`true` → typical-default chip (vest=[9], sandbag=[25])", () => {
    const out = parseEquipment(blob({ weightedVest: true, sandbag: true }));
    expect(out.accessories.weightedVest).toEqual([9]);
    expect(out.accessories.sandbag).toEqual([25]);
  });

  it("`<number>` → [<number>]", () => {
    const out = parseEquipment(blob({ weightedVest: 14, sandbag: 30 }));
    expect(out.accessories.weightedVest).toEqual([14]);
    expect(out.accessories.sandbag).toEqual([30]);
  });

  it("`{ kg: <n> }` pre-PR shape → [<n>]", () => {
    const out = parseEquipment(
      blob({ weightedVest: { kg: 9 }, sandbag: { kg: 25 } }),
    );
    expect(out.accessories.weightedVest).toEqual([9]);
    expect(out.accessories.sandbag).toEqual([25]);
  });

  it("`number[]` round-trips, dedup + sorted asc", () => {
    const out = parseEquipment(
      blob({ weightedVest: [20, 9, 9], sandbag: [50, 25] }),
    );
    expect(out.accessories.weightedVest).toEqual([9, 20]);
    expect(out.accessories.sandbag).toEqual([25, 50]);
  });

  it("sled / wallBall default to false when absent (pre-existing equipment)", () => {
    const out = parseEquipment(blob({}));
    expect(out.accessories.sled).toBe(false);
    expect(out.accessories.wallBall).toBe(false);
  });

  it("sled / wallBall round-trip when present", () => {
    const out = parseEquipment(blob({ sled: true, wallBall: true }));
    expect(out.accessories.sled).toBe(true);
    expect(out.accessories.wallBall).toBe(true);
  });
});

describe("HYROX equipment presets — sled / wall ball", () => {
  it("functional gym ships a sled + wall ball (HYROX-ready)", () => {
    expect(FUNCTIONAL_GYM_PRESET.accessories.sled).toBe(true);
    expect(FUNCTIONAL_GYM_PRESET.accessories.wallBall).toBe(true);
  });

  it("commercial / home / bodyweight default them off", () => {
    expect(COMMERCIAL_GYM_PRESET.accessories.sled).toBe(false);
    expect(COMMERCIAL_GYM_PRESET.accessories.wallBall).toBe(false);
    expect(BODYWEIGHT_ONLY_PRESET.accessories.sled).toBe(false);
    expect(BODYWEIGHT_ONLY_PRESET.accessories.wallBall).toBe(false);
  });
});

describe("hasLoadableMainLift", () => {
  it("false for the bodyweight-only preset", () => {
    expect(hasLoadableMainLift(BODYWEIGHT_ONLY_PRESET)).toBe(false);
  });

  it("true when a barbell is present", () => {
    expect(hasLoadableMainLift(COMMERCIAL_GYM_PRESET)).toBe(true);
    expect(hasLoadableMainLift(HOME_GYM_PRESET)).toBe(true);
  });

  it("true when dumbbells are present (travel / hotel)", () => {
    expect(hasLoadableMainLift(TRAVEL_HOTEL_PRESET)).toBe(true);
  });

  it("true when only a trap bar or safety squat bar is present", () => {
    expect(
      hasLoadableMainLift({
        ...BODYWEIGHT_ONLY_PRESET,
        bars: { barbellKg: 0, trapBarKg: 25, safetyBarKg: null },
      }),
    ).toBe(true);
    expect(
      hasLoadableMainLift({
        ...BODYWEIGHT_ONLY_PRESET,
        bars: { barbellKg: 0, trapBarKg: null, safetyBarKg: 25 },
      }),
    ).toBe(true);
  });
});

describe("presetKeyForScheme", () => {
  it("recognises a stored bodyweight-only blob even with a wrong saved preset", () => {
    expect(
      presetKeyForScheme({
        ...BODYWEIGHT_ONLY_PRESET,
        preset: "custom",
      }),
    ).toBe("bodyweight_only");
  });

  it("returns the stored preset when the shape doesn't match bodyweight", () => {
    expect(presetKeyForScheme(COMMERCIAL_GYM_PRESET)).toBe("commercial_gym");
    expect(presetKeyForScheme(HOME_GYM_PRESET)).toBe("home_gym");
    expect(presetKeyForScheme(TRAVEL_HOTEL_PRESET)).toBe("travel_hotel");
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
