import { describe, expect, it } from "vitest";
import type { MovementFamily, MovementNode } from "@hta/db";
import {
  buildBwMainItemsForSession,
  type BwFamilyContext,
} from "../bw-main-items";

function node(family: MovementFamily, key: string, anchor = 30): MovementNode {
  return {
    id: `node-${family}-${key}`,
    family,
    nodeKey: key,
    displayName: key,
    prerequisites: [],
    externalLoadCapable: false,
    isometricCapable: false,
    unilateral: false,
    defaultTempoSeconds: 4,
    tutPerRepSeconds: 4,
    difficultyAnchor: anchor,
    createdAt: new Date(),
  } as MovementNode;
}

function ctx(family: MovementFamily, key: string): BwFamilyContext {
  return {
    family,
    node: node(family, key),
    movementId: `mv-${family}`,
    movementSlug: key,
    movementName: key,
    cleanRepHistory: [],
  };
}

describe("buildBwMainItemsForSession", () => {
  it("emits 2 items per family (main + back_off) by default", () => {
    const byFamily = new Map<MovementFamily, BwFamilyContext>([
      ["push_h", ctx("push_h", "push_up")],
      ["pull_v", ctx("pull_v", "pull_up")],
      ["squat_unilateral", ctx("squat_unilateral", "split_squat")],
    ]);
    const items = buildBwMainItemsForSession({
      byFamily,
      archetype: "hypertrophy_anchor",
      weekIndex: 0,
      seed: "block-a:0:single",
    });
    expect(items).toHaveLength(6);
    const kinds = items.map((i) => i.kind);
    expect(kinds.filter((k) => k === "main")).toHaveLength(3);
    expect(kinds.filter((k) => k === "back_off")).toHaveLength(3);
  });

  it("embeds the BW payload on each item with node identity", () => {
    const byFamily = new Map<MovementFamily, BwFamilyContext>([
      ["pull_v", ctx("pull_v", "archer_pull_up")],
    ]);
    const items = buildBwMainItemsForSession({
      byFamily,
      archetype: "strength_anchor",
      weekIndex: 1,
      seed: "block-z:2:am",
    });
    expect(items).toHaveLength(2);
    const main = items[0]!;
    expect(main.bw).toBeDefined();
    expect(main.bw!.family).toBe("pull_v");
    expect(main.bw!.nodeKey).toBe("archer_pull_up");
    expect(main.bw!.nodeDisplayName).toBe("archer_pull_up");
    expect(main.bw!.sets).toBeGreaterThan(0);
  });

  it("skips the back_off bucket when includeBackOff is false", () => {
    const byFamily = new Map<MovementFamily, BwFamilyContext>([
      ["push_h", ctx("push_h", "push_up")],
      ["pull_v", ctx("pull_v", "pull_up")],
    ]);
    const items = buildBwMainItemsForSession({
      byFamily,
      archetype: "strength_anchor",
      weekIndex: 0,
      seed: "block-a:0:single",
      includeBackOff: false,
    });
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.kind === "main")).toBe(true);
  });

  it("returns an empty array when the user has no calibrated families", () => {
    const items = buildBwMainItemsForSession({
      byFamily: new Map(),
      archetype: "strength_anchor",
      weekIndex: 0,
      seed: "block-a:0:single",
    });
    expect(items).toHaveLength(0);
  });

  it("preserves the BW main lift outside the legacy weight-anchored path", () => {
    const byFamily = new Map<MovementFamily, BwFamilyContext>([
      ["push_h", ctx("push_h", "push_up")],
    ]);
    const items = buildBwMainItemsForSession({
      byFamily,
      archetype: "hypertrophy_anchor",
      weekIndex: 0,
      seed: "block-a:0:single",
    });
    for (const it of items) {
      // Critical invariant: BW items must NOT carry a %TM (otherwise
      // the focus view would try to multiply against a missing TM).
      expect(it.percentTm).toBeUndefined();
      expect(it.bw).toBeDefined();
    }
  });
});
