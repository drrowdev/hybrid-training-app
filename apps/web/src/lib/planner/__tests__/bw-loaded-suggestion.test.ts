import { describe, expect, it } from "vitest";
import type { MovementNode } from "@hta/db";
import { suggestLoadOrVariant } from "../bw-loaded-suggestion";

function node(
  nodeKey: string,
  difficultyAnchor = 35,
  overrides: Partial<MovementNode> = {},
): MovementNode {
  return { nodeKey, difficultyAnchor, ...overrides } as unknown as MovementNode;
}

describe("suggestLoadOrVariant", () => {
  it("holds when fewer than 2 over-completed weeks", () => {
    const s = suggestLoadOrVariant({
      currentNode: node("pull_up"),
      candidateNextNodes: [node("wide_pull_up", 45)],
      currentLoadKg: 0,
      userBodyweightKg: 80,
      cleanOverCompletionWeeks: 1,
    });
    expect(s.kind).toBe("hold");
    if (s.kind === "hold") {
      expect(s.reason).toMatch(/2\+/);
    }
  });

  it("increments load at terminal node (no candidates)", () => {
    const s = suggestLoadOrVariant({
      currentNode: node("one_arm_pull_up", 90),
      candidateNextNodes: [],
      currentLoadKg: 10,
      userBodyweightKg: 80,
      cleanOverCompletionWeeks: 3,
    });
    expect(s.kind).toBe("increase_load");
    if (s.kind === "increase_load") {
      expect(s.deltaKg).toBe(2.5);
      expect(s.reason).toMatch(/Terminal/);
    }
  });

  it("advances variant when load >= 30% bodyweight and a variant exists", () => {
    const next = node("wide_pull_up", 45);
    const s = suggestLoadOrVariant({
      currentNode: node("pull_up"),
      candidateNextNodes: [next, node("archer_pull_up", 70)],
      currentLoadKg: 24, // 30% of 80
      userBodyweightKg: 80,
      cleanOverCompletionWeeks: 2,
    });
    expect(s.kind).toBe("advance_variant");
    if (s.kind === "advance_variant") {
      expect(s.toNodeKey).toBe("wide_pull_up"); // lowest difficulty child
      expect(s.reason).toMatch(/30%/);
    }
  });

  it("increments load when below 30% bodyweight", () => {
    const s = suggestLoadOrVariant({
      currentNode: node("pull_up"),
      candidateNextNodes: [node("wide_pull_up", 45)],
      currentLoadKg: 10, // 12.5% of 80
      userBodyweightKg: 80,
      cleanOverCompletionWeeks: 2,
    });
    expect(s.kind).toBe("increase_load");
    if (s.kind === "increase_load") {
      expect(s.deltaKg).toBe(2.5);
      expect(s.reason).toMatch(/30% bodyweight/);
    }
  });

  it("boundary at exactly 30% bodyweight advances variant", () => {
    const s = suggestLoadOrVariant({
      currentNode: node("pull_up"),
      candidateNextNodes: [node("wide_pull_up", 45)],
      currentLoadKg: 21, // exactly 30% of 70
      userBodyweightKg: 70,
      cleanOverCompletionWeeks: 2,
    });
    expect(s.kind).toBe("advance_variant");
  });
});
