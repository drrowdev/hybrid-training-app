import { describe, it, expect } from "vitest";
import {
  applyPrescriptionSwap,
  isSwapped,
  originalMovementName,
  removeMovementFromPrescription,
  swapCarriesAbsoluteLoad,
  swapMovementInPrescription,
  addMovementToPrescription,
  hasUserEditedPrescription,
} from "../prescription-mutations";
import type { Prescription } from "@hta/db";
import type { WarmupScheme } from "@/lib/planner/warmups";

const base: Prescription = {
  items: [
    {
      movementId: "mov-bench",
      movementSlug: "bench-press-flat",
      movementName: "Bench Press (flat)",
      kind: "main",
      sets: 3,
      reps: 5,
      percentTm: 80,
    },
    {
      movementId: "mov-squat",
      movementSlug: "back-squat-high-bar",
      movementName: "Back Squat (high-bar)",
      kind: "main",
      sets: 3,
      reps: 5,
      percentTm: 80,
    },
  ],
};

describe("applyPrescriptionSwap — Phase 2 A2", () => {
  it("swaps the target item and leaves the others untouched", () => {
    const next = applyPrescriptionSwap(base, {
      itemIndex: 0,
      newMovement: {
        id: "mov-floor",
        slug: "floor-press",
        displayName: "Floor Press",
      },
      swappedAt: "2026-05-23T12:00:00.000Z",
    });
    expect(next.items[0]!.movementId).toBe("mov-floor");
    expect(next.items[0]!.movementSlug).toBe("floor-press");
    expect(next.items[0]!.movementName).toBe("Floor Press");
    // Untouched item still squat.
    expect(next.items[1]!.movementId).toBe("mov-squat");
    // Reps/sets/percentTm preserved on the swapped item.
    expect(next.items[0]!.sets).toBe(3);
    expect(next.items[0]!.reps).toBe(5);
    expect(next.items[0]!.percentTm).toBe(80);
    expect(next.userEdited).toBe(true);
  });

  it("records the original movement under meta.swappedFrom", () => {
    const next = applyPrescriptionSwap(base, {
      itemIndex: 0,
      newMovement: { id: "mov-floor", slug: "floor-press", displayName: "Floor Press" },
      swappedAt: "2026-05-23T12:00:00.000Z",
    });
    const meta = next.items[0]!.meta as Record<string, unknown>;
    expect(meta.swappedFrom).toEqual({
      movementId: "mov-bench",
      movementName: "Bench Press (flat)",
    });
    expect(meta.swappedAt).toBe("2026-05-23T12:00:00.000Z");
  });

  it("chaining swaps preserves the original-original under swappedFrom", () => {
    const once = applyPrescriptionSwap(base, {
      itemIndex: 0,
      newMovement: { id: "mov-floor", slug: "floor-press", displayName: "Floor Press" },
      swappedAt: "2026-05-23T12:00:00.000Z",
    });
    const twice = applyPrescriptionSwap(once, {
      itemIndex: 0,
      newMovement: { id: "mov-cgbp", slug: "close-grip-bench", displayName: "Close-grip Bench" },
      swappedAt: "2026-05-23T12:05:00.000Z",
    });
    const meta = twice.items[0]!.meta as Record<string, unknown>;
    // Origin stays the original bench, not the intermediate floor press.
    expect(meta.swappedFrom).toEqual({
      movementId: "mov-bench",
      movementName: "Bench Press (flat)",
    });
    expect(meta.swappedAt).toBe("2026-05-23T12:05:00.000Z");
    expect(twice.items[0]!.movementId).toBe("mov-cgbp");
  });

  it("does not mutate the input prescription (immutability invariant)", () => {
    const next = applyPrescriptionSwap(base, {
      itemIndex: 0,
      newMovement: { id: "mov-floor", slug: "floor-press", displayName: "Floor Press" },
    });
    expect(base.items[0]!.movementId).toBe("mov-bench");
    expect(next).not.toBe(base);
    expect(next.items).not.toBe(base.items);
  });

  it("throws RangeError on out-of-range index", () => {
    expect(() =>
      applyPrescriptionSwap(base, {
        itemIndex: 5,
        newMovement: { id: "x", slug: "x", displayName: "X" },
      }),
    ).toThrow(RangeError);
  });

  it("isSwapped + originalMovementName helpers", () => {
    expect(isSwapped(base.items[0]!)).toBe(false);
    expect(originalMovementName(base.items[0]!)).toBeNull();

    const next = applyPrescriptionSwap(base, {
      itemIndex: 0,
      newMovement: { id: "mov-floor", slug: "floor-press", displayName: "Floor Press" },
    });
    expect(isSwapped(next.items[0]!)).toBe(true);
    expect(originalMovementName(next.items[0]!)).toBe("Bench Press (flat)");
  });
});

