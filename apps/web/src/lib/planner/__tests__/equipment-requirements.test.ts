import { describe, it, expect } from "vitest";
import {
  inferRequiredEquipment,
  isEquipmentAvailable,
  requirementFromEquipmentTag,
  resolveRequiredEquipment,
  type EquipmentRequirement,
} from "../equipment-requirements";
import {
  COMMERCIAL_GYM_PRESET,
  HOME_GYM_PRESET,
  TRAVEL_HOTEL_PRESET,
  CUSTOM_EMPTY_PRESET,
} from "@/lib/settings/equipment-presets";
import type { Equipment } from "@/lib/settings/equipment-schema";

function req(slug: string): EquipmentRequirement {
  return inferRequiredEquipment({ slug });
}

describe("inferRequiredEquipment — slug pattern mapping", () => {
  it("detects cable from any slug containing 'cable'", () => {
    expect(req("cable-lateral-raise")).toEqual({ kind: "cable" });
    expect(req("cable-fly-mid")).toEqual({ kind: "cable" });
    expect(req("cable_pull_through")).toEqual({ kind: "cable" });
  });

  it("detects each specific machine", () => {
    expect(req("leg-press-45")).toEqual({ kind: "machine", machine: "leg_press" });
    expect(req("seated-leg-curl")).toEqual({ kind: "machine", machine: "leg_curl" });
    expect(req("leg-extension")).toEqual({ kind: "machine", machine: "leg_extension" });
    expect(req("hack-squat")).toEqual({ kind: "machine", machine: "hack_squat" });
    expect(req("machine-chest-press")).toEqual({ kind: "machine", machine: "chest_press" });
    expect(req("lat-pulldown-wide")).toEqual({ kind: "machine", machine: "lat_pulldown" });
    expect(req("single-arm-pulldown")).toEqual({ kind: "machine", machine: "lat_pulldown" });
    expect(req("seated-row-machine")).toEqual({ kind: "machine", machine: "seated_row" });
    expect(req("hip-thrust-machine")).toEqual({ kind: "machine", machine: "hip_thrust" });
    expect(req("smith-squat")).toEqual({ kind: "machine", machine: "smith_machine" });
  });

  it("does not pick chest_press machine for a dumbbell chest press", () => {
    expect(req("db-chest-press")).toEqual({ kind: "dumbbells" });
    expect(req("dumbbell-chest-press")).toEqual({ kind: "dumbbells" });
  });

  it("does not pick lat_pulldown machine for a band pulldown", () => {
    expect(req("band-pulldown")).toEqual({ kind: "bands" });
  });

  it("detects dumbbells in multiple slug shapes", () => {
    expect(req("db-bench-flat")).toEqual({ kind: "dumbbells" });
    expect(req("bulgarian-split-squat-db")).toEqual({ kind: "dumbbells" });
    expect(req("dumbbell-shoulder-press")).toEqual({ kind: "dumbbells" });
    expect(req("chest-supported-row-db")).toEqual({ kind: "dumbbells" });
  });

  it("detects kettlebells in multiple slug shapes", () => {
    expect(req("kb-swing-russian")).toEqual({ kind: "kettlebells" });
    expect(req("farmer-carry-kb")).toEqual({ kind: "kettlebells" });
    expect(req("kettlebell-snatch")).toEqual({ kind: "kettlebells" });
  });

  it("detects barbell in slugs using the catalog's `-bb` / `bb-` convention", () => {
    // Catalog uses kebab-case slugs like `rdl-bb`, `bb-row-overhand`,
    // `split-squat-bb`, `bulgarian-split-squat-bb`. The canonical-lift
    // token check (back_squat / deadlift / ...) catches the textbook
    // names; this case covers the abbreviated suffix/prefix shape.
    expect(req("rdl-bb")).toEqual({ kind: "barbell" });
    expect(req("split-squat-bb")).toEqual({ kind: "barbell" });
    expect(req("bulgarian-split-squat-bb")).toEqual({ kind: "barbell" });
    expect(req("bb-row-overhand")).toEqual({ kind: "barbell" });
    expect(req("bb-curl")).toEqual({ kind: "barbell" });
    expect(req("seal-row-bb")).toEqual({ kind: "barbell" });
    expect(req("shrug-bb")).toEqual({ kind: "barbell" });
    expect(req("upright-row-bb")).toEqual({ kind: "barbell" });
    expect(req("wrist-curl-bb")).toEqual({ kind: "barbell" });
    expect(req("hip-thrust-bb")).toEqual({ kind: "barbell" });
    expect(req("glute-bridge-bb")).toEqual({ kind: "barbell" });
  });

  it("detects bands", () => {
    expect(req("band-pull-apart")).toEqual({ kind: "bands" });
    expect(req("pallof-press-band")).toEqual({ kind: "bands" });
  });

  it("detects weighted vest, sandbag, dip belt", () => {
    expect(req("weighted-vest-carry")).toEqual({ kind: "weighted_vest" });
    expect(req("vest-pushup")).toEqual({ kind: "weighted_vest" });
    expect(req("sandbag-clean")).toEqual({ kind: "sandbag" });
    expect(req("dip-belt-pull-up")).toEqual({ kind: "dip_belt" });
  });

  it("detects specialty bars", () => {
    expect(req("trap-bar-deadlift")).toEqual({ kind: "trap_bar" });
    expect(req("hex-bar-carry")).toEqual({ kind: "trap_bar" });
    expect(req("safety-squat-good-morning")).toEqual({ kind: "safety_squat_bar" });
    expect(req("ssb-squat")).toEqual({ kind: "safety_squat_bar" });
  });

  it("detects rings and pull-up bar", () => {
    expect(req("ring-dip")).toEqual({ kind: "rings" });
    expect(req("pull-up-overhand")).toEqual({ kind: "pull_up_bar" });
    expect(req("pullup-strict")).toEqual({ kind: "pull_up_bar" });
    expect(req("chin-up")).toEqual({ kind: "pull_up_bar" });
    expect(req("dip-parallel")).toEqual({ kind: "pull_up_bar" });
  });

  it("dip belt wins over dip_ pull-up bar match", () => {
    expect(req("dip-belt-weighted-pull-up")).toEqual({ kind: "dip_belt" });
  });

  it("defaults to barbell for canonical barbell lifts", () => {
    expect(req("back-squat-high-bar")).toEqual({ kind: "barbell" });
    expect(req("conventional-deadlift")).toEqual({ kind: "barbell" });
    expect(req("bench-press-flat")).toEqual({ kind: "barbell" });
    expect(req("overhead-press")).toEqual({ kind: "barbell" });
    expect(req("front-squat")).toEqual({ kind: "barbell" });
    expect(req("power-clean")).toEqual({ kind: "barbell" });
  });

  it("falls back to bodyweight_or_generic for unknown slugs", () => {
    expect(req("push-up")).toEqual({ kind: "bodyweight_or_generic" });
    expect(req("pallof-press")).toEqual({ kind: "bodyweight_or_generic" });
    expect(req("plank")).toEqual({ kind: "bodyweight_or_generic" });
    expect(req("dead-hang")).toEqual({ kind: "bodyweight_or_generic" });
  });
});

