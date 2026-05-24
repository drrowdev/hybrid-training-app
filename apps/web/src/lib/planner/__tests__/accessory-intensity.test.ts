import { describe, it, expect } from "vitest";
import type { ArchetypeId } from "../archetypes";
import {
  accessoryIntensity,
  inferAccessoryBucket,
  type AccessoryBucket,
} from "../accessory-intensity";

// ─── inferAccessoryBucket ─────────────────────────────────────────

describe("inferAccessoryBucket", () => {
  it("returns tendon for hsr-tagged movements", () => {
    expect(
      inferAccessoryBucket({
        slug: "hsr-rdl",
        bulletproofRoles: ["hsr"],
      }),
    ).toBe("tendon");
  });

  it("returns tendon for slug keyword match even without role tag", () => {
    expect(inferAccessoryBucket({ slug: "eccentric-heel-raise" })).toBe(
      "tendon",
    );
    expect(inferAccessoryBucket({ slug: "copenhagen-plank" })).toBe("tendon");
  });

  it("returns plyometric for power-reason picks", () => {
    expect(
      inferAccessoryBucket({
        reason: "power",
        slug: "broad-jump",
      }),
    ).toBe("plyometric");
  });

  it("returns plyometric for slug keyword match (jump, throw)", () => {
    expect(inferAccessoryBucket({ slug: "med-ball-throw" })).toBe(
      "plyometric",
    );
    expect(inferAccessoryBucket({ slug: "jump-squat" })).toBe("plyometric");
  });

  it("returns isometric for carry / plank / wall-sit", () => {
    expect(
      inferAccessoryBucket({
        slug: "farmer-carry",
        bulletproofRoles: ["carry"],
      }),
    ).toBe("isometric");
    expect(inferAccessoryBucket({ slug: "side-plank" })).toBe("isometric");
    expect(inferAccessoryBucket({ slug: "wall-sit" })).toBe("isometric");
    expect(inferAccessoryBucket({ slug: "dead-bug" })).toBe("isometric");
  });

  it("returns isolation for single-muscle non-compound movements", () => {
    expect(
      inferAccessoryBucket({
        slug: "db-lateral-raise",
        isCompound: false,
        primaryMuscles: ["side_delts"],
      }),
    ).toBe("isolation");
    expect(
      inferAccessoryBucket({
        slug: "rope-pushdown",
        isCompound: false,
        primaryMuscles: ["triceps"],
      }),
    ).toBe("isolation");
  });

  it("returns compound for multi-muscle / unknown-isolation movements", () => {
    expect(
      inferAccessoryBucket({
        slug: "rdl",
        isCompound: true,
        primaryMuscles: ["hamstrings", "glutes"],
      }),
    ).toBe("compound");
    expect(
      inferAccessoryBucket({
        slug: "leg-press",
        isCompound: true,
        primaryMuscles: ["quads", "glutes"],
      }),
    ).toBe("compound");
  });

  it("defaults to compound when metadata is missing", () => {
    expect(inferAccessoryBucket({ slug: "mystery-movement" })).toBe(
      "compound",
    );
    expect(inferAccessoryBucket({})).toBe("compound");
  });

  it("tendon role beats isometric / plyo precedence", () => {
    // HSR-tagged eccentric heel raise — should classify as tendon even
    // though "heel-raise" is single-muscle (calves).
    expect(
      inferAccessoryBucket({
        slug: "hsr-heel-raise",
        bulletproofRoles: ["hsr"],
        isCompound: false,
        primaryMuscles: ["calves"],
      }),
    ).toBe("tendon");
  });
});

// ─── accessoryIntensity matrix ────────────────────────────────────

type ArchKey = Exclude<ArchetypeId, "custom">;
const ARCHETYPES: ArchKey[] = [
  "strength_anchor",
  "hypertrophy_anchor",
  "endurance_anchor",
  "concurrent_hybrid",
  "rebuild",
  "maintenance",
];

const BUCKETS: AccessoryBucket[] = [
  "compound",
  "isolation",
  "isometric",
  "plyometric",
  "tendon",
];

describe("accessoryIntensity — matrix coverage (bucket × archetype × week)", () => {
  // Spec: at least 25 cases. Loop over every combination → 5 × 6 × 4 = 120 cases,
  // asserting structural invariants. Targeted cases further down lock the values.
  for (const bucket of BUCKETS) {
    for (const archetype of ARCHETYPES) {
      for (const weekIndex of [0, 1, 2, 3]) {
        it(`${bucket} × ${archetype} × week ${weekIndex + 1} has a cue + correct shape`, () => {
          const out = accessoryIntensity({ archetype, bucket, weekIndex });
          expect(out.intensityCue).toBeTruthy();
          expect(out.intensityCue!.length).toBeLessThanOrEqual(80);
          // Brand-purity guard — no methodology / external program names.
          expect(out.intensityCue).not.toMatch(
            /wendler|5\/3\/1|531|sheiko|smolov|westside|rp |renaissance/i,
          );
          if (bucket === "plyometric") {
            expect(out.targetRpe).toEqual({ min: 10, max: 10 });
            expect(out.targetRir).toBeUndefined();
            expect(out.holdSec).toBeUndefined();
          } else if (bucket === "isometric") {
            expect(out.holdSec).toBeTruthy();
            expect(out.holdSec!.min).toBeGreaterThan(0);
            expect(out.targetRir).toBeUndefined();
          } else if (bucket === "tendon") {
            expect(out.tempoEccentricSec).toBe(3);
            expect(out.targetRir).toBeTruthy();
          } else {
            expect(out.targetRir).toBeTruthy();
            expect(out.holdSec).toBeUndefined();
            expect(out.targetRpe).toBeUndefined();
          }
        });
      }
    }
  }
});

