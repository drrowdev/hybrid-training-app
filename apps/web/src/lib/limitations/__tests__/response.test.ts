import { describe, it, expect } from "vitest";
import type { CatalogMovement } from "@/lib/planner/accessory-picker";
import type { LimitationsContext } from "@/lib/planner/limitations-context";
import type { RemainingSession } from "@/lib/planner/remaining-sessions";
import { buildLimitationResponse, deriveReplacement } from "../response";

function mv(
  over: Partial<CatalogMovement> & { id: string; slug: string },
): CatalogMovement {
  return {
    id: over.id,
    slug: over.slug,
    displayName: over.displayName ?? over.slug,
    primaryMuscles: over.primaryMuscles ?? [],
    secondaryMuscles: over.secondaryMuscles ?? [],
    primaryRegion: over.primaryRegion ?? "lumbar_trunk",
    secondaryRegions: over.secondaryRegions ?? [],
    bulletproofRoles: over.bulletproofRoles ?? [],
    functionalRoles: over.functionalRoles ?? [],
    isSupported: over.isSupported ?? true,
    isCompound: over.isCompound ?? false,
    isLoadable: over.isLoadable ?? false,
    eccentricLoadScore: over.eccentricLoadScore ?? null,
    stimToFatigueScore: over.stimToFatigueScore ?? null,
    highStrainTendon: over.highStrainTendon ?? false,
  };
}

// Catalog: a chin-up (loads the elbow as a secondary region) that a
// cubital-tunnel block would flag, plus safe lat alternatives that don't
// load the elbow.
const CATALOG: CatalogMovement[] = [
  mv({
    id: "chinup",
    slug: "chin-up",
    primaryMuscles: ["lats", "biceps"],
    primaryRegion: "shoulder_scapular",
    secondaryRegions: ["elbow_forearm"],
    functionalRoles: ["compound_assistance"],
    isCompound: true,
    isLoadable: true,
  }),
  mv({
    id: "latpull",
    slug: "lat-pulldown",
    primaryMuscles: ["lats"],
    primaryRegion: "shoulder_scapular",
    functionalRoles: ["compound_assistance"],
    isCompound: true,
    isLoadable: true,
  }),
  mv({
    id: "row",
    slug: "chest-supported-row",
    primaryMuscles: ["lats", "upper_back"],
    primaryRegion: "shoulder_scapular",
    functionalRoles: ["compound_assistance"],
    isCompound: true,
    isLoadable: true,
  }),
  mv({
    id: "curl",
    slug: "db-curl",
    primaryMuscles: ["biceps"],
    primaryRegion: "elbow_forearm",
  }),
  mv({
    id: "squat",
    slug: "back-squat",
    primaryMuscles: ["quads"],
    primaryRegion: "knee",
    isCompound: true,
    isLoadable: true,
  }),
];

function session(
  over: Partial<RemainingSession> & {
    id: string;
    items: RemainingSession["prescription"]["items"];
  },
): RemainingSession {
  return {
    id: over.id,
    weekIndex: over.weekIndex ?? 0,
    dayIndex: over.dayIndex ?? 0,
    title: over.title ?? "Pull Day",
    role: over.role ?? "pull",
    prescription: { items: over.items },
  };
}

function ctx(over: Partial<LimitationsContext>): LimitationsContext {
  return {
    blockedRegions: over.blockedRegions ?? new Set(),
    blockedMuscles: over.blockedMuscles ?? new Set(),
    blockedMovementIds: over.blockedMovementIds ?? new Set(),
    allowedMovementIds: over.allowedMovementIds ?? new Set(),
    tendinopathyActive: over.tendinopathyActive ?? false,
  };
}

describe("buildLimitationResponse — parity", () => {
  it("returns an empty plan when there are no limitations", () => {
    const plan = buildLimitationResponse(
      [session({ id: "s1", items: [{ movementId: "chinup", kind: "accessory" }] })],
      CATALOG,
      ctx({}),
    );
    expect(plan).toEqual({ swaps: [], drops: [], warns: [], updates: [] });
  });

  it("returns an empty plan when nothing offends", () => {
    const plan = buildLimitationResponse(
      [session({ id: "s1", items: [{ movementId: "latpull", kind: "accessory" }] })],
      CATALOG,
      ctx({ blockedRegions: new Set(["knee"]) }),
    );
    expect(plan.updates).toHaveLength(0);
    expect(plan.swaps).toHaveLength(0);
  });
});