describe("removeMovementFromPrescription", () => {
  it("drops every item of the movement, keeps the rest", () => {
    const next = removeMovementFromPrescription(base, "mov-bench");
    expect(next.items).toHaveLength(1);
    expect(next.items[0]!.movementId).toBe("mov-squat");
    expect(next.userEdited).toBe(true);
  });
  it("is a no-op when the movement is absent", () => {
    const next = removeMovementFromPrescription(base, "mov-nope");
    expect(next.items).toHaveLength(2);
    expect(next).toBe(base);
    expect(next.userEdited).toBeUndefined();
  });

  it("can remove rehab without removing core work for the same movement", () => {
    const combined: Prescription = {
      items: [
        {
          ...base.items[0]!,
          kind: "tendon",
          meta: {
            rehab: true,
            rehabSourceRef: "rehab-achilles",
          },
        },
        base.items[0]!,
      ],
      meta: {
        embeddedRehabSections: [
          {
            protocolId: "achilles",
            protocolName: "Achilles",
            sourceRef: "rehab-achilles",
            placement: "during_warmup",
            itemCount: 1,
            movementCount: 1,
          },
        ],
      },
    };

    const next = removeMovementFromPrescription(combined, "mov-bench", {
      rehab: true,
    });

    expect(next.items).toEqual([base.items[0]]);
    expect(next.meta?.embeddedRehabSections).toBeUndefined();
    expect(next.meta?.removedEmbeddedRehabSourceRefs).toEqual([
      "rehab-achilles",
    ]);
  });
});

