import { describe, it, expect } from "vitest";
import type { CatalogMovement } from "@/lib/planner/accessory-picker";
import type { LimitationsContext } from "@/lib/planner/limitations-context";
import type { RemainingSession } from "@/lib/planner/remaining-sessions";
import { attributeLimitation, buildLimitationResponse, buildSelectedUpdates, deriveReplacement, deriveReplacements } from "../response";
import { limitationItemKey } from "../item-key";

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
    pattern: over.pattern ?? null,
    equipment: over.equipment ?? null,
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

  it("picks an unsupported but safe same-target alternative (no isSupported gate)", () => {
    // Regression: a quad accessory flagged via a blocked SECONDARY muscle used
    // to drop because every safe quad candidate is isSupported=false. Now it
    // swaps. Mirrors the real Spanish-Squat (loads adductors) → Leg-Extension case.
    const cat: CatalogMovement[] = [
      mv({
        id: "spanishsquat",
        slug: "spanish-squat",
        primaryMuscles: ["quads"],
        secondaryMuscles: ["adductors"],
        primaryRegion: "knee",
        pattern: "squat",
        isSupported: false,
      }),
      mv({
        id: "legext",
        slug: "leg-extension",
        primaryMuscles: ["quads"],
        primaryRegion: "knee",
        pattern: "isolation",
        isSupported: false, // unsupported — would have been rejected before
      }),
    ];
    const repl = deriveReplacement(
      cat[0],
      cat,
      ctx({ blockedMuscles: new Set(["adductors"]) }),
      new Set(["spanishsquat"]),
    );
    expect(repl?.id).toBe("legext");
  });

  it("never offers a cardio-pattern movement as a replacement", () => {
    const cat: CatalogMovement[] = [
      mv({
        id: "spanishsquat",
        slug: "spanish-squat",
        primaryMuscles: ["quads"],
        secondaryMuscles: ["adductors"],
        primaryRegion: "knee",
        pattern: "squat",
      }),
      mv({
        id: "spinclass",
        slug: "spin-class",
        primaryMuscles: ["quads"],
        primaryRegion: "knee",
        pattern: "cardio",
      }),
    ];
    const repl = deriveReplacement(
      cat[0],
      cat,
      ctx({ blockedMuscles: new Set(["adductors"]) }),
      new Set(["spanishsquat"]),
    );
    expect(repl).toBeNull(); // the only quad-sharing candidate is cardio → excluded
  });

  it("prefers a same-region, same-pattern alternative", () => {
    const cat: CatalogMovement[] = [
      mv({
        id: "off",
        slug: "off",
        primaryMuscles: ["quads"],
        primaryRegion: "knee",
        pattern: "squat",
      }),
      mv({
        id: "sameregionpattern",
        slug: "same",
        primaryMuscles: ["quads"],
        primaryRegion: "knee",
        pattern: "squat",
      }),
      mv({
        id: "otherregion",
        slug: "other",
        primaryMuscles: ["quads"],
        primaryRegion: "hip",
        pattern: "isolation",
      }),
    ];
    const repl = deriveReplacement(cat[0], cat, ctx({}), new Set(["off"]));
    expect(repl?.id).toBe("sameregionpattern");
  });
});

function emptyEquipment(over: Partial<import("@/lib/settings/equipment-schema").Equipment> = {}) {
  return {
    preset: "custom" as const,
    bars: { barbellKg: 20, trapBarKg: null, safetyBarKg: null },
    plates: [],
    dumbbells: null,
    kettlebells: [],
    machines: [],
    cardio: [],
    accessories: {
      weightedVest: [],
      sandbag: [],
      bands: false,
      dipBelt: false,
      pullUpBar: false,
      rings: false,
      sled: false,
      wallBall: false,
    },
    ...over,
  };
}