describe("buildLimitationResponse — region-blocked accessory swap", () => {
  it("swaps an elbow-loading accessory for a safe same-muscle alternative", () => {
    const plan = buildLimitationResponse(
      [
        session({
          id: "s1",
          items: [{ movementId: "chinup", kind: "accessory", sets: 4, reps: 8 }],
        }),
      ],
      CATALOG,
      ctx({ blockedRegions: new Set(["elbow_forearm"]) }),
    );
    expect(plan.swaps).toHaveLength(1);
    const swap = plan.swaps[0];
    expect(swap.fromMovementId).toBe("chinup");
    expect(["latpull", "row"]).toContain(swap.toMovementId);
    expect(swap.reason).toBe("blocked_region");

    expect(plan.updates).toHaveLength(1);
    const newItem = plan.updates[0].prescription.items[0];
    expect(newItem.movementId).toBe(swap.toMovementId);
    expect(newItem.sets).toBe(4);
    expect(newItem.reps).toBe(8);
  });

  it("never re-introduces a blocked movement in the replacement", () => {
    const plan = buildLimitationResponse(
      [session({ id: "s1", items: [{ movementId: "chinup", kind: "accessory" }] })],
      CATALOG,
      ctx({ blockedRegions: new Set(["elbow_forearm"]) }),
    );
    for (const swap of plan.swaps) {
      const repl = CATALOG.find((m) => m.id === swap.toMovementId)!;
      expect(repl.primaryRegion).not.toBe("elbow_forearm");
      expect(repl.secondaryRegions).not.toContain("elbow_forearm");
    }
  });
});

describe("buildLimitationResponse — main lifts are warn-only", () => {
  it("warns but never auto-changes a main-lift offender", () => {
    const plan = buildLimitationResponse(
      [
        session({
          id: "s1",
          items: [{ movementId: "chinup", kind: "main", sets: 5, reps: 3 }],
        }),
      ],
      CATALOG,
      ctx({ blockedRegions: new Set(["elbow_forearm"]) }),
    );
    expect(plan.swaps).toHaveLength(0);
    expect(plan.warns).toHaveLength(1);
    expect(plan.warns[0].fromMovementId).toBe("chinup");
    expect(plan.warns[0].kind).toBe("main");
    expect(plan.updates).toHaveLength(0);
  });
});

describe("buildLimitationResponse — drop when no safe replacement", () => {
  it("drops a discretionary offender that has no like-for-like swap", () => {
    const plan = buildLimitationResponse(
      [session({ id: "s1", items: [{ movementId: "curl", kind: "accessory" }] })],
      CATALOG,
      ctx({ blockedMuscles: new Set(["biceps"]) }),
    );
    expect(plan.drops).toHaveLength(1);
    expect(plan.drops[0].fromMovementId).toBe("curl");
    expect(plan.updates[0].prescription.items).toHaveLength(0);
  });
});

describe("buildLimitationResponse — blockedMovementIds is unconditional", () => {
  it("acts on a flagged movement even when it is allow-listed", () => {
    const plan = buildLimitationResponse(
      [session({ id: "s1", items: [{ movementId: "chinup", kind: "accessory" }] })],
      CATALOG,
      ctx({
        blockedMovementIds: new Set(["chinup"]),
        allowedMovementIds: new Set(["chinup"]),
      }),
    );
    expect(plan.swaps.length + plan.drops.length).toBe(1);
    if (plan.swaps.length === 1) {
      expect(plan.swaps[0].reason).toBe("movement_flagged");
    }
  });
});

describe("deriveReplacement", () => {
  it("excludes movements already in the session", () => {
    const offending = CATALOG.find((m) => m.id === "chinup")!;
    const repl = deriveReplacement(
      offending,
      CATALOG,
      ctx({ blockedRegions: new Set(["elbow_forearm"]) }),
      new Set(["latpull", "row"]),
    );
    expect(repl).toBeNull();
  });
});