describe("isEquipmentAvailable — every requirement kind", () => {
  const commercial: Equipment = COMMERCIAL_GYM_PRESET;
  const home: Equipment = HOME_GYM_PRESET;
  const travel: Equipment = TRAVEL_HOTEL_PRESET;
  const empty: Equipment = CUSTOM_EMPTY_PRESET;

  it("bodyweight_or_generic — always true", () => {
    const r: EquipmentRequirement = { kind: "bodyweight_or_generic" };
    expect(isEquipmentAvailable(r, commercial)).toBe(true);
    expect(isEquipmentAvailable(r, empty)).toBe(true);
  });

  it("barbell — present in commercial/home, absent in travel (barbellKg=0)", () => {
    const r: EquipmentRequirement = { kind: "barbell" };
    expect(isEquipmentAvailable(r, commercial)).toBe(true);
    expect(isEquipmentAvailable(r, home)).toBe(true);
    expect(isEquipmentAvailable(r, travel)).toBe(false);
  });

  it("trap_bar — commercial only", () => {
    const r: EquipmentRequirement = { kind: "trap_bar" };
    expect(isEquipmentAvailable(r, commercial)).toBe(true);
    expect(isEquipmentAvailable(r, home)).toBe(false);
    expect(isEquipmentAvailable(r, travel)).toBe(false);
  });

  it("safety_squat_bar — commercial only", () => {
    const r: EquipmentRequirement = { kind: "safety_squat_bar" };
    expect(isEquipmentAvailable(r, commercial)).toBe(true);
    expect(isEquipmentAvailable(r, home)).toBe(false);
  });

  it("dumbbells — commercial/travel, NOT home (null) or empty", () => {
    const r: EquipmentRequirement = { kind: "dumbbells" };
    expect(isEquipmentAvailable(r, commercial)).toBe(true);
    expect(isEquipmentAvailable(r, travel)).toBe(true);
    expect(isEquipmentAvailable(r, home)).toBe(false);
    expect(isEquipmentAvailable(r, empty)).toBe(false);
  });

  it("kettlebells — commercial/home, NOT travel ([]) or empty", () => {
    const r: EquipmentRequirement = { kind: "kettlebells" };
    expect(isEquipmentAvailable(r, commercial)).toBe(true);
    expect(isEquipmentAvailable(r, home)).toBe(true);
    expect(isEquipmentAvailable(r, travel)).toBe(false);
    expect(isEquipmentAvailable(r, empty)).toBe(false);
  });

  it("machine + cable — commercial yes, travel only cable, home no", () => {
    const legPress: EquipmentRequirement = { kind: "machine", machine: "leg_press" };
    const cable: EquipmentRequirement = { kind: "cable" };
    expect(isEquipmentAvailable(legPress, commercial)).toBe(true);
    expect(isEquipmentAvailable(legPress, home)).toBe(false);
    expect(isEquipmentAvailable(legPress, travel)).toBe(false);
    expect(isEquipmentAvailable(cable, commercial)).toBe(true);
    expect(isEquipmentAvailable(cable, travel)).toBe(true);
    expect(isEquipmentAvailable(cable, home)).toBe(false);
  });

  it("bands — present in commercial/home/travel, absent in empty", () => {
    const r: EquipmentRequirement = { kind: "bands" };
    expect(isEquipmentAvailable(r, commercial)).toBe(true);
    expect(isEquipmentAvailable(r, home)).toBe(true);
    expect(isEquipmentAvailable(r, travel)).toBe(true);
    expect(isEquipmentAvailable(r, empty)).toBe(false);
  });

  it("weighted_vest — true when array length > 0, false when empty", () => {
    const r: EquipmentRequirement = { kind: "weighted_vest" };
    expect(isEquipmentAvailable(r, home)).toBe(true);
    expect(isEquipmentAvailable(r, commercial)).toBe(false);
    expect(isEquipmentAvailable(r, travel)).toBe(false);
    expect(isEquipmentAvailable(r, empty)).toBe(false);
    const withVest: Equipment = {
      ...empty,
      accessories: { ...empty.accessories, weightedVest: [9] },
    };
    expect(isEquipmentAvailable(r, withVest)).toBe(true);
  });

  it("sandbag — true when array length > 0, false when empty", () => {
    const r: EquipmentRequirement = { kind: "sandbag" };
    expect(isEquipmentAvailable(r, home)).toBe(true);
    expect(isEquipmentAvailable(r, commercial)).toBe(false);
    const withBag: Equipment = {
      ...empty,
      accessories: { ...empty.accessories, sandbag: [25] },
    };
    expect(isEquipmentAvailable(r, withBag)).toBe(true);
  });

  it("dip_belt — commercial + home, not travel/empty", () => {
    const r: EquipmentRequirement = { kind: "dip_belt" };
    expect(isEquipmentAvailable(r, commercial)).toBe(true);
    expect(isEquipmentAvailable(r, home)).toBe(true);
    expect(isEquipmentAvailable(r, travel)).toBe(false);
    expect(isEquipmentAvailable(r, empty)).toBe(false);
  });

  it("pull_up_bar — commercial + home, not travel/empty", () => {
    const r: EquipmentRequirement = { kind: "pull_up_bar" };
    expect(isEquipmentAvailable(r, commercial)).toBe(true);
    expect(isEquipmentAvailable(r, home)).toBe(true);
    expect(isEquipmentAvailable(r, travel)).toBe(false);
  });

  it("rings — none of the default presets", () => {
    const r: EquipmentRequirement = { kind: "rings" };
    expect(isEquipmentAvailable(r, commercial)).toBe(false);
    expect(isEquipmentAvailable(r, home)).toBe(false);
    expect(isEquipmentAvailable(r, travel)).toBe(false);
  });
});

