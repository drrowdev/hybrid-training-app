import { describe, expect, it } from "vitest";
import {
  DEFAULT_CUSTOM_TB_NAME,
  activationRehabAssignments,
  activationRehabProtocols,
  activationSessionConfigs,
  effectiveActivationRehabProtocolIds,
  isTbActivationCustomization,
  isTbActivationCustomizationV2,
  isTbActivationCustomizationV3,
  tbCustomizationSchema,
} from "../tb-customization";

const base = {
  version: 1,
  displayName: DEFAULT_CUSTOM_TB_NAME,
  dayTypes: [
    "strength",
    "conditioning",
    "rehab",
    "strength",
    "rest",
    "rest",
    "rest",
  ],
  sessionMovements: {
    "slot-1": [{ movement: "squat" }],
    "slot-2": [{ movement: "bench" }],
  },
  rehab: {
    items: [
      {
        movementId: "00000000-0000-4000-8000-000000000001",
        movementName: "Knee extension",
        side: "left",
        sets: 3,
        reps: 12,
      },
    ],
  },
};

const activation = {
  version: 2,
  templateId: "activation",
  displayName: DEFAULT_CUSTOM_TB_NAME,
  phases: {
    base: {
      sessions: {
        "activation.base.base-1": {
          day: 0,
          enabled: true,
          movementOverrides: {
            "goblet-squat": null,
          },
        },
      },
      rehabDays: [6],
    },
    armor: { sessions: {}, rehabDays: [] },
    operator: { sessions: {}, rehabDays: [] },
    vertex: { sessions: {}, rehabDays: [] },
  },
  rehab: {
    items: [
      {
        movementId: "00000000-0000-4000-8000-000000000001",
        movementName: "Knee extension",
        sets: 3,
        reps: 12,
      },
    ],
  },
};

const activationV3 = {
  version: 3,
  templateId: "activation",
  displayName: DEFAULT_CUSTOM_TB_NAME,
  phases: {
    base: {
      sessions: activation.phases.base.sessions,
      rehabAssignments: [
        { day: 1, protocolId: "adductor" },
        { day: 6, protocolId: "trunk" },
      ],
    },
    armor: { sessions: {}, rehabAssignments: [] },
    operator: { sessions: {}, rehabAssignments: [] },
    vertex: { sessions: {}, rehabAssignments: [] },
  },
  rehabProtocols: [
    {
      id: "adductor",
      name: "Adductor",
      items: activation.rehab.items,
    },
    {
      id: "trunk",
      name: "Trunk",
      items: [
        {
          movementId: "00000000-0000-4000-8000-000000000002",
          movementName: "Dead bug",
          sets: 3,
          reps: 8,
        },
      ],
    },
  ],
};

describe("Tactical Barbell customization contract", () => {
  it("accepts a versioned weekly layout with structured rehab", () => {
    expect(tbCustomizationSchema.parse(base)).toEqual(base);
  });

  it("requires a rehab protocol when the week contains rehab", () => {
    expect(
      tbCustomizationSchema.safeParse({ ...base, rehab: undefined }).success,
    ).toBe(false);
  });

  it("rejects orphan-prone empty strength slots and unknown versions", () => {
    expect(
      tbCustomizationSchema.safeParse({
        ...base,
        sessionMovements: { "slot-1": [] },
      }).success,
    ).toBe(false);
    expect(tbCustomizationSchema.safeParse({ ...base, version: 4 }).success).toBe(false);
  });

  it("accepts Activation v3 with named protocols assigned independently by day", () => {
    const parsed = tbCustomizationSchema.parse(activationV3);
    expect(isTbActivationCustomizationV3(parsed)).toBe(true);
    expect(isTbActivationCustomization(parsed)).toBe(true);
    if (!isTbActivationCustomization(parsed)) return;
    expect(activationRehabProtocols(parsed).map((protocol) => protocol.name)).toEqual([
      "Adductor",
      "Trunk",
    ]);
    expect(activationRehabAssignments(parsed, "base")).toEqual([
      { day: 1, protocolId: "adductor" },
      { day: 6, protocolId: "trunk" },
    ]);
  });

  it("upgrades Activation v2 rehab days to one legacy protocol in memory", () => {
    const parsed = tbCustomizationSchema.parse(activation);
    expect(isTbActivationCustomization(parsed)).toBe(true);
    if (!isTbActivationCustomization(parsed)) return;
    expect(activationRehabProtocols(parsed)).toMatchObject([
      { id: "protocol-1", name: "Protocol 1" },
    ]);
    expect(activationRehabAssignments(parsed, "base")).toEqual([
      { day: 6, protocolId: "protocol-1" },
    ]);
  });

  it("rejects duplicate day assignments and references to missing protocols", () => {
    expect(
      tbCustomizationSchema.safeParse({
        ...activationV3,
        phases: {
          ...activationV3.phases,
          base: {
            ...activationV3.phases.base,
            rehabAssignments: [
              { day: 1, protocolId: "adductor" },
              { day: 1, protocolId: "trunk" },
            ],
          },
        },
      }).success,
    ).toBe(false);
    expect(
      tbCustomizationSchema.safeParse({
        ...activationV3,
        phases: {
          ...activationV3.phases,
          base: {
            ...activationV3.phases.base,
            rehabAssignments: [
              { day: 1, protocolId: "missing" },
            ],
          },
        },
      }).success,
    ).toBe(false);
  });

  it("excludes rehab protocols from phases skipped by the start point", () => {
    const customized = {
      ...activationV3,
      phases: {
        ...activationV3.phases,
        armor: {
          sessions: {},
          rehabAssignments: [{ day: 0, protocolId: "adductor" }],
        },
        operator: {
          sessions: {},
          rehabAssignments: [{ day: 0, protocolId: "trunk" }],
        },
      },
    };
    const parsed = tbCustomizationSchema.parse(customized);
    expect(isTbActivationCustomization(parsed)).toBe(true);
    if (!isTbActivationCustomization(parsed)) return;

    expect(
      [...effectiveActivationRehabProtocolIds(parsed, 8)],
    ).toEqual(["trunk"]);
  });

  it("accepts phase-aware Activation v2 and flattens its session configs", () => {
    const parsed = tbCustomizationSchema.parse(activation);
    expect(isTbActivationCustomizationV2(parsed)).toBe(true);
    if (!isTbActivationCustomizationV2(parsed)) return;
    expect(activationSessionConfigs(parsed)).toMatchObject({
      "activation.base.base-1": {
        day: 0,
        enabled: true,
        movementOverrides: { "goblet-squat": null },
      },
    });
  });

  it("requires a rehab protocol when any Activation phase has rehab days", () => {
    expect(
      tbCustomizationSchema.safeParse({
        ...activation,
        rehab: undefined,
      }).success,
    ).toBe(false);
  });

  it("requires authoritative metadata for catalog-backed exercises", () => {
    expect(
      tbCustomizationSchema.safeParse({
        ...activation,
        phases: {
          ...activation.phases,
          armor: {
            sessions: {
              "activation.armor.armor-a1": {
                day: 0,
                enabled: true,
                movementOverrides: {
                  squat: {
                    movement:
                      "catalog:00000000-0000-4000-8000-000000000010",
                    movementId:
                      "00000000-0000-4000-8000-000000000010",
                  },
                },
              },
            },
            rehabDays: [],
          },
        },
      }).success,
    ).toBe(false);
  });
});
