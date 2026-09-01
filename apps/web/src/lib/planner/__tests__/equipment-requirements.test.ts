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
import { SEED_MOVEMENTS } from "../../../../../../packages/db/seeds/movements";

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

  it("any_of accepts either implement and all_of requires every implement", () => {
    const either: EquipmentRequirement = {
      kind: "any_of",
      requirements: [{ kind: "pull_up_bar" }, { kind: "rings" }],
    };
    const both: EquipmentRequirement = {
      kind: "all_of",
      requirements: [{ kind: "pull_up_bar" }, { kind: "dip_belt" }],
    };
    expect(isEquipmentAvailable(either, home)).toBe(true);
    expect(
      isEquipmentAvailable(either, {
        ...empty,
        accessories: { ...empty.accessories, rings: true },
      }),
    ).toBe(true);
    expect(isEquipmentAvailable(either, empty)).toBe(false);
    expect(isEquipmentAvailable(both, home)).toBe(true);
    expect(
      isEquipmentAvailable(both, {
        ...home,
        accessories: { ...home.accessories, dipBelt: false },
      }),
    ).toBe(false);
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

  it("believes a bodyweight/free-alternative tag rather than deferring to the slug", () => {
    // These used to return null ("no opinion"), which let a slug substring
    // contradict the tag — see the resolver tests below.
    expect(requirementFromEquipmentTag("machine-or-bw")).toEqual({
      kind: "bodyweight_or_generic",
    });
    expect(requirementFromEquipmentTag("bodyweight-or-machine")).toEqual({
      kind: "bodyweight_or_generic",
    });
    expect(requirementFromEquipmentTag("bodyweight")).toEqual({
      kind: "bodyweight_or_generic",
    });
    expect(requirementFromEquipmentTag("dumbbell-or-bw")).toEqual({
      kind: "bodyweight_or_generic",
    });
  });

  it("maps free-weight & specialty-bar tags to a hard requirement (DB tag is authoritative)", () => {
    expect(requirementFromEquipmentTag("barbell")).toEqual({ kind: "barbell" });
    expect(requirementFromEquipmentTag("barbell-bench")).toEqual({ kind: "barbell" });
    expect(requirementFromEquipmentTag("dumbbells")).toEqual({ kind: "dumbbells" });
    expect(requirementFromEquipmentTag("dumbbells-incline-bench")).toEqual({ kind: "dumbbells" });
    expect(requirementFromEquipmentTag("kettlebell")).toEqual({ kind: "kettlebells" });
    expect(requirementFromEquipmentTag("trap-bar")).toEqual({ kind: "trap_bar" });
    expect(requirementFromEquipmentTag("preacher-ez")).toEqual({ kind: "barbell" });
    expect(requirementFromEquipmentTag("band-anchor")).toEqual({ kind: "bands" });
    expect(requirementFromEquipmentTag("dumbbell-or-kb")).toEqual({
      kind: "any_of",
      requirements: [{ kind: "dumbbells" }, { kind: "kettlebells" }],
    });
  });

  it("maps gymnastic hardware without falling back to the movement slug", () => {
    expect(requirementFromEquipmentTag("bar")).toEqual({
      kind: "pull_up_bar",
    });
    expect(requirementFromEquipmentTag("rings")).toEqual({ kind: "rings" });
    expect(requirementFromEquipmentTag("bar-or-rings")).toEqual({
      kind: "any_of",
      requirements: [{ kind: "pull_up_bar" }, { kind: "rings" }],
    });
    expect(requirementFromEquipmentTag("bar-belt")).toEqual({
      kind: "all_of",
      requirements: [{ kind: "pull_up_bar" }, { kind: "dip_belt" }],
    });
  });

  it("returns null for untracked implements and missing tags", () => {
    expect(requirementFromEquipmentTag("plate")).toBeNull();
    expect(requirementFromEquipmentTag("gripper")).toBeNull();
    expect(requirementFromEquipmentTag("erg")).toBeNull();
    expect(requirementFromEquipmentTag(null)).toBeNull();
    expect(requirementFromEquipmentTag(undefined)).toBeNull();
  });

  describe("requirementFromEquipmentTag — complete seed catalog", () => {
    it("pins the resolution of every equipment tag in the catalog", () => {
      const tags = Array.from(
        new Set(
          SEED_MOVEMENTS.map((movement) => movement.equipment).filter(
            (tag): tag is string => tag != null,
          ),
        ),
      ).sort();
      const resolutions = Object.fromEntries(
        tags.map((tag) => [tag, requirementFromEquipmentTag(tag)]),
      );

      expect(resolutions).toMatchSnapshot();
    });
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

  it("uses the DB equipment tag when the slug hides the implement (leak fix)", () => {
    // `hammer-curl` names no implement, so the slug heuristic returned
    // bodyweight_or_generic and offered it to bodyweight-only users. The
    // `dumbbells` tag now pins it correctly.
    expect(resolveRequiredEquipment({ slug: "hammer-curl" })).toEqual({ kind: "bodyweight_or_generic" });
    expect(
      resolveRequiredEquipment({ slug: "hammer-curl", equipment: "dumbbells" }),
    ).toEqual({ kind: "dumbbells" });
  });

  it("falls back to slug inference when the DB tag is absent", () => {
    expect(resolveRequiredEquipment({ slug: "lateral-raise-db" })).toEqual({ kind: "dumbbells" });
    expect(
      resolveRequiredEquipment({ slug: "lateral-raise-db", equipment: "dumbbells" }),
    ).toEqual({ kind: "dumbbells" });
  });

  it("never lets a bodyweight tag be overruled into needing a machine", () => {
    // `sliding-leg-curl` normalises to `sliding_leg_curl`, which hits the
    // `leg_curl` branch of the slug heuristic and demanded a leg-curl MACHINE —
    // hiding a movement whose whole point is needing no machine from every user
    // without one. No equipment tag could rescue it, because the bodyweight
    // escape hatch returns null and the slug then decides.
    expect(inferRequiredEquipment({ slug: "sliding-leg-curl" })).toEqual({
      kind: "machine",
      machine: "leg_curl",
    });
    expect(
      resolveRequiredEquipment({ slug: "sliding-leg-curl", equipment: "bodyweight" }),
    ).toEqual({ kind: "bodyweight_or_generic" });
    // Same contradiction, any facility: a cable/machine-generic inference loses
    // to an explicit bodyweight tag too.
    expect(
      resolveRequiredEquipment({ slug: "cable-pull-through", equipment: "bodyweight-or-band" }),
    ).toEqual({ kind: "bodyweight_or_generic" });
  });

  it("keeps every available implement on an either/or tag", () => {
    // ADR 0034 added `hsr-calf-raise-db` ("HSR Calf Raise — DB/BW") so the
    // Achilles HSR guarantee could be met machine-free. Its `_db` suffix made
    // the slug heuristic demand dumbbells, which left an equipment-poor lifter
    // with NO available `hsr` source in the calf region — every other one needs
    // a machine. The tag is now believed.
    expect(
      resolveRequiredEquipment({ slug: "hsr-calf-raise-db", equipment: "dumbbell-or-bw" }),
    ).toEqual({ kind: "bodyweight_or_generic" });
    // The tag is what carries it — the slug alone still reads as dumbbells.
    expect(inferRequiredEquipment({ slug: "hsr-calf-raise-db" })).toEqual({
      kind: "dumbbells",
    });
    expect(
      resolveRequiredEquipment({ slug: "single-leg-rdl", equipment: "dumbbell-or-kb" }),
    ).toEqual({
      kind: "any_of",
      requirements: [{ kind: "dumbbells" }, { kind: "kettlebells" }],
    });
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