describe("requirementFromEquipmentTag — DB equipment column mapping", () => {
  it("maps tracked machines to their MachineType", () => {
    expect(requirementFromEquipmentTag("machine-leg-press")).toEqual({ kind: "machine", machine: "leg_press" });
    expect(requirementFromEquipmentTag("machine-leg-curl-seated")).toEqual({ kind: "machine", machine: "leg_curl" });
    expect(requirementFromEquipmentTag("machine-leg-ext")).toEqual({ kind: "machine", machine: "leg_extension" });
    expect(requirementFromEquipmentTag("machine-hack")).toEqual({ kind: "machine", machine: "hack_squat" });
    expect(requirementFromEquipmentTag("machine-chest-press")).toEqual({ kind: "machine", machine: "chest_press" });
    expect(requirementFromEquipmentTag("smith")).toEqual({ kind: "machine", machine: "smith_machine" });
    expect(requirementFromEquipmentTag("machine-row")).toEqual({ kind: "machine", machine: "seated_row" });
  });

  it("maps unknown machine tags to the generic-machine requirement", () => {
    // The exact leak the user reported + its cousins.
    expect(requirementFromEquipmentTag("machine-reverse-pec")).toEqual({ kind: "machine_generic" });
    expect(requirementFromEquipmentTag("machine-pec-deck")).toEqual({ kind: "machine_generic" });
    expect(requirementFromEquipmentTag("machine-pendulum")).toEqual({ kind: "machine_generic" });
    expect(requirementFromEquipmentTag("machine-abduction")).toEqual({ kind: "machine_generic" });
    expect(requirementFromEquipmentTag("ghd-machine")).toEqual({ kind: "machine_generic" });
    expect(requirementFromEquipmentTag("machine")).toEqual({ kind: "machine_generic" });
  });

  it("maps cable tags to the cable requirement", () => {
    expect(requirementFromEquipmentTag("cable")).toEqual({ kind: "cable" });
    expect(requirementFromEquipmentTag("cable-rope")).toEqual({ kind: "cable" });
  });

  it("returns null for tags with a bodyweight/free alternative (stay broadly available)", () => {
    expect(requirementFromEquipmentTag("machine-or-bw")).toBeNull();
    expect(requirementFromEquipmentTag("bodyweight-or-machine")).toBeNull();
    expect(requirementFromEquipmentTag("bodyweight")).toBeNull();
  });

  it("returns null for non-machine implements (slug heuristic handles those)", () => {
    expect(requirementFromEquipmentTag("barbell")).toBeNull();
    expect(requirementFromEquipmentTag("dumbbells")).toBeNull();
    expect(requirementFromEquipmentTag("erg")).toBeNull();
    expect(requirementFromEquipmentTag(null)).toBeNull();
    expect(requirementFromEquipmentTag(undefined)).toBeNull();
  });
});