describe("accessoryIntensity — targeted matrix values", () => {
  it("compound × strength_anchor × week 2 = RIR 2–3 (baseline)", () => {
    const out = accessoryIntensity({
      archetype: "strength_anchor",
      bucket: "compound",
      weekIndex: 1,
    });
    expect(out.targetRir).toEqual({ min: 2, max: 3 });
  });

  it("compound × strength_anchor × week 1 (ramp) = RIR 3–4", () => {
    const out = accessoryIntensity({
      archetype: "strength_anchor",
      bucket: "compound",
      weekIndex: 0,
    });
    expect(out.targetRir).toEqual({ min: 3, max: 4 });
  });

  it("compound × strength_anchor × week 4 (deload) = RIR 4–5", () => {
    const out = accessoryIntensity({
      archetype: "strength_anchor",
      bucket: "compound",
      weekIndex: 3,
    });
    expect(out.targetRir).toEqual({ min: 4, max: 5 });
  });

  it("isolation × hypertrophy_anchor × week 2 = RIR 0–1 + last-set-to-failure cue", () => {
    const out = accessoryIntensity({
      archetype: "hypertrophy_anchor",
      bucket: "isolation",
      weekIndex: 1,
    });
    expect(out.targetRir).toEqual({ min: 0, max: 1 });
    expect(out.intensityCue).toMatch(/failure/i);
  });

  it("isolation × strength_anchor × week 2 has the 'clean reps' cue", () => {
    const out = accessoryIntensity({
      archetype: "strength_anchor",
      bucket: "isolation",
      weekIndex: 1,
    });
    expect(out.targetRir).toEqual({ min: 2, max: 2 });
    expect(out.intensityCue).toMatch(/clean reps/i);
  });

  it("isometric × hypertrophy_anchor × week 2 = hold 30–60s", () => {
    const out = accessoryIntensity({
      archetype: "hypertrophy_anchor",
      bucket: "isometric",
      weekIndex: 1,
    });
    expect(out.holdSec).toEqual({ min: 30, max: 60 });
  });

  it("isometric × hypertrophy_anchor × week 4 = hold trimmed to 60% (18–36s)", () => {
    const out = accessoryIntensity({
      archetype: "hypertrophy_anchor",
      bucket: "isometric",
      weekIndex: 3,
    });
    expect(out.holdSec).toEqual({ min: 18, max: 36 });
  });

  it("plyometric ignores week modifier — always RPE 10", () => {
    for (const w of [0, 1, 2, 3]) {
      const out = accessoryIntensity({
        archetype: "concurrent_hybrid",
        bucket: "plyometric",
        weekIndex: w,
      });
      expect(out.targetRpe).toEqual({ min: 10, max: 10 });
    }
  });

  it("tendon × strength_anchor × week 2 = RIR 2 + 3s eccentric", () => {
    const out = accessoryIntensity({
      archetype: "strength_anchor",
      bucket: "tendon",
      weekIndex: 1,
    });
    expect(out.targetRir).toEqual({ min: 2, max: 2 });
    expect(out.tempoEccentricSec).toBe(3);
  });

  it("tendon × strength_anchor × week 4 (deload) widens to RIR 4 + keeps tempo", () => {
    const out = accessoryIntensity({
      archetype: "strength_anchor",
      bucket: "tendon",
      weekIndex: 3,
    });
    expect(out.targetRir).toEqual({ min: 4, max: 4 });
    expect(out.tempoEccentricSec).toBe(3);
  });

  it("custom archetype falls back to strength_anchor row", () => {
    const cust = accessoryIntensity({
      archetype: "custom",
      bucket: "compound",
      weekIndex: 1,
    });
    const sa = accessoryIntensity({
      archetype: "strength_anchor",
      bucket: "compound",
      weekIndex: 1,
    });
    expect(cust).toEqual(sa);
  });
});

// ─── Brand purity ──────────────────────────────────────────────────

describe("accessoryIntensity — brand purity", () => {
  it("no cue mentions an external program or methodology", () => {
    // Pre-emptive guard: if a future contributor types "RP" or a
    // program name into a cue, this test breaks.
    const blocked =
      /wendler|5\/3\/1|531|sheiko|smolov|westside|conjugate|nsuns|stronglifts|starting strength|greyskull/i;
    for (const bucket of BUCKETS) {
      for (const archetype of ARCHETYPES) {
        for (const w of [0, 1, 2, 3]) {
          const cue = accessoryIntensity({ archetype, bucket, weekIndex: w })
            .intensityCue;
          expect(cue).toBeTruthy();
          expect(cue).not.toMatch(blocked);
        }
      }
    }
  });
});
