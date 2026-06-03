/**
 * Antagonist-superset pairing — ADR 0026, Phase 1 (pure module) unit tests.
 *
 * Locks the classification table, the reciprocal-pair predicate, and the
 * post-selection pairing pass: meta tagging, minimal A2-adjacency reorder,
 * stable group ids, immutability, and the no-op guarantee for unpairable input.
 */
import { describe, it, expect } from "vitest";
import type { Muscle, PrescriptionItem } from "@hta/db";
import {
  antagonistGroupOf,
  areReciprocal,
  arePairable,
  pairAntagonistAccessories,
  SUPERSET_GROUP_KEY,
  SUPERSET_SLOT_KEY,
} from "../antagonist-pairs";

type ItemSpec = {
  id: string;
  kind?: PrescriptionItem["kind"];
  sets?: number;
  muscles?: Muscle[];
  meta?: Record<string, unknown>;
};

const MUSCLES: Record<string, Muscle[]> = {};

function item(spec: ItemSpec): PrescriptionItem {
  MUSCLES[spec.id] = spec.muscles ?? [];
  return {
    movementId: spec.id,
    movementSlug: spec.id,
    kind: spec.kind ?? "accessory",
    sets: spec.sets ?? 3,
    reps: 10,
    ...(spec.meta ? { meta: spec.meta } : {}),
  };
}

const musclesOf = (it: PrescriptionItem): readonly Muscle[] =>
  MUSCLES[it.movementId] ?? [];

const groupId = (it: PrescriptionItem) =>
  (it.meta as Record<string, unknown> | undefined)?.[SUPERSET_GROUP_KEY];
const slot = (it: PrescriptionItem) =>
  (it.meta as Record<string, unknown> | undefined)?.[SUPERSET_SLOT_KEY];

describe("antagonistGroupOf", () => {
  it("classifies single-muscle isolations", () => {
    expect(antagonistGroupOf(["biceps"])).toBe("elbow_flexors");
    expect(antagonistGroupOf(["triceps"])).toBe("elbow_extensors");
    expect(antagonistGroupOf(["quads"])).toBe("knee_extensors");
    expect(antagonistGroupOf(["hamstrings"])).toBe("knee_flexors");
    expect(antagonistGroupOf(["calves"])).toBe("ankle_plantarflexors");
    expect(antagonistGroupOf(["tibialis"])).toBe("ankle_dorsiflexors");
  });

  it("collapses multiple muscles in the same group", () => {
    expect(antagonistGroupOf(["chest", "upper_chest", "front_delts"])).toBe(
      "horizontal_push",
    );
    expect(antagonistGroupOf(["lats", "mid_back", "rear_delts"])).toBe(
      "horizontal_pull",
    );
  });

  it("returns null when primaries straddle two groups (compound)", () => {
    // A row hitting lats (pull) + biceps (flexors) is ambiguous.
    expect(antagonistGroupOf(["lats", "biceps"])).toBeNull();
    expect(antagonistGroupOf(["chest", "triceps"])).toBeNull();
  });

  it("ignores unmapped muscles but classifies on the mapped one", () => {
    // glutes is unmapped; quads decides.
    expect(antagonistGroupOf(["glutes", "quads"])).toBe("knee_extensors");
  });

  it("returns null for wholly unmapped muscle sets", () => {
    expect(antagonistGroupOf(["side_delts"])).toBeNull();
    expect(antagonistGroupOf(["abs", "lower_back"])).toBeNull();
    expect(antagonistGroupOf(["forearms"])).toBeNull();
    expect(antagonistGroupOf([])).toBeNull();
  });
});

describe("areReciprocal", () => {
  it("matches antagonist pairs both directions", () => {
    expect(areReciprocal("elbow_flexors", "elbow_extensors")).toBe(true);
    expect(areReciprocal("elbow_extensors", "elbow_flexors")).toBe(true);
    expect(areReciprocal("horizontal_push", "horizontal_pull")).toBe(true);
    expect(areReciprocal("ankle_plantarflexors", "ankle_dorsiflexors")).toBe(true);
  });

  it("rejects same-group (agonist) and unrelated groups", () => {
    expect(areReciprocal("elbow_flexors", "elbow_flexors")).toBe(false);
    expect(areReciprocal("elbow_flexors", "knee_extensors")).toBe(false);
    expect(areReciprocal("horizontal_push", "knee_flexors")).toBe(false);
  });
});

