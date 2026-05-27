import { describe, it, expect } from "vitest";
import {
  classifyCardioKind,
  classifyCardioModality,
  filterCardioCandidates,
  movementMatchesEquipment,
  type CardioCandidate,
} from "../cardio-swap";
import { applyPrescriptionSwap } from "../prescription-mutations";
import type { Prescription } from "@hta/db";

const candidates: CardioCandidate[] = [
  // Cycling
  {
    id: "mov-bike-z2",
    slug: "bike-indoor-z2",
    display_name: "Indoor Bike — Z2",
    pattern: "cardio",
    equipment: "stationary-bike",
    metadata: { modality: "cycling", zone: "Z2" },
  },
  {
    id: "mov-bike-vo2",
    slug: "bike-indoor-vo2-4x4",
    display_name: "Indoor Bike — VO2 4×4",
    pattern: "cardio",
    equipment: "stationary-bike",
    metadata: { modality: "cycling", zone: "Z5", protocol: "4x4min-3min-recovery" },
  },
  {
    id: "mov-bike-outdoor",
    slug: "bike-outdoor-easy",
    display_name: "Outdoor Bike — Easy",
    pattern: "cardio",
    equipment: "road-bike",
    metadata: { modality: "cycling", zone: "Z1-Z2" },
  },
  // Running
  {
    id: "mov-run-z2",
    slug: "run-easy-z2",
    display_name: "Easy Run — Z2",
    pattern: "cardio",
    equipment: "shoes",
    metadata: { modality: "running", zone: "Z2" },
  },
  {
    id: "mov-run-vo2",
    slug: "run-vo2-4x4",
    display_name: "VO2 Intervals — 4×4",
    pattern: "cardio",
    equipment: "shoes",
    metadata: { modality: "running", zone: "Z5", protocol: "4x4min" },
  },
  // Rowing
  {
    id: "mov-row-z2",
    slug: "erg-z2",
    display_name: "Erg Row — Z2",
    pattern: "cardio",
    equipment: "erg",
    metadata: { modality: "rowing", zone: "Z2" },
  },
  // Other
  {
    id: "mov-swim",
    slug: "swim-easy",
    display_name: "Swim — Easy Lap",
    pattern: "cardio",
    equipment: "pool",
    metadata: { modality: "swimming", zone: "Z2" },
  },
];

describe("classifyCardioKind", () => {
  it("maps zone + protocol metadata to the right kind", () => {
    expect(classifyCardioKind({ zone: "Z2" })).toBe("cardio_z2");
    expect(classifyCardioKind({ zone: "Z1-Z2" })).toBe("cardio_z2");
    expect(classifyCardioKind({ zone: "Z1" })).toBe("cardio_z2");
    expect(classifyCardioKind({ zone: "Z4" })).toBe("cardio_threshold");
    expect(classifyCardioKind({ zone: "Z5", protocol: "4x4min" })).toBe(
      "cardio_vo2",
    );
    expect(classifyCardioKind({ emphasis: "alactic-power" })).toBe(
      "cardio_alactic",
    );
    expect(classifyCardioKind({ protocol: "alactic-30s-on-90s-off" })).toBe(
      "cardio_alactic",
    );
    // Z2-equivalent and conversational tags map to cardio_z2.
    expect(classifyCardioKind({ emphasis: "Z2-equivalent" })).toBe("cardio_z2");
    expect(
      classifyCardioKind({ emphasis: "long-easy conversational" }),
    ).toBe("cardio_z2");
  });

  it("explicit metadata.kind wins over inferred markers", () => {
    expect(classifyCardioKind({ kind: "cardio_alactic", zone: "Z2" })).toBe(
      "cardio_alactic",
    );
    expect(classifyCardioKind({ kind: "cardio_other", zone: "Z2" })).toBe(
      "cardio_other",
    );
  });

  it("classifies max-effort and 500m intervals as VO2", () => {
    // Erg Row — 500m Intervals seed (protocol "6-10x500m") should be VO2.
    expect(classifyCardioKind({ protocol: "6-10x500m" })).toBe("cardio_vo2");
    // Erg Row — 2k Time Trial seed (emphasis "max-effort-test") should be VO2.
    expect(classifyCardioKind({ emphasis: "max-effort-test" })).toBe(
      "cardio_vo2",
    );
  });

  it("unmarked movements fall into cardio_other, not cardio_z2", () => {
    // The bug: pre-fix, every cardio movement without explicit zone /
    // protocol markers defaulted to cardio_z2 and polluted the Z2 swap
    // picker (sled drags, rucking, MTB, spin class, ...). Now they
    // land in cardio_other and are excluded from swap.
    expect(classifyCardioKind({})).toBe("cardio_other");
    expect(classifyCardioKind({ modality: "swimming" })).toBe("cardio_other");
    expect(
      classifyCardioKind({ modality: "sled", emphasis: "VMO-knee-rehab" }),
    ).toBe("cardio_other");
    expect(
      classifyCardioKind({ modality: "rucking", terrain: "hill" }),
    ).toBe("cardio_other");
    expect(classifyCardioKind({ modality: "cycling", terrain: "trail" })).toBe(
      "cardio_other",
    );
  });
});