describe("swapMovementInPrescription", () => {
  const scheme3: WarmupScheme = {
    setCount: 3,
    percentLadder: [40, 60, 80],
    repLadder: [5, 5, 3],
  };

  it("requires the caller's warm-up scheme (no silent retarget-only path)", () => {
    expect(() =>
      swapMovementInPrescription(base, "mov-bench", {
        id: "mov-floor",
        slug: "floor-press",
        displayName: "Floor Press",
      }),
    ).toThrow(TypeError);
    expect(() =>
      swapMovementInPrescription(
        base,
        "mov-bench",
        { id: "mov-floor", slug: "floor-press", displayName: "Floor Press" },
        undefined,
        { rehab: false },
        { replacementHasTrainingMax: true },
      ),
    ).toThrow(/warmupScheme is required/);
  });

  it("retargets all items of the movement and records lineage", () => {
    const multi: Prescription = {
      items: [
        { movementId: "mov-bench", movementSlug: "bench", movementName: "Bench", kind: "warmup", sets: 1, reps: 5 },
        { movementId: "mov-bench", movementSlug: "bench", movementName: "Bench", kind: "main", sets: 3, reps: 5 },
        { movementId: "mov-squat", movementSlug: "squat", movementName: "Squat", kind: "main", sets: 3, reps: 5 },
      ],
    };
    const next = swapMovementInPrescription(
      multi,
      "mov-bench",
      { id: "mov-floor", slug: "floor-press", displayName: "Floor Press" },
      "2026-05-23T12:00:00.000Z",
      undefined,
      { warmupScheme: scheme3, replacementHasTrainingMax: true },
    );
    expect(next.items[0]!.movementId).toBe("mov-floor");
    expect(next.items[1]!.movementId).toBe("mov-floor");
    expect(next.items[next.items.length - 1]!.movementId).toBe("mov-squat");
    const meta = next.items.find((item) => item.kind === "main")!
      .meta as Record<string, unknown>;
    expect(meta.swappedFrom).toEqual({ movementId: "mov-bench", movementName: "Bench" });
    expect(next.userEdited).toBe(true);
  });

  it("can swap core work without retargeting rehab for the same movement", () => {
    const combined: Prescription = {
      items: [
        {
          ...base.items[0]!,
          kind: "tendon",
          meta: { rehab: true },
        },
        base.items[0]!,
      ],
    };
    const next = swapMovementInPrescription(
      combined,
      "mov-bench",
      {
        id: "mov-floor",
        slug: "floor-press",
        displayName: "Floor Press",
      },
      "2026-05-23T12:00:00.000Z",
      { rehab: false },
      { warmupScheme: scheme3, replacementHasTrainingMax: true },
    );

    expect(next.items[0]!.movementId).toBe("mov-bench");
    expect(next.items.some((item) => item.movementId === "mov-floor")).toBe(true);
  });

  it("DC-K4 preserves deadlift → barbell hip thrust working-set count while rebuilding the user's warmup count", () => {
    const scheme: WarmupScheme = {
      setCount: 2,
      percentLadder: [50, 75],
      repLadder: [5, 3],
    };
    const deadlift: Prescription = {
      items: [
        // The persisted prescription is intentionally stale (one warm-up)
        // while the user's current scheme asks for two; the old retarget-only
        // swap left this mismatch in place.
        {
          movementId: "deadlift",
          movementSlug: "deadlift",
          movementName: "Deadlift",
          kind: "warmup",
          sets: 1,
          reps: 5,
          percentTm: 34,
        },
        ...Array.from({ length: 4 }, (_, i) => ({
          movementId: "deadlift",
          movementSlug: "deadlift",
          movementName: "Deadlift",
          kind: "main" as const,
          sets: [2, 1, 3, 1][i],
          reps: i === 3 ? 1 : 5,
          percentTm: [65, 75, 85, 90][i],
        })),
      ],
    };
    const workingSetShapeIn = deadlift.items
      .filter((item) => item.kind !== "warmup")
      .map((item) => item.sets ?? 1);
    const next = swapMovementInPrescription(
      deadlift,
      "deadlift",
      {
        id: "barbell-hip-thrust",
        slug: "barbell-hip-thrust",
        displayName: "Barbell Hip Thrust",
      },
      "2026-05-23T12:00:00.000Z",
      { rehab: false },
      { warmupScheme: scheme, replacementHasTrainingMax: true },
    );
    const workingSetShapeOut = next.items
      .filter((item) => item.movementId === "barbell-hip-thrust" && item.kind !== "warmup")
      .map((item) => item.sets ?? 1);

    // DC-K4: a movement override must not silently change the prescribed dose.
    expect(workingSetShapeOut).toEqual(workingSetShapeIn);
    expect(
      next.items.filter(
        (item) =>
          item.movementId === "barbell-hip-thrust" && item.kind === "warmup",
      ),
    ).toHaveLength(scheme.setCount);
    expect(next.items.filter((item) => item.kind === "main")).toHaveLength(4);
  });

  it("DC-K4 rebuilds high-TM warmups for a low-TM replacement instead of carrying an old absolute load", () => {
    const scheme: WarmupScheme = {
      setCount: 3,
      percentLadder: [40, 60, 80],
      repLadder: [5, 5, 3],
    };
    const highTmLift: Prescription = {
      items: [
        {
          movementId: "deadlift",
          movementSlug: "deadlift",
          movementName: "Deadlift",
          kind: "warmup",
          sets: 1,
          reps: 5,
          percentTm: 60,
          // 60% of the old 200 kg TM — this is above the replacement's 50 kg
          // 1RM and must not survive the swap as an absolute target.
          targetWeightKg: 120,
        },
        {
          movementId: "deadlift",
          movementSlug: "deadlift",
          movementName: "Deadlift",
          kind: "main",
          sets: 1,
          reps: 5,
          percentTm: 85,
        },
      ],
    };
    const next = swapMovementInPrescription(
      highTmLift,
      "deadlift",
      {
        id: "barbell-hip-thrust",
        slug: "barbell-hip-thrust",
        displayName: "Barbell Hip Thrust",
      },
      "2026-05-23T12:00:00.000Z",
      { rehab: false },
      { warmupScheme: scheme, replacementHasTrainingMax: true },
    );
    const newOneRmKg = 50;
    const newTrainingMaxKg = 45;
    const warmups = next.items.filter((item) => item.kind === "warmup");

    expect(warmups).toHaveLength(3);
    expect(warmups.every((item) => item.targetWeightKg == null)).toBe(true);
    expect(
      warmups.every(
        (item) =>
          newTrainingMaxKg * ((item.percentTm ?? 0) / 100) < newOneRmKg,
      ),
    ).toBe(true);
    expect(
      next.items.find((item) => item.kind === "main")?.targetWeightKg,
    ).toBeUndefined();
  });

  it("DC-K4 retains blank warm-up slots and clears absolute loads when the replacement has no TM/1RM history", () => {
    const next = swapMovementInPrescription(
      {
        items: [
          {
            movementId: "deadlift",
            kind: "warmup",
            sets: 1,
            reps: 5,
            targetWeightKg: 120,
          },
          {
            movementId: "deadlift",
            kind: "main",
            sets: 1,
            reps: 5,
            percentTm: 85,
            targetWeightKg: 170,
          },
        ],
      },
      "deadlift",
      {
        id: "barbell-hip-thrust",
        slug: "barbell-hip-thrust",
        displayName: "Barbell Hip Thrust",
      },
      undefined,
      { rehab: false },
      {
        warmupScheme: {
          setCount: 3,
          percentLadder: [40, 60, 80],
          repLadder: [5, 5, 3],
        },
        replacementHasTrainingMax: false,
      },
    );

    const warmups = next.items.filter((item) => item.kind === "warmup");
    expect(warmups).toHaveLength(3);
    expect(warmups.every((item) => item.percentTm == null)).toBe(true);
    expect(warmups.every((item) => item.targetWeightKg == null)).toBe(true);
    expect(next.items.every((item) => item.targetWeightKg == null)).toBe(true);
  });

  it("DC-K4 retains warm-up slots for a BW main with no %TM anchor", () => {
    const next = swapMovementInPrescription(
      {
        items: [
          {
            movementId: "push-up",
            movementSlug: "push-up",
            movementName: "Push-up",
            kind: "main",
            sets: 5,
            reps: 8,
            bw: {
              prescriptionType: "reps",
              sets: 5,
              reps: 8,
              tempoEccentricSec: 2,
              targetRir: 2,
              restSeconds: 90,
              intensityCue: "Clean reps",
            },
          },
        ],
      },
      "push-up",
      {
        id: "barbell-hip-thrust",
        slug: "barbell-hip-thrust",
        displayName: "Barbell Hip Thrust",
      },
      undefined,
      { rehab: false },
      {
        warmupScheme: {
          setCount: 2,
          percentLadder: [50, 75],
          repLadder: [5, 3],
        },
        replacementHasTrainingMax: false,
      },
    );

    const warmups = next.items.filter((item) => item.kind === "warmup");
    expect(warmups).toHaveLength(2);
    expect(warmups.every((item) => item.percentTm == null)).toBe(true);
    expect(next.items.find((item) => item.kind === "main")?.sets).toBe(5);
  });

  // ---------------------------------------------------------------------
  // preserveItemIndices — set_logs.prescription_item_index is a join key
  // ---------------------------------------------------------------------

  /** [W,W,W, Main×3, Accessory×3] — the shape that breaks index-naive swaps. */
  const liveSession = (): Prescription => ({
    items: [
      ...Array.from({ length: 3 }, (_, i) => ({
        movementId: "deadlift",
        movementSlug: "deadlift",
        movementName: "Deadlift",
        kind: "warmup" as const,
        sets: 1,
        reps: [5, 5, 3][i],
        percentTm: [40, 60, 80][i],
      })),
      ...Array.from({ length: 3 }, () => ({
        movementId: "deadlift",
        movementSlug: "deadlift",
        movementName: "Deadlift",
        kind: "main" as const,
        sets: 1,
        reps: 5,
        percentTm: 90,
      })),
      ...Array.from({ length: 3 }, () => ({
        movementId: "mov-row",
        movementSlug: "barbell-row",
        movementName: "Barbell Row",
        kind: "accessory" as const,
        sets: 1,
        reps: 10,
      })),
    ],
  });

  const quickScheme: WarmupScheme = {
    setCount: 2,
    percentLadder: [50, 75],
    repLadder: [5, 3],
  };

  it("keeps every non-warmup item at its original index when the scheme's warm-up count differs (set_logs.prescription_item_index is a live join key)", () => {
    const before = liveSession();
    const next = swapMovementInPrescription(
      before,
      "deadlift",
      {
        id: "barbell-hip-thrust",
        slug: "barbell-hip-thrust",
        displayName: "Barbell Hip Thrust",
      },
      "2026-05-23T12:00:00.000Z",
      { rehab: false },
      {
        warmupScheme: quickScheme,
        replacementHasTrainingMax: true,
        preserveItemIndices: true,
      },
    );

    // 3 stale warm-up slots + a 2-set scheme must NOT become 2 slots: every
    // index from the main set onward would shift by one and already-written
    // set_logs would render under the wrong movement.
    expect(next.items).toHaveLength(before.items.length);
    before.items.forEach((prior, index) => {
      if (prior.kind === "warmup") return;
      const after = next.items[index]!;
      expect(after.kind).toBe(prior.kind);
      expect(after.reps).toBe(prior.reps);
      expect(after.sets).toBe(prior.sets);
      expect(after.movementId).toBe(
        prior.movementId === "deadlift" ? "barbell-hip-thrust" : prior.movementId,
      );
    });
    // Untouched movements are byte-identical, not just index-stable.
    expect(next.items.slice(6)).toEqual(before.items.slice(6));

    // The retained slots are re-anchored to the replacement's ladder
    // (50/75 % of the 90 % top working set), nearest-neighbour resampled to
    // the 3 slots that already exist.
    const warmups = next.items.slice(0, 3);
    expect(warmups.map((item) => item.percentTm)).toEqual([45, 67.5, 67.5]);
    expect(warmups.every((item) => item.movementId === "barbell-hip-thrust")).toBe(
      true,
    );
    expect(warmups.every((item) => item.targetWeightKg == null)).toBe(true);
  });

  it("DC-K4 a TM-anchored scheme survives the swap rebuild: flat 40/50/60 and no item-count change", () => {
    // A block owned by a program that publishes a fixed %-of-Training-Max ramp.
    const tmAnchored: WarmupScheme = {
      setCount: 3,
      percentLadder: [40, 50, 60],
      repLadder: [5, 5, 3],
      anchor: "training_max",
    };
    const swap = (rx: Prescription) =>
      swapMovementInPrescription(
        rx,
        "deadlift",
        {
          id: "barbell-hip-thrust",
          slug: "barbell-hip-thrust",
          displayName: "Barbell Hip Thrust",
        },
        "2026-05-23T12:00:00.000Z",
        { rehab: false },
        {
          warmupScheme: tmAnchored,
          replacementHasTrainingMax: true,
          preserveItemIndices: true,
        },
      );

    const before = liveSession();
    const next = swap(before);

    // The live-session invariant is untouched by the anchor change.
    expect(next.items).toHaveLength(before.items.length);
    expect(next.items.filter((item) => item.kind === "warmup")).toHaveLength(3);
    expect(next.items.slice(6)).toEqual(before.items.slice(6));

    // The rebuilt ladder is the ladder itself, NOT ladder × top set: a swap
    // must not silently re-anchor a program's fixed ramp to the day's top set.
    expect(next.items.slice(0, 3).map((item) => item.percentTm)).toEqual([
      40, 50, 60,
    ]);
    expect(next.items.slice(0, 3).map((item) => item.reps)).toEqual([5, 5, 3]);

    // ...and it stays flat when the same swap happens in a heavier week.
    const heavier: Prescription = {
      items: before.items.map((item) =>
        item.kind === "main" ? { ...item, percentTm: 95 } : item,
      ),
    };
    expect(swap(heavier).items.slice(0, 3).map((item) => item.percentTm)).toEqual([
      40, 50, 60,
    ]);
    // The equivalent top-set-anchored swap does drift week to week.
    const topSetSwap = (rx: Prescription) =>
      swapMovementInPrescription(
        rx,
        "deadlift",
        {
          id: "barbell-hip-thrust",
          slug: "barbell-hip-thrust",
          displayName: "Barbell Hip Thrust",
        },
        "2026-05-23T12:00:00.000Z",
        { rehab: false },
        {
          warmupScheme: { ...tmAnchored, anchor: "top_set" },
          replacementHasTrainingMax: true,
          preserveItemIndices: true,
        },
      );
    expect(topSetSwap(before).items.slice(0, 3).map((i) => i.percentTm)).toEqual([
      36, 45, 54,
    ]);
    expect(topSetSwap(heavier).items.slice(0, 3).map((i) => i.percentTm)).toEqual([
      38, 47.5, 57,
    ]);
  });

  it("adds no warm-up slots mid-session when the movement had none (index stability over ladder completeness)", () => {
    const before: Prescription = {
      items: [
        {
          movementId: "push-up",
          movementSlug: "push-up",
          movementName: "Push-up",
          kind: "main",
          sets: 5,
          reps: 8,
        },
        {
          movementId: "mov-row",
          movementSlug: "barbell-row",
          movementName: "Barbell Row",
          kind: "accessory",
          sets: 3,
          reps: 10,
        },
      ],
    };
    const next = swapMovementInPrescription(
      before,
      "push-up",
      {
        id: "barbell-hip-thrust",
        slug: "barbell-hip-thrust",
        displayName: "Barbell Hip Thrust",
      },
      undefined,
      { rehab: false },
      {
        warmupScheme: quickScheme,
        replacementHasTrainingMax: true,
        preserveItemIndices: true,
      },
    );

    expect(next.items).toHaveLength(2);
    expect(next.items.filter((item) => item.kind === "warmup")).toHaveLength(0);
    expect(next.items[1]).toEqual(before.items[1]);
  });

  it("still re-splices the full ladder for a future planned session (no set_logs to invalidate)", () => {
    const next = swapMovementInPrescription(
      liveSession(),
      "deadlift",
      {
        id: "barbell-hip-thrust",
        slug: "barbell-hip-thrust",
        displayName: "Barbell Hip Thrust",
      },
      undefined,
      { rehab: false },
      { warmupScheme: quickScheme, replacementHasTrainingMax: true },
    );

    expect(next.items.filter((item) => item.kind === "warmup")).toHaveLength(2);
    expect(next.items).toHaveLength(8);
  });

  it("retains pre-existing warm-up slots when the movement has no main item (never deletes a ladder silently)", () => {
    // Warm-ups in front of an accessory-only movement: getSwapWarmupAnchor
    // reports hasMain=false, which used to mean "generate nothing" while the
    // rebuild still dropped the matched warm-up items.
    const noMain: Prescription = {
      items: [
        {
          movementId: "mov-curl",
          movementSlug: "db-biceps-curl",
          movementName: "DB Biceps Curl",
          kind: "warmup",
          sets: 1,
          reps: 10,
          targetWeightKg: 8,
        },
        {
          movementId: "mov-curl",
          movementSlug: "db-biceps-curl",
          movementName: "DB Biceps Curl",
          kind: "accessory",
          sets: 3,
          reps: 10,
          targetWeightKg: 14,
        },
      ],
    };
    for (const preserveItemIndices of [false, true]) {
      const next = swapMovementInPrescription(
        noMain,
        "mov-curl",
        {
          id: "mov-hammer",
          slug: "db-hammer-curl",
          displayName: "DB Hammer Curl",
        },
        undefined,
        { rehab: false },
        {
          warmupScheme: quickScheme,
          replacementHasTrainingMax: true,
          preserveItemIndices,
        },
      );

      const warmups = next.items.filter((item) => item.kind === "warmup");
      expect(warmups).toHaveLength(1);
      expect(warmups[0]!.movementId).toBe("mov-hammer");
      // No main → no %TM anchor → blank load, but the slot survives.
      expect(warmups[0]!.percentTm).toBeUndefined();
      expect(warmups[0]!.targetWeightKg).toBeUndefined();
      expect(next.items).toHaveLength(2);
      expect(next.items[1]!.kind).toBe("accessory");
    }
  });

  it("keeps the user's absolute rehab load across a rehab swap (no %TM to fall back on)", () => {
    const rehab: Prescription = {
      items: [
        {
          movementId: "mov-tib",
          movementSlug: "tibialis-raise",
          movementName: "Tibialis Raise",
          kind: "tendon",
          sets: 3,
          reps: 12,
          targetWeightKg: 10,
          meta: { rehab: true },
        },
        {
          movementId: "mov-tib",
          movementSlug: "tibialis-raise",
          movementName: "Tibialis Raise",
          kind: "main",
          sets: 3,
          reps: 5,
          percentTm: 80,
          targetWeightKg: 100,
        },
      ],
    };
    const next = swapMovementInPrescription(
      rehab,
      "mov-tib",
      {
        id: "mov-heel",
        slug: "heel-drop",
        displayName: "Heel Drop",
      },
      undefined,
      { rehab: true },
      { warmupScheme: quickScheme, replacementHasTrainingMax: true },
    );

    const tendon = next.items.find((item) => item.kind === "tendon")!;
    expect(tendon.movementId).toBe("mov-heel");
    // Rehab loads are hand-entered and have no %TM fallback: clearing this
    // would silently delete the prescription instead of re-deriving it.
    expect(tendon.targetWeightKg).toBe(10);
    // The rehab-scoped swap leaves the core strength item alone entirely.
    expect(next.items[1]).toEqual(rehab.items[1]);

    // …but a core-scoped swap of the same movement still clears the
    // TM-anchored absolute load.
    const core = swapMovementInPrescription(
      rehab,
      "mov-tib",
      { id: "mov-heel", slug: "heel-drop", displayName: "Heel Drop" },
      undefined,
      { rehab: false },
      { warmupScheme: quickScheme, replacementHasTrainingMax: true },
    );
    expect(core.items.find((item) => item.kind === "main")!.targetWeightKg).toBeUndefined();
    expect(core.items.find((item) => item.kind === "tendon")!.targetWeightKg).toBe(10);
  });

  it("reports whether a swap carries absolute loads it cannot re-derive", () => {
    const rehabRx: Prescription = {
      items: [
        {
          movementId: "mov-tib",
          kind: "tendon",
          sets: 3,
          reps: 12,
          targetWeightKg: 10,
          meta: { rehab: true },
        },
      ],
    };
    expect(swapCarriesAbsoluteLoad(rehabRx, "mov-tib", { rehab: true })).toBe(true);
    expect(
      swapCarriesAbsoluteLoad(
        { items: [{ ...rehabRx.items[0]!, targetWeightKg: undefined }] },
        "mov-tib",
        { rehab: true },
      ),
    ).toBe(false);
    expect(swapCarriesAbsoluteLoad(base, "mov-bench", { rehab: false })).toBe(false);
  });
});

