import { describe, it, expect } from "vitest";

import { buildCardioCatalog } from "../cardio-catalog";

describe("buildCardioCatalog", () => {
  it("classifies modality (normalized) + cardioKind from seed metadata", () => {
    const out = buildCardioCatalog([
      {
        id: "m1",
        slug: "bike-indoor-z2",
        display_name: "Indoor Bike — Z2",
        equipment: "stationary-bike",
        experience_min: null,
        metadata: { modality: "cycling", zone: "Z2" },
      },
      {
        id: "m2",
        slug: "ski-erg-intervals",
        display_name: "Ski Erg Intervals",
        equipment: "ski-erg",
        experience_min: 2,
        // hyphenated seed modality must normalize to ski_erg
        metadata: { modality: "ski-erg", protocol: "4x4" },
      },
      {
        id: "m3",
        slug: "jump-rope-mix",
        display_name: "Jump Rope",
        equipment: null,
        experience_min: null,
        // un-substitutable modality → null; no zone markers → cardio_other
        metadata: { modality: "jump-rope" },
      },
    ]);

    expect(out[0]).toEqual({
      id: "m1",
      slug: "bike-indoor-z2",
      displayName: "Indoor Bike — Z2",
      modality: "cycling",
      cardioKind: "cardio_z2",
      equipment: "stationary-bike",
      experienceMin: null,
    });
    expect(out[1]!.modality).toBe("ski_erg");
    expect(out[1]!.cardioKind).toBe("cardio_vo2");
    expect(out[2]!.modality).toBeNull();
    expect(out[2]!.cardioKind).toBe("cardio_other");
  });

  it("tolerates null metadata", () => {
    const out = buildCardioCatalog([
      {
        id: "m4",
        slug: "run-easy",
        display_name: "Easy Run",
        equipment: "shoes",
        experience_min: null,
        metadata: null,
      },
    ]);
    expect(out[0]!.modality).toBeNull();
    expect(out[0]!.cardioKind).toBe("cardio_other");
  });
});