describe("classifyCardioModality", () => {
  it("buckets movements into running / cycling / rowing / other", () => {
    expect(classifyCardioModality({ modality: "running" })).toBe("running");
    expect(classifyCardioModality({ modality: "cycling" })).toBe("cycling");
    expect(classifyCardioModality({ modality: "rowing" })).toBe("rowing");
    expect(classifyCardioModality({ modality: "swimming" })).toBe("other");
    expect(classifyCardioModality(undefined)).toBe("other");
  });
});

describe("filterCardioCandidates — kind filter", () => {
  it("Z2 → only Z2 movements appear (no VO2 leakage)", () => {
    const groups = filterCardioCandidates(candidates, {
      targetKind: "cardio_z2",
      ownedCardio: [],
    });
    const slugs = groups.flatMap((g) => g.movements.map((m) => m.slug));
    expect(slugs).toContain("bike-indoor-z2");
    expect(slugs).toContain("run-easy-z2");
    expect(slugs).toContain("erg-z2");
    expect(slugs).toContain("bike-outdoor-easy");
    expect(slugs).not.toContain("bike-indoor-vo2-4x4");
    expect(slugs).not.toContain("run-vo2-4x4");
  });

  it("Z2 picker excludes unclassified ('cardio_other') movements", () => {
    // Regression for the bug where Backwards Sled Drag and Hill Rucking
    // showed up under the Z2 swap picker because the classifier
    // defaulted unmarked movements to cardio_z2.
    const polluted: CardioCandidate[] = [
      ...candidates,
      {
        id: "mov-sled-drag-back",
        slug: "sled-drag-backwards",
        display_name: "Backwards Sled Drag",
        pattern: "cardio",
        equipment: "sled",
        metadata: { modality: "sled", emphasis: "VMO-knee-rehab" },
      },
      {
        id: "mov-ruck-hill",
        slug: "ruck-hill",
        display_name: "Hill Rucking",
        pattern: "cardio",
        equipment: "rucksack-outdoor",
        metadata: { modality: "rucking", terrain: "hill" },
      },
      {
        id: "mov-bike-mtb",
        slug: "bike-mtb",
        display_name: "Mountain Bike",
        pattern: "cardio",
        equipment: "mountain-bike",
        metadata: { modality: "cycling", terrain: "trail" },
      },
    ];
    const groups = filterCardioCandidates(polluted, {
      targetKind: "cardio_z2",
      ownedCardio: [],
    });
    const slugs = groups.flatMap((g) => g.movements.map((m) => m.slug));
    expect(slugs).not.toContain("sled-drag-backwards");
    expect(slugs).not.toContain("ruck-hill");
    expect(slugs).not.toContain("bike-mtb");
    // Real Z2 options still survive.
    expect(slugs).toContain("bike-indoor-z2");
    expect(slugs).toContain("run-easy-z2");
  });

  it("VO2 → only VO2 movements appear (no Z2 leakage)", () => {
    const groups = filterCardioCandidates(candidates, {
      targetKind: "cardio_vo2",
      ownedCardio: [],
    });
    const slugs = groups.flatMap((g) => g.movements.map((m) => m.slug));
    expect(slugs).toEqual(
      expect.arrayContaining(["bike-indoor-vo2-4x4", "run-vo2-4x4"]),
    );
    expect(slugs).not.toContain("bike-indoor-z2");
    expect(slugs).not.toContain("run-easy-z2");
  });

  it("excludes the original movement id", () => {
    const groups = filterCardioCandidates(candidates, {
      targetKind: "cardio_z2",
      ownedCardio: [],
      excludeMovementId: "mov-bike-z2",
    });
    const slugs = groups.flatMap((g) => g.movements.map((m) => m.slug));
    expect(slugs).not.toContain("bike-indoor-z2");
  });

  it("groups output by modality in stable order", () => {
    const groups = filterCardioCandidates(candidates, {
      targetKind: "cardio_z2",
      ownedCardio: [],
    });
    expect(groups.map((g) => g.modality)).toEqual([
      "running",
      "cycling",
      "rowing",
      "other",
    ]);
  });
});