describe("arePairable", () => {
  it("pairs reciprocal equal-set accessories", () => {
    const a = item({ id: "curl", muscles: ["biceps"], sets: 3 });
    const b = item({ id: "pushdown", muscles: ["triceps"], sets: 3 });
    expect(arePairable(a, b, musclesOf)).toBe(true);
  });

  it("rejects non-accessory kinds", () => {
    const a = item({ id: "main", kind: "main", muscles: ["quads"], sets: 3 });
    const b = item({ id: "curl2", muscles: ["hamstrings"], sets: 3 });
    expect(arePairable(a, b, musclesOf)).toBe(false);
  });

  it("rejects agonist (same-group) pairs", () => {
    const a = item({ id: "curlA", muscles: ["biceps"], sets: 3 });
    const b = item({ id: "curlB", muscles: ["biceps"], sets: 3 });
    expect(arePairable(a, b, musclesOf)).toBe(false);
  });

  it("rejects unequal sets by default but allows when requireEqualSets=false", () => {
    const a = item({ id: "lext", muscles: ["quads"], sets: 3 });
    const b = item({ id: "lcurl", muscles: ["hamstrings"], sets: 2 });
    expect(arePairable(a, b, musclesOf)).toBe(false);
    expect(arePairable(a, b, musclesOf, { requireEqualSets: false })).toBe(true);
  });

  it("rejects unclassifiable (compound) accessories", () => {
    const a = item({ id: "row", muscles: ["lats", "biceps"], sets: 3 });
    const b = item({ id: "press", muscles: ["chest"], sets: 3 });
    expect(arePairable(a, b, musclesOf)).toBe(false);
  });
});

describe("pairAntagonistAccessories", () => {
  it("pairs a reciprocal accessory pair, tagging meta and pulling A2 adjacent", () => {
    const items = [
      item({ id: "curl", muscles: ["biceps"] }),
      item({ id: "solo", muscles: ["side_delts"] }),
      item({ id: "pushdown", muscles: ["triceps"] }),
    ];
    const out = pairAntagonistAccessories(items, musclesOf);
    // A2 (pushdown) pulled up to sit right after A1 (curl); solo pushed back.
    expect(out.map((i) => i.movementId)).toEqual(["curl", "pushdown", "solo"]);
    expect(slot(out[0])).toBe("A1");
    expect(slot(out[1])).toBe("A2");
    expect(groupId(out[0])).toBe(groupId(out[1]));
    expect(groupId(out[2])).toBeUndefined();
  });

  it("keeps A1 in its original slot (higher priority stays front)", () => {
    const items = [
      item({ id: "lext", muscles: ["quads"] }), // A1, position 0
      item({ id: "filler", muscles: ["glutes"] }), // unclassifiable solo
      item({ id: "lcurl", muscles: ["hamstrings"] }), // A2 pulled up to index 1
    ];
    const out = pairAntagonistAccessories(items, musclesOf);
    expect(out.map((i) => i.movementId)).toEqual(["lext", "lcurl", "filler"]);
  });

  it("assigns distinct stable group ids to multiple pairs", () => {
    const items = [
      item({ id: "curl", muscles: ["biceps"] }),
      item({ id: "pushdown", muscles: ["triceps"] }),
      item({ id: "lext", muscles: ["quads"] }),
      item({ id: "lcurl", muscles: ["hamstrings"] }),
    ];
    const out = pairAntagonistAccessories(items, musclesOf);
    expect(groupId(out[0])).toBe("ss-1");
    expect(groupId(out[1])).toBe("ss-1");
    expect(groupId(out[2])).toBe("ss-2");
    expect(groupId(out[3])).toBe("ss-2");
  });

  it("greedily matches the nearest later reciprocal partner", () => {
    const items = [
      item({ id: "curl", muscles: ["biceps"] }),
      item({ id: "pushdownA", muscles: ["triceps"] }), // nearest → pairs with curl
      item({ id: "pushdownB", muscles: ["triceps"] }), // left solo (no flexor left)
    ];
    const out = pairAntagonistAccessories(items, musclesOf);
    expect(groupId(out[0])).toBe("ss-1");
    expect(out[1].movementId).toBe("pushdownA");
    expect(groupId(out[1])).toBe("ss-1");
    expect(groupId(out[2])).toBeUndefined();
  });

  it("is a no-op when nothing pairs — same objects, same order", () => {
    const items = [
      item({ id: "main", kind: "main", muscles: ["quads"] }),
      item({ id: "curl", muscles: ["biceps"] }),
      item({ id: "delts", muscles: ["side_delts"] }),
    ];
    const out = pairAntagonistAccessories(items, musclesOf);
    expect(out).toEqual(items);
    out.forEach((o, i) => expect(o).toBe(items[i]));
  });

  it("does not mutate the input items or their meta", () => {
    const items = [
      item({ id: "curl", muscles: ["biceps"], meta: { cue: "keep" } }),
      item({ id: "pushdown", muscles: ["triceps"] }),
    ];
    const snapshot = JSON.parse(JSON.stringify(items));
    const out = pairAntagonistAccessories(items, musclesOf);
    expect(items).toEqual(snapshot);
    // tagged output preserves prior meta keys.
    expect((out[0].meta as Record<string, unknown>).cue).toBe("keep");
    expect((out[0].meta as Record<string, unknown>)[SUPERSET_GROUP_KEY]).toBe(
      "ss-1",
    );
  });

  it("does not pair across the equal-set requirement by default", () => {
    const items = [
      item({ id: "lext", muscles: ["quads"], sets: 3 }),
      item({ id: "lcurl", muscles: ["hamstrings"], sets: 2 }),
    ];
    const out = pairAntagonistAccessories(items, musclesOf);
    expect(groupId(out[0])).toBeUndefined();
    expect(groupId(out[1])).toBeUndefined();
  });
});
