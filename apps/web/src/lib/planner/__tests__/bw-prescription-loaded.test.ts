import { describe, expect, it } from "vitest";
import type { MovementNode, MovementFamily } from "@hta/db";
import { bwPrescription } from "../bw-prescription";
import type { Equipment } from "@/lib/settings/equipment-schema";

function makeNode(overrides: Partial<MovementNode> = {}): MovementNode {
  return {
    id: "00000000-0000-0000-0000-000000000000",
    family: "push_h",
    nodeKey: "push_up",
    displayName: "Push-up",
    prerequisites: [],
    externalLoadCapable: true,
    isometricCapable: false,
    unilateral: false,
    defaultTempoSeconds: 4,
    tutPerRepSeconds: 4,
    difficultyAnchor: 30,
    createdAt: new Date(),
    ...overrides,
  } as MovementNode;
}

const BASE_EQUIPMENT: Equipment = {
  preset: "bodyweight_only",
  bars: { barbellKg: 0, trapBarKg: null, safetyBarKg: null },
  plates: [],
  dumbbells: null,
  kettlebells: [],
  machines: [],
  cardio: [],
  accessories: {
    weightedVest: [],
    sandbag: [],
    dipBelt: false,
    dipBeltMaxKg: null,
    bands: false,
    bandStrength: null,
    ankleWeights: false,
    pullUpBar: true,
    rings: false,
  },
};

const HISTORY_OVER_COMPLETED = [
  { reps: 12, rir: 2, clean_form: true, prescribed_reps: 10 },
  { reps: 13, rir: 2, clean_form: true, prescribed_reps: 10 },
];

describe("bwPrescription · Phase 7 loaded extension", () => {
  it("emits no externalLoadKg/loadSource when equipment is omitted, but still bridges TM", () => {
    const out = bwPrescription({
      node: makeNode(),
      family: "push_h",
      archetype: "hypertrophy_anchor",
      bucket: "main",
      weekIndex: 1,
    });
    expect(out.externalLoadKg).toBeUndefined();
    expect(out.loadSource).toBeUndefined();
    // push_up has bwMultiplier=0.65 — bridge value is still emitted
    // for the stress engine (default body mass = 75 kg).
    expect(out.effectiveTrainingMaxKg).toBeCloseTo(48.75, 2);
    expect(out.reps).toBeDefined();
  });

  it("loadable push family + dip belt → loadSource = dip_belt", () => {
    const eq: Equipment = {
      ...BASE_EQUIPMENT,
      accessories: { ...BASE_EQUIPMENT.accessories, dipBelt: true },
    };
    const out = bwPrescription({
      node: makeNode(),
      family: "push_h",
      archetype: "hypertrophy_anchor",
      bucket: "main",
      weekIndex: 1,
      equipment: eq,
      userBodyweightKg: 80,
      cleanRepHistory: HISTORY_OVER_COMPLETED,
    });
    expect(out.loadSource).toBe("dip_belt");
    expect(out.externalLoadKg).toBeGreaterThan(0);
    expect(out.effectiveTrainingMaxKg).toBeGreaterThan(0);
  });

  it("loadable push family + vest (no belt) → loadSource = weighted_vest", () => {
    const eq: Equipment = {
      ...BASE_EQUIPMENT,
      accessories: {
        ...BASE_EQUIPMENT.accessories,
        weightedVest: [20],
      },
    };
    const out = bwPrescription({
      node: makeNode(),
      family: "push_h",
      archetype: "hypertrophy_anchor",
      bucket: "main",
      weekIndex: 1,
      equipment: eq,
      userBodyweightKg: 80,
      cleanRepHistory: HISTORY_OVER_COMPLETED,
    });
    expect(out.loadSource).toBe("weighted_vest");
    expect(out.externalLoadKg).toBeGreaterThan(0);
    expect(out.externalLoadKg).toBeLessThanOrEqual(20); // capped by vest max
  });

  it("single-leg squat + ankle weights (no vest) → loadSource = ankle_weights", () => {
    const eq: Equipment = {
      ...BASE_EQUIPMENT,
      accessories: {
        ...BASE_EQUIPMENT.accessories,
        ankleWeights: { kg: 5 },
      },
    };
    const out = bwPrescription({
      node: makeNode({
        family: "squat_unilateral",
        nodeKey: "bulgarian_split_squat",
        externalLoadCapable: true,
      }),
      family: "squat_unilateral",
      archetype: "hypertrophy_anchor",
      bucket: "main",
      weekIndex: 1,
      equipment: eq,
      userBodyweightKg: 80,
      cleanRepHistory: HISTORY_OVER_COMPLETED,
    });
    expect(out.loadSource).toBe("ankle_weights");
  });

  it("skill node (externalLoadCapable=false) is never loaded even with full kit", () => {
    const eq: Equipment = {
      ...BASE_EQUIPMENT,
      accessories: {
        ...BASE_EQUIPMENT.accessories,
        weightedVest: [20],
        dipBelt: true,
      },
    };
    const out = bwPrescription({
      node: makeNode({
        family: "planche",
        nodeKey: "planche_lean",
        externalLoadCapable: false,
        isometricCapable: true,
        difficultyAnchor: 60,
      }),
      family: "planche",
      archetype: "strength_anchor",
      bucket: "main",
      weekIndex: 1,
      equipment: eq,
      userBodyweightKg: 80,
    });
    expect(out.externalLoadKg).toBeUndefined();
    expect(out.loadSource).toBeUndefined();
  });

  it("band-assist on negative_pull_up emits negative externalLoadKg", () => {
    const eq: Equipment = {
      ...BASE_EQUIPMENT,
      accessories: {
        ...BASE_EQUIPMENT.accessories,
        bands: true,
        bandStrength: "medium",
      },
    };
    const out = bwPrescription({
      node: makeNode({
        family: "pull_v",
        nodeKey: "negative_pull_up",
        externalLoadCapable: false,
      }),
      family: "pull_v",
      archetype: "hypertrophy_anchor",
      bucket: "main",
      weekIndex: 1,
      equipment: eq,
      userBodyweightKg: 80,
    });
    expect(out.loadSource).toBe("band_assist");
    expect(out.externalLoadKg).toBe(-10);
    expect(out.notes).toMatch(/Band-assisted/);
  });

  it("readiness state: loadable node + vest but no over-completion → externalLoadKg = 0", () => {
    const eq: Equipment = {
      ...BASE_EQUIPMENT,
      accessories: {
        ...BASE_EQUIPMENT.accessories,
        weightedVest: [20],
      },
    };
    const out = bwPrescription({
      node: makeNode(),
      family: "push_h",
      archetype: "hypertrophy_anchor",
      bucket: "main",
      weekIndex: 1,
      equipment: eq,
      userBodyweightKg: 80,
      cleanRepHistory: [],
    });
    expect(out.loadSource).toBe("weighted_vest");
    expect(out.externalLoadKg).toBe(0);
  });

  it("no-equipment fallback on loadable node still emits effectiveTrainingMaxKg", () => {
    const out = bwPrescription({
      node: makeNode({ nodeKey: "pull_up", family: "pull_v" as MovementFamily }),
      family: "pull_v",
      archetype: "strength_anchor",
      bucket: "main",
      weekIndex: 0,
      userBodyweightKg: 80,
    });
    expect(out.externalLoadKg).toBeUndefined();
    expect(out.loadSource).toBeUndefined();
    expect(out.effectiveTrainingMaxKg).toBeCloseTo(80, 5);
  });
});