describe("deriveReplacements — ranked alternatives + equipment", () => {
  const cat: CatalogMovement[] = [
    mv({ id: "spanishsquat", slug: "spanish-squat", primaryMuscles: ["quads"], secondaryMuscles: ["adductors"], primaryRegion: "knee", pattern: "squat" }),
    mv({ id: "legext", slug: "leg-extension", primaryMuscles: ["quads"], primaryRegion: "knee", pattern: "isolation", equipment: "machine-leg-ext" }),
    mv({ id: "frontsquat", slug: "front-squat", primaryMuscles: ["quads"], primaryRegion: "knee", pattern: "squat", equipment: "barbell" }),
    mv({ id: "revnordic", slug: "reverse-nordic-curl", primaryMuscles: ["quads"], primaryRegion: "knee", pattern: "isolation", equipment: "bodyweight" }),
  ];
  const context = ctx({ blockedMuscles: new Set(["adductors"]) });

  it("returns a ranked list, best first", () => {
    const ranked = deriveReplacements(cat[0], cat, context, {});
    expect(ranked.length).toBeGreaterThan(1);
    // front-squat shares region+pattern → outranks the isolations.
    expect(ranked[0].id).toBe("frontsquat");
  });

  it("excludes movements the user has no equipment for (no machines → no leg extension)", () => {
    const ranked = deriveReplacements(cat[0], cat, context, {
      equipment: emptyEquipment(),
    });
    expect(ranked.map((r) => r.id)).not.toContain("legext");
    // bodyweight + barbell candidates remain.
    expect(ranked.map((r) => r.id)).toContain("revnordic");
    expect(ranked.map((r) => r.id)).toContain("frontsquat");
  });

  it("includes a machine candidate when the user owns that machine", () => {
    const ranked = deriveReplacements(cat[0], cat, context, {
      equipment: emptyEquipment({ machines: ["leg_extension"] }),
    });
    expect(ranked.map((r) => r.id)).toContain("legext");
  });

  it("attaches alternatives to each swap in buildLimitationResponse", () => {
    const plan = buildLimitationResponse(
      [session({ id: "s1", items: [{ movementId: "spanishsquat", kind: "accessory", sets: 3, reps: 10 }] })],
      cat,
      context,
    );
    expect(plan.swaps).toHaveLength(1);
    expect(plan.swaps[0].alternatives.length).toBeGreaterThan(1);
    expect(plan.swaps[0].toMovementId).toBe(plan.swaps[0].alternatives[0].movementId);
  });

  it("rejects role-only matches and cross-region/pattern compounds (the RKC-Plank / Trap-Bar-DL problem)", () => {
    const offending = mv({
      id: "spanishsquat",
      slug: "spanish-squat",
      primaryMuscles: ["quads"],
      primaryRegion: "knee",
      pattern: "squat",
      bulletproofRoles: ["heavy_isometric"],
    });
    const pool: CatalogMovement[] = [
      offending,
      // Good: same muscle + same region.
      mv({ id: "revnordic", slug: "reverse-nordic-curl", primaryMuscles: ["quads"], primaryRegion: "knee", pattern: "isolation" }),
      // Role-only match, different muscle/region (RKC Plank).
      mv({ id: "rkcplank", slug: "rkc-plank", primaryMuscles: ["abs"], primaryRegion: "lumbar_trunk", pattern: "isolation", bulletproofRoles: ["heavy_isometric"] }),
      // Role-only match (Isometric Pin OHP).
      mv({ id: "isoohp", slug: "iso-ohp-pin-press", primaryMuscles: ["front_delts", "triceps"], primaryRegion: "shoulder_scapular", pattern: "tendon", bulletproofRoles: ["heavy_isometric"] }),
      // Shares quads but wrong region AND pattern (Trap Bar Deadlift).
      mv({ id: "trapdl", slug: "trap-bar-deadlift", primaryMuscles: ["quads", "glutes", "hamstrings", "lower_back"], primaryRegion: "hamstring_posterior", pattern: "hinge" }),
    ];
    const ids = deriveReplacements(offending, pool, ctx({ blockedMuscles: new Set(["adductors"]) }), {}).map((r) => r.id);
    expect(ids).toContain("revnordic");
    expect(ids).not.toContain("rkcplank");
    expect(ids).not.toContain("isoohp");
    expect(ids).not.toContain("trapdl");
  });
});

