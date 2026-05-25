/**
 * Variant-vs-load suggestion engine for loaded bodyweight progression.
 *
 * Once a user is consistently progressing with external load on a
 * loadable BW node, we have to decide between two divergent paths:
 *
 *   1. Bump the load (cheaper progress, stronger tendon adaptation).
 *   2. Advance to the harder DAG variant (skill transfer carries over).
 *
 * Heuristic (per addendum §1, mass-ratio strength):
 *   - When current load ≥ 30% bodyweight AND a harder variant exists,
 *     bias toward the variant. At ~30% extra load the strength
 *     surplus is enough to express the next leverage tier cleanly.
 *   - When current load < 30% bodyweight OR the user is on a terminal
 *     node, bias toward more load. Tendon work needs accumulated
 *     volume; load increments are also lower CNS cost than a new
 *     skill demand.
 *
 * Gate: both branches require 2+ over-completed weeks at the current
 * node × load. Mirrors `bw-progression.ts` evaluateProgression: never
 * advance on a single good session.
 *
 * Pure module. No I/O, no DB.
 */
import type { MovementNode } from "@hta/db";

export type LoadedSuggestion =
  | { kind: "increase_load"; deltaKg: number; reason: string }
  | { kind: "advance_variant"; toNodeKey: string; reason: string }
  | { kind: "hold"; reason: string };

const MASS_RATIO_VARIANT_BIAS = 0.3;

export function suggestLoadOrVariant(args: {
  currentNode: MovementNode;
  candidateNextNodes: ReadonlyArray<MovementNode>;
  currentLoadKg: number;
  userBodyweightKg: number;
  cleanOverCompletionWeeks: number;
}): LoadedSuggestion {
  if (args.cleanOverCompletionWeeks < 2) {
    return {
      kind: "hold",
      reason: "Need 2+ over-completed weeks before bumping.",
    };
  }
  if (args.candidateNextNodes.length === 0) {
    return {
      kind: "increase_load",
      deltaKg: 2.5,
      reason: "Terminal node; add 2.5 kg.",
    };
  }
  const threshold = args.userBodyweightKg * MASS_RATIO_VARIANT_BIAS;
  if (args.currentLoadKg >= threshold) {
    const next = [...args.candidateNextNodes].sort(
      (a, b) => a.difficultyAnchor - b.difficultyAnchor,
    )[0]!;
    return {
      kind: "advance_variant",
      toNodeKey: next.nodeKey,
      reason: "Load above 30% bodyweight; advance variant for skill transfer.",
    };
  }
  return {
    kind: "increase_load",
    deltaKg: 2.5,
    reason: "Continue load progression; under 30% bodyweight.",
  };
}