describe("filterCardioCandidates — equipment filter", () => {
  it("no rower owned → no row options", () => {
    const groups = filterCardioCandidates(candidates, {
      targetKind: "cardio_z2",
      ownedCardio: ["treadmill", "bike_air"], // no rower
    });
    const slugs = groups.flatMap((g) => g.movements.map((m) => m.slug));
    expect(slugs).not.toContain("erg-z2");
    // Indoor bike + outdoor + running still allowed.
    expect(slugs).toContain("bike-indoor-z2");
    expect(slugs).toContain("run-easy-z2");
  });

  it("empty owned list → show everything (running always wins)", () => {
    const groups = filterCardioCandidates(candidates, {
      targetKind: "cardio_z2",
      ownedCardio: [],
    });
    const slugs = groups.flatMap((g) => g.movements.map((m) => m.slug));
    expect(slugs).toContain("erg-z2");
    expect(slugs).toContain("bike-indoor-z2");
    expect(slugs).toContain("run-easy-z2");
  });

  it("movementMatchesEquipment: stationary-bike requires any bike machine", () => {
    expect(movementMatchesEquipment("stationary-bike", ["bike_recumbent"])).toBe(
      true,
    );
    expect(movementMatchesEquipment("stationary-bike", ["treadmill"])).toBe(
      false,
    );
    expect(movementMatchesEquipment("road-bike", ["treadmill"])).toBe(true);
    expect(movementMatchesEquipment("erg", ["rower"])).toBe(true);
    expect(movementMatchesEquipment("erg", ["treadmill"])).toBe(false);
  });
});

describe("applyPrescriptionSwap — cardio item", () => {
  it("swaps a cardio item and records swappedFrom on meta", () => {
    const presc: Prescription = {
      items: [
        {
          movementId: "mov-bike-z2",
          movementSlug: "bike-indoor-z2",
          movementName: "Indoor Bike — Z2",
          kind: "cardio_z2",
          durationMin: 45,
          hrCap: "≤ 70% HRR, conversational",
          intensityLabel: "Easy Z2",
        },
      ],
    };
    const next = applyPrescriptionSwap(presc, {
      itemIndex: 0,
      newMovement: {
        id: "mov-run-z2",
        slug: "run-easy-z2",
        displayName: "Easy Run — Z2",
      },
      swappedAt: "2026-06-01T10:00:00.000Z",
    });
    const item = next.items[0]!;
    expect(item.movementSlug).toBe("run-easy-z2");
    expect(item.movementName).toBe("Easy Run — Z2");
    // Cardio fields preserved.
    expect(item.kind).toBe("cardio_z2");
    expect(item.durationMin).toBe(45);
    expect(item.hrCap).toBe("≤ 70% HRR, conversational");
    // Audit trail.
    const meta = item.meta as Record<string, unknown>;
    expect(meta.swappedFrom).toEqual({
      movementId: "mov-bike-z2",
      movementName: "Indoor Bike — Z2",
    });
    expect(meta.swappedAt).toBe("2026-06-01T10:00:00.000Z");
  });
});