describe("buildSelectedUpdates — per-item review (Option 2)", () => {
  // One session with a swappable offender (chinup → lat alt) at index 0 and a
  // drop-only offender (curl, no safe like-for-like) at index 1, under an
  // elbow-region block.
  const sessions: RemainingSession[] = [
    session({
      id: "s1",
      items: [
        { movementId: "chinup", kind: "accessory", sets: 4, reps: 8 },
        { movementId: "curl", kind: "accessory", sets: 3, reps: 12 },
      ],
    }),
  ];
  const context = ctx({ blockedRegions: new Set(["elbow_forearm"]) });
  const plan = buildLimitationResponse(sessions, CATALOG, context);
  const swapKey = limitationItemKey("s1", 0);
  const dropKey = limitationItemKey("s1", 1);

  it("the full plan proposes a swap at 0 and a drop at 1", () => {
    expect(plan.swaps.map((s) => s.itemIndex)).toEqual([0]);
    expect(plan.drops.map((d) => d.itemIndex)).toEqual([1]);
  });

  it("applies only the checked swap, keeping the unchecked drop in place", () => {
    const out = buildSelectedUpdates(sessions, plan, new Set([swapKey]));
    expect(out.swapped).toBe(1);
    expect(out.dropped).toBe(0);
    expect(out.updates).toHaveLength(1);
    const items = out.updates[0].prescription.items;
    // curl (index 1) is untouched; chinup (index 0) is replaced.
    expect(items).toHaveLength(2);
    expect(items[0].movementId).toBe(plan.swaps[0].toMovementId);
    expect(items[0].sets).toBe(4);
    expect(items[1].movementId).toBe("curl");
  });

  it("applies only the checked drop, keeping the unchecked swap in place", () => {
    const out = buildSelectedUpdates(sessions, plan, new Set([dropKey]));
    expect(out.swapped).toBe(0);
    expect(out.dropped).toBe(1);
    const items = out.updates[0].prescription.items;
    // chinup (index 0) stays as-is; curl (index 1) is removed.
    expect(items).toHaveLength(1);
    expect(items[0].movementId).toBe("chinup");
  });

  it("applies both when both are checked", () => {
    const out = buildSelectedUpdates(sessions, plan, new Set([swapKey, dropKey]));
    expect(out.swapped).toBe(1);
    expect(out.dropped).toBe(1);
    const items = out.updates[0].prescription.items;
    expect(items).toHaveLength(1);
    expect(items[0].movementId).toBe(plan.swaps[0].toMovementId);
  });

  it("is a no-op when nothing is checked", () => {
    const out = buildSelectedUpdates(sessions, plan, new Set());
    expect(out).toEqual({ updates: [], swapped: 0, dropped: 0, applied: [] });
  });

  it("ignores unknown / stale keys", () => {
    const out = buildSelectedUpdates(
      sessions,
      plan,
      new Set([limitationItemKey("s1", 99), "garbage"]),
    );
    expect(out).toEqual({ updates: [], swapped: 0, dropped: 0, applied: [] });
  });

  it("carries the replacement slug onto the rewritten item", () => {
    const out = buildSelectedUpdates(sessions, plan, new Set([swapKey]));
    const swapped = out.updates[0].prescription.items[0];
    expect(swapped.movementSlug).toBe(plan.swaps[0].toMovementSlug);
    expect(swapped.movementName).toBe(plan.swaps[0].toName);
  });

  it("honours a chosen target that is one of the offered alternatives", () => {
    const swap = plan.swaps[0];
    // Pick a non-default alternative if one exists; else the default.
    const alt = swap.alternatives.find((a) => a.movementId !== swap.toMovementId)
      ?? swap.alternatives[0];
    const out = buildSelectedUpdates(
      sessions,
      plan,
      new Set([swapKey]),
      new Map([[swap.fromMovementId, alt.movementId]]),
    );
    expect(out.updates[0].prescription.items[0].movementId).toBe(alt.movementId);
  });

  it("ignores a chosen target that is NOT an offered alternative (falls back to default)", () => {
    const swap = plan.swaps[0];
    const out = buildSelectedUpdates(
      sessions,
      plan,
      new Set([swapKey]),
      new Map([[swap.fromMovementId, "totally-unsafe-injected-id"]]),
    );
    // Falls back to the engine default — never the injected id.
    expect(out.updates[0].prescription.items[0].movementId).toBe(swap.toMovementId);
  });

  it("records an applied swap entry with resolved from/to (for adjustment tracking)", () => {
    const out = buildSelectedUpdates(sessions, plan, new Set([swapKey]));
    expect(out.applied).toHaveLength(1);
    const a = out.applied[0];
    expect(a).toMatchObject({
      sessionId: "s1",
      kind: "swap",
      fromMovementId: plan.swaps[0].fromMovementId,
      toMovementId: plan.swaps[0].toMovementId,
      toName: plan.swaps[0].toName,
    });
    expect(a.fromName).toBeTruthy();
  });

  it("records an applied drop entry with a null target", () => {
    const out = buildSelectedUpdates(sessions, plan, new Set([dropKey]));
    expect(out.applied).toHaveLength(1);
    expect(out.applied[0]).toMatchObject({
      sessionId: "s1",
      kind: "drop",
      fromMovementId: "curl",
      toMovementId: null,
      toName: null,
    });
  });

  it("records one applied entry per approved change", () => {
    const out = buildSelectedUpdates(sessions, plan, new Set([swapKey, dropKey]));
    expect(out.applied).toHaveLength(2);
    expect(out.applied.map((a) => a.kind).sort()).toEqual(["drop", "swap"]);
  });
});

describe("attributeLimitation", () => {
  const offender = mv({
    id: "chinup",
    slug: "chin-up",
    primaryMuscles: ["lats"],
    primaryRegion: "back",
  });

  it("returns the id of the single-row context the movement offends", () => {
    const elbow = ctx({ blockedRegions: new Set(["back"]) });
    const result = attributeLimitation(offender, "chinup", [
      { id: "lim-elbow", ctx: elbow },
    ]);
    expect(result).toBe("lim-elbow");
  });

  it("returns the first matching limitation when several are present", () => {
    const noMatch = ctx({ blockedRegions: new Set(["knee"]) });
    const match = ctx({ blockedRegions: new Set(["back"]) });
    const result = attributeLimitation(offender, "chinup", [
      { id: "lim-knee", ctx: noMatch },
      { id: "lim-back", ctx: match },
    ]);
    expect(result).toBe("lim-back");
  });

  it("returns null when the movement offends no single-row context", () => {
    const noMatch = ctx({ blockedRegions: new Set(["knee"]) });
    const result = attributeLimitation(offender, "chinup", [
      { id: "lim-knee", ctx: noMatch },
    ]);
    expect(result).toBeNull();
  });
});
