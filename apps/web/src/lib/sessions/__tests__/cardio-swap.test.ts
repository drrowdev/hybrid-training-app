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
    expect(classifyCardioKind({ modality: "swimming" })).toBe("cardio_z2");
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
