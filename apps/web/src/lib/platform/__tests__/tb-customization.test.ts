import { describe, expect, it } from "vitest";
import {
  DEFAULT_CUSTOM_TB_NAME,
  activationRehabAssignments,
  activationRehabProtocols,
  activationSessionConfigs,
  effectiveActivationRehabProtocolIds,
  hasAutoInjectedAccessories,
  isTbActivationCustomization,
  isTbActivationCustomizationV2,
  isTbActivationCustomizationV3,
  tbCustomizationSchema,
  userChosenAccessoryIds,
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

  it("carries the template slot a replacement stands in for", () => {
    const swapped = {
      ...base,
      sessionMovements: {
        "slot-1": [
          { movement: "squat", sourceMovement: "squat" },
          { movement: "push-press", sourceMovement: "overhead-press" },
        ],
        "slot-2": [{ movement: "bench" }],
      },
    };
    expect(tbCustomizationSchema.parse(swapped)).toEqual(swapped);
  });

  it("rejects two movements claiming the same slot", () => {
    expect(
      tbCustomizationSchema.safeParse({
        ...base,
        sessionMovements: {
          "slot-1": [
            { movement: "push-press", sourceMovement: "overhead-press" },
            { movement: "incline-bench", sourceMovement: "overhead-press" },
          ],
        },
      }).success,
    ).toBe(false);
  });

  it("rejects a custom movement claiming to be a template slot", () => {
    expect(
      tbCustomizationSchema.safeParse({
        ...base,
        sessionMovements: {
          "slot-1": [
            {
              movement: "squat",
              sourceMovement: "catalog:00000000-0000-4000-8000-000000000010",
            },
          ],
        },
      }).success,
    ).toBe(false);
  });

  it("carries an accessory the user added, which fills no slot", () => {
    const withAccessory = {
      ...base,
      sessionMovements: {
        "slot-1": [
          { movement: "squat", sourceMovement: "squat" },
          {
            movement: "catalog:00000000-0000-4000-8000-000000000010",
            movementId: "00000000-0000-4000-8000-000000000010",
            slug: "bb-curl",
            displayName: "Barbell Curl",
            role: "accessory" as const,
          },
        ],
      },
    };
    expect(tbCustomizationSchema.parse(withAccessory)).toEqual(withAccessory);
  });

  it("rejects an accessory that also claims a slot", () => {
    expect(
      tbCustomizationSchema.safeParse({
        ...base,
        sessionMovements: {
          "slot-1": [
            {
              movement: "push-press",
              sourceMovement: "overhead-press",
              role: "accessory",
            },
          ],
        },
      }).success,
    ).toBe(false);
  });

  it("accepts a movement-only overlay that does not rename the block", () => {
    const { displayName: _displayName, ...unnamed } = base;
    expect(tbCustomizationSchema.safeParse(unnamed).success).toBe(true);
  });

  describe("telling auto-injected accessory work from the user's own", () => {
  const CURL_ID = "00000000-0000-4000-8000-0000000000c1";
  const RAISE_ID = "00000000-0000-4000-8000-0000000000c2";
  const chosen = (movementId: string) =>
    tbCustomizationSchema.parse({
      ...base,
      sessionMovements: {
        "slot-1": [
          { movement: "squat", sourceMovement: "squat" },
          {
            movement: `catalog:${movementId}`,
            movementId,
            slug: "bb-curl",
            displayName: "Barbell Curl",
            role: "accessory" as const,
          },
        ],
      },
    });

  it("reads a block the user built by hand as carrying none", () => {
    // Both kinds materialise as `accessory`, so without excluding the user's own
    // picks a hand-built block re-enabled the retired auto-injector on edit.
    const ids = userChosenAccessoryIds(chosen(CURL_ID));
    expect(
      hasAutoInjectedAccessories(
        [
          { kind: "main", movementId: "squat-id" },
          { kind: "accessory", movementId: CURL_ID },
        ],
        ids,
      ),
    ).toBe(false);
  });

  it("still spots accessory work the user did not pick", () => {
    const ids = userChosenAccessoryIds(chosen(CURL_ID));
    expect(
      hasAutoInjectedAccessories(
        [
          { kind: "accessory", movementId: CURL_ID },
          { kind: "accessory", movementId: RAISE_ID },
        ],
        ids,
      ),
    ).toBe(true);
  });

  it("treats a block with no customization as auto-injected", () => {
    expect(userChosenAccessoryIds(undefined).size).toBe(0);
    expect(
      hasAutoInjectedAccessories([{ kind: "accessory", movementId: CURL_ID }], new Set()),
    ).toBe(true);
  });

  it("is false when the block has no accessory work at all", () => {
    expect(
      hasAutoInjectedAccessories([{ kind: "main" }, { kind: "back_off" }], new Set()),
    ).toBe(false);
  });
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
