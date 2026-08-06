import { describe, expect, it } from "vitest";
import {
  DEFAULT_CUSTOM_TB_NAME,
  activationSessionConfigs,
  isTbActivationCustomizationV2,
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
    expect(tbCustomizationSchema.safeParse({ ...base, version: 3 }).success).toBe(false);
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
});