describe("resolveRequiredEquipment — DB tag precedence over slug", () => {
  it("uses the DB equipment tag when it implies a machine the slug misses", () => {
    // rear-delt-fly-machine would fall through to bodyweight_or_generic
    // on the slug heuristic alone; the DB tag pins it as machine-only.
    expect(
      resolveRequiredEquipment({ slug: "rear-delt-fly-machine", equipment: "machine-reverse-pec" }),
    ).toEqual({ kind: "machine_generic" });
  });

  it("falls back to slug inference when the DB tag is absent or non-machine", () => {
    expect(resolveRequiredEquipment({ slug: "lateral-raise-db" })).toEqual({ kind: "dumbbells" });
    expect(
      resolveRequiredEquipment({ slug: "lateral-raise-db", equipment: "dumbbells" }),
    ).toEqual({ kind: "dumbbells" });
  });
});

describe("isEquipmentAvailable — machine_generic", () => {
  it("is satisfied iff the user owns at least one machine", () => {
    const r: EquipmentRequirement = { kind: "machine_generic" };
    expect(isEquipmentAvailable(r, COMMERCIAL_GYM_PRESET)).toBe(true);
    expect(isEquipmentAvailable(r, HOME_GYM_PRESET)).toBe(false);
    // Travel/hotel ships a cable stack → owns a machine.
    expect(isEquipmentAvailable(r, TRAVEL_HOTEL_PRESET)).toBe(true);
    expect(isEquipmentAvailable(r, CUSTOM_EMPTY_PRESET)).toBe(false);
  });
});
