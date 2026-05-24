/**
 * Catalog-shape invariants for the bodyweight skill-tree DAG.
 *
 * These guarantee the seed never silently drifts off the Phase 1
 * design contract — running them in CI catches any new node missing
 * a prereq target, a cycle in the DAG, or an out-of-range anchor.
 */
import { describe, expect, it } from "vitest";
import { MOVEMENT_FAMILIES } from "../src/schema/movement-nodes";
import {
  BW_MOVEMENT_NODES,
  BW_MOVEMENT_NODE_COUNT,
  type SeedMovementNode,
} from "../seeds/bw-movement-nodes";

const SEED = BW_MOVEMENT_NODES;

function refKey(
  ref: string | { family: string; nodeKey: string },
  ownerFamily: string,
): string {
  return typeof ref === "string"
    ? `${ownerFamily}:${ref}`
    : `${ref.family}:${ref.nodeKey}`;
}

describe("bodyweight movement-node catalog", () => {
  it("contains exactly 75 nodes (Phase 1 spec)", () => {
    expect(BW_MOVEMENT_NODE_COUNT).toBe(75);
    expect(SEED.length).toBe(75);
  });

  it("every (family, node_key) pair is unique", () => {
    const seen = new Set<string>();
    for (const n of SEED) {
      const k = `${n.family}:${n.nodeKey}`;
      expect(seen.has(k), `duplicate ${k}`).toBe(false);
      seen.add(k);
    }
  });

  it("every node has a non-empty display name", () => {
    for (const n of SEED) {
      expect(n.displayName.trim().length, `${n.nodeKey} blank`).toBeGreaterThan(0);
    }
  });

  it("every family from the taxonomy has at least one node", () => {
    const byFamily = new Map<string, number>();
    for (const n of SEED) byFamily.set(n.family, (byFamily.get(n.family) ?? 0) + 1);
    for (const f of MOVEMENT_FAMILIES) {
      expect(byFamily.get(f) ?? 0, `family ${f} has no nodes`).toBeGreaterThan(0);
    }
  });

  it("every family has at least one DAG entry node (no in-family prereqs)", () => {
    // "Entry" here means: reachable without first owning another node
    // in the *same* family. Cross-family edges (muscle_up depending on
    // pull_v.pull_up) are allowed and don't disqualify a node.
    const entryByFamily = new Map<string, number>();
    for (const n of SEED) {
      const inFamilyPrereqs = n.prerequisites.filter((p) => {
        const r = typeof p === "string" ? { family: n.family, nodeKey: p } : p;
        return r.family === n.family;
      });
      if (inFamilyPrereqs.length === 0) {
        entryByFamily.set(n.family, (entryByFamily.get(n.family) ?? 0) + 1);
      }
    }
    for (const f of MOVEMENT_FAMILIES) {
      expect(
        entryByFamily.get(f) ?? 0,
        `family ${f} has no entry node`,
      ).toBeGreaterThan(0);
    }
  });

  it("every prerequisite resolves to a real (family, node_key)", () => {
    const known = new Set(SEED.map((n) => `${n.family}:${n.nodeKey}`));
    const missing: string[] = [];
    for (const n of SEED) {
      for (const p of n.prerequisites) {
        const k = refKey(p, n.family);
        if (!known.has(k)) missing.push(`${n.family}:${n.nodeKey} -> ${k}`);
      }
    }
    expect(missing, missing.join(", ")).toEqual([]);
  });

  it("difficulty anchors are in [1, 100]", () => {
    for (const n of SEED) {
      expect(n.difficultyAnchor, `${n.nodeKey}`).toBeGreaterThanOrEqual(1);
      expect(n.difficultyAnchor, `${n.nodeKey}`).toBeLessThanOrEqual(100);
    }
  });

  it("tempo seconds are within [1, 12]", () => {
    for (const n of SEED) {
      expect(n.defaultTempoSeconds, `${n.nodeKey}.tempo`).toBeGreaterThanOrEqual(1);
      expect(n.defaultTempoSeconds, `${n.nodeKey}.tempo`).toBeLessThanOrEqual(12);
      expect(n.tutPerRepSeconds, `${n.nodeKey}.tut`).toBeGreaterThanOrEqual(1);
      expect(n.tutPerRepSeconds, `${n.nodeKey}.tut`).toBeLessThanOrEqual(12);
    }
  });

  it("the DAG has no cycles", () => {
    // Three-colour DFS — back-edge detection on the prerequisite graph.
    const byKey = new Map<string, SeedMovementNode>();
    for (const n of SEED) byKey.set(`${n.family}:${n.nodeKey}`, n);

    const WHITE = 0;
    const GREY = 1;
    const BLACK = 2;
    const colour = new Map<string, number>();
    for (const k of byKey.keys()) colour.set(k, WHITE);

    function visit(k: string, path: string[]): string[] | null {
      const c = colour.get(k);
      if (c === BLACK) return null;
      if (c === GREY) return [...path, k];
      colour.set(k, GREY);
      const n = byKey.get(k)!;
      for (const p of n.prerequisites) {
        const childKey = refKey(p, n.family);
        const cycle = visit(childKey, [...path, k]);
        if (cycle) return cycle;
      }
      colour.set(k, BLACK);
      return null;
    }

    for (const k of byKey.keys()) {
      const cycle = visit(k, []);
      expect(cycle, `cycle found: ${cycle?.join(" -> ")}`).toBeNull();
    }
  });

  it("muscle_up family hard-gates on pull_v.pull_up (cross-family edge)", () => {
    const jumping = SEED.find(
      (n) => n.family === "muscle_up" && n.nodeKey === "jumping_muscle_up",
    );
    expect(jumping).toBeDefined();
    const hasCrossEdge = jumping!.prerequisites.some((p) => {
      if (typeof p === "string") return false;
      return p.family === "pull_v" && p.nodeKey === "pull_up";
    });
    expect(hasCrossEdge).toBe(true);
  });

  it("matches expected per-family counts (15 families = 75 nodes)", () => {
    const expected: Record<string, number> = {
      push_h: 8,
      push_v: 6,
      pull_v: 8,
      pull_h: 5,
      squat_unilateral: 6,
      squat_bilateral: 4,
      hinge: 5,
      planche: 6,
      lever_front: 5,
      lever_back: 4,
      muscle_up: 3,
      handstand: 4,
      human_flag: 3,
      // 4 anti-flexion + 1 L-sit (bonus, slotted into anti-flexion).
      core_anti_flexion: 5,
      core_anti_rotation: 3,
    };
    const actual: Record<string, number> = {};
    for (const n of SEED) actual[n.family] = (actual[n.family] ?? 0) + 1;
    expect(actual).toEqual(expected);
  });
});