describe("addMovementToPrescription", () => {
  it("appends a 3x10 accessory tagged userAdded", () => {
    const next = addMovementToPrescription(base, {
      id: "mov-curl",
      slug: "db-biceps-curl",
      displayName: "DB Biceps Curl",
    });
    expect(next.items).toHaveLength(3);
    const added = next.items[2]!;
    expect(added.movementId).toBe("mov-curl");
    expect(added.kind).toBe("accessory");
    expect(added.sets).toBe(3);
    expect(added.reps).toBe(10);
    expect((added.meta as Record<string, unknown>).userAdded).toBe(true);
    expect(next.userEdited).toBe(true);
  });
});

describe("hasUserEditedPrescription", () => {
  it("recognizes explicit and legacy movement-edit markers", () => {
    expect(hasUserEditedPrescription(base)).toBe(false);
    expect(
      hasUserEditedPrescription({ ...base, userEdited: true }),
    ).toBe(true);
    expect(
      hasUserEditedPrescription({
        items: [
          {
            ...base.items[0]!,
            meta: { userAdded: true },
          },
        ],
      }),
    ).toBe(true);
    expect(
      hasUserEditedPrescription({
        items: [
          {
            ...base.items[0]!,
            meta: {
              swappedFrom: {
                movementId: "original",
                movementName: "Original",
              },
            },
          },
        ],
      }),
    ).toBe(true);
  });
});
