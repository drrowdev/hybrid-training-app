/**
 * TUT-gated bodyweight progression engine.
 *
 * Pure module — no I/O, no DB, no React. Domain rules live here so
 * the gate logic can be exhaustively tested in milliseconds; the
 * server hook in `apps/web/src/lib/sessions/bw-set-logging.ts`
 * loads the inputs, calls `evaluateProgression`, and writes the
 * resulting advance + audit row (Phase 4 plan §B).
 *
 * Gate philosophy (addendum principles 2 + 4 + 5):
 *   - principle 2 — progression is discrete: only advance to a real
 *     downstream node, never an interpolated weight.
 *   - principle 4 — tendons adapt 2–10× slower than muscle: the TUT
 *     threshold + the weeks-at-node floor are what stops a strong
 *     CNS from outrunning the joint.
 *   - principle 5 — skill work is neurologically demanding even when
 *     "light": skill families (planche / lever / handstand / flag)
 *     get a 2× TUT multiplier so the user banks meaningful time at
 *     the easier hold before the engine offers the next one.
 *
 * No external program names anywhere (DC-Q6).
 */
import type { BwProgress, MovementFamily, MovementNode } from "@hta/db";

/** One recent session's contribution to the over-completion check. */
export type RecentSessionStat = {
  /** YYYY-MM-DD (caller's TZ — only relative ordering matters here). */
  sessionDate: string;
  prescribedReps?: number;
  prescribedHoldSec?: number;
  actualReps?: number;
  actualHoldSec?: number;
  rir: number;
  cleanForm: boolean;
};

/** Reasons surfaced to the UI — kept as a closed union. */
export type AdvanceReason = "over_completed_2_weeks" | "chip_preference";

export type BlockReason =
  | "weeks_at_node_insufficient"
  | "tut_below_threshold"
  | "recent_sessions_not_over_completed"
  | "terminal_node"
  | "no_candidate_nodes";

export type ProgressionDecision =
  | {
      advance: true;
      toNodeId: string;
      toNodeKey: string;
      reason: AdvanceReason;
    }
  | {
      advance: false;
      reason: BlockReason;
      nextCheckAt?: "next_session" | "next_week";
    };

/** Skill families per addendum principle 5. */
const SKILL_FAMILIES: ReadonlySet<MovementFamily> = new Set([
  "planche",
  "lever_front",
  "lever_back",
  "human_flag",
  "handstand",
]);

const TUT_FLOOR_SEC = 60;
const TUT_CEILING_SEC = 1500;
const WEEKS_REQUIRED = 2;

/**
 * Per-node TUT target in seconds. Skill families + isometric-capable
 * nodes pay a 2× multiplier (12 s per anchor point); everything else
 * pays 6 s. Clamped to [60, 1500] so the gate stays meaningful at
 * both ends of the DAG.
 *
 * Exposed for tests and for the gate-state popover that has to render
 * the same "X / Y sec" denominator the engine uses.
 */
export function tutThreshold(node: MovementNode): number {
  const isSkill =
    SKILL_FAMILIES.has(node.family) && node.isometricCapable === true;
  const multiplier = isSkill ? 12 : 6;
  const raw = node.difficultyAnchor * multiplier;
  return Math.max(TUT_FLOOR_SEC, Math.min(TUT_CEILING_SEC, raw));
}

type OverCompletionVerdict = {
  /** Both of the last 2 sessions over-completed. */
  ok: boolean;
  /** Number of the last 2 sessions that over-completed (0–2). */
  hits: 0 | 1 | 2;
};

/**
 * Over-completion check. Walks the LAST 2 entries in `recentSessions`
 * (caller passes them in chronological order). Each session counts as
 * an "over-completion" when the matching rule fires:
 *   - reps:        actualReps        >= prescribedReps     + 2 ∧ RIR ≥ 1 ∧ cleanForm
 *   - hold:        actualHoldSec     >= prescribedHoldSec  + 3 ∧ RIR ≥ 1 ∧ cleanForm
 *   - tempo_reps:  actualReps        >= prescribedReps     + 1 ∧ RIR ≥ 1 ∧ cleanForm
 *
 * The tempo_reps band is tighter because each rep is worth ~1.5× a
 * normal rep (slow eccentric); +1 there is roughly +1.5 of normal
 * stimulus. Decision: tempo_reps vs reps is inferred from the
 * presence of `prescribedHoldSec` (hold) vs `prescribedReps` alone
 * (reps OR tempo_reps — distinguished by the caller passing the
 * appropriate `tempoRepsMode` flag).
 */
function evaluateOverCompletion(
  recent: ReadonlyArray<RecentSessionStat>,
  mode: "reps" | "hold" | "tempo_reps",
): OverCompletionVerdict {
  if (recent.length < 2) return { ok: false, hits: 0 };
  const last2 = recent.slice(-2);
  let hits = 0;
  for (const s of last2) {
    if (!s.cleanForm || s.rir < 1) continue;
    if (mode === "hold") {
      if (
        s.prescribedHoldSec != null &&
        s.actualHoldSec != null &&
        s.actualHoldSec >= s.prescribedHoldSec + 3
      ) {
        hits += 1;
      }
    } else if (mode === "tempo_reps") {
      if (
        s.prescribedReps != null &&
        s.actualReps != null &&
        s.actualReps >= s.prescribedReps + 1
      ) {
        hits += 1;
      }
    } else {
      if (
        s.prescribedReps != null &&
        s.actualReps != null &&
        s.actualReps >= s.prescribedReps + 2
      ) {
        hits += 1;
      }
    }
  }
  return { ok: hits === 2, hits: hits as 0 | 1 | 2 };
}

/**
 * Infer the prescription mode from the current node + the recent
 * session shape. We trust hold-time data first (only emitted on
 * isometric_hold prescriptions) and fall back to a difficulty-anchor
 * heuristic that matches `bw-prescription.ts` decision 1 (advanced
 * non-isometric nodes get a slow tempo).
 */
function inferMode(
  currentNode: MovementNode,
  recent: ReadonlyArray<RecentSessionStat>,
): "reps" | "hold" | "tempo_reps" {
  const hasHoldData = recent.some((s) => s.prescribedHoldSec != null);
  if (hasHoldData) return "hold";
  if (
    currentNode.isometricCapable &&
    (SKILL_FAMILIES.has(currentNode.family) ||
      currentNode.nodeKey.includes("_hold"))
  ) {
    return "hold";
  }
  if (currentNode.difficultyAnchor >= 60) return "tempo_reps";
  return "reps";
}

export type EvaluateProgressionInput = {
  bwProgress: BwProgress;
  currentNode: MovementNode;
  /**
   * Downstream nodes the user could advance to. Caller (the
   * session-completion hook) resolves these by scanning
   * `movement_nodes` for rows whose `prerequisites` contains
   * `currentNode.id` and filtering to the same family.
   */
  candidateNextNodes: ReadonlyArray<MovementNode>;
  /** Chronological. The engine reads the LAST 2 entries. */
  recentSessions: ReadonlyArray<RecentSessionStat>;
  /**
   * Optional skill-chip preference captured during the Phase 2
   * onboarding wizard. When present and it matches one of the
   * candidate nodes, the engine prefers that branch (decision 5).
   * Phase 4 does not yet wire chip persistence end-to-end; the
   * argument is accepted so the future chip-preference hook lands
   * without a signature change.
   */
  preferredNextNodeKey?: string;
};

/**
 * Decide whether the user has earned the next node in this family.
 *
 * Gate rules (ALL must pass to advance):
 *   1. `weeks_at_node >= 2`
 *   2. `accumulated_tut_seconds >= tutThreshold(currentNode)`
 *   3. Both of the last 2 same-family sessions over-completed
 *      (rule per prescription mode — see evaluateOverCompletion).
 *   4. At least one candidate next node exists.
 *   5. The lowest-anchor child wins, unless `preferredNextNodeKey`
 *      points at a different child of the same family (chip override
 *      → reason: 'chip_preference').
 *
 * Block reasons fall through in priority order so the UI can surface
 * the most actionable hint (weeks → TUT → recent → terminal).
 */
export function evaluateProgression(
  input: EvaluateProgressionInput,
): ProgressionDecision {
  const { bwProgress, currentNode, candidateNextNodes, recentSessions } = input;

  if (bwProgress.weeksAtNode < WEEKS_REQUIRED) {
    return {
      advance: false,
      reason: "weeks_at_node_insufficient",
      nextCheckAt: "next_week",
    };
  }

  const threshold = tutThreshold(currentNode);
  if (bwProgress.accumulatedTutSeconds < threshold) {
    return {
      advance: false,
      reason: "tut_below_threshold",
      nextCheckAt: "next_week",
    };
  }

  const mode = inferMode(currentNode, recentSessions);
  const over = evaluateOverCompletion(recentSessions, mode);
  if (!over.ok) {
    return {
      advance: false,
      reason: "recent_sessions_not_over_completed",
      nextCheckAt: "next_session",
    };
  }

  // Filter candidates to the same family — defence in depth, the
  // caller is meant to pre-filter but the DAG allows cross-family
  // prereqs (muscle_up depends on pull_v) and we don't want to leak
  // those into the wrong family's progression path.
  const sameFamily = candidateNextNodes.filter(
    (n) => n.family === currentNode.family,
  );

  if (sameFamily.length === 0) {
    // Distinguish "user has reached the top of the family" (terminal)
    // from "caller forgot to pass candidates": when no candidates and
    // current node has the highest anchor in this family per caller,
    // we report terminal; otherwise no_candidate_nodes. The engine
    // can't tell the difference from inputs alone, so the convention
    // is: empty candidates → terminal_node. Phase 6 stall-detection
    // owns the distinction.
    return { advance: false, reason: "terminal_node" };
  }

  // Chip preference — engaged when the caller passes a preferred
  // node key and it matches one of the candidates.
  if (input.preferredNextNodeKey) {
    const preferred = sameFamily.find(
      (n) => n.nodeKey === input.preferredNextNodeKey,
    );
    if (preferred) {
      return {
        advance: true,
        toNodeId: preferred.id,
        toNodeKey: preferred.nodeKey,
        reason: "chip_preference",
      };
    }
  }

  // Default — lowest difficulty_anchor wins (stable order by nodeKey
  // when anchors tie so the engine is deterministic across rows).
  const sorted = [...sameFamily].sort((a, b) => {
    if (a.difficultyAnchor !== b.difficultyAnchor) {
      return a.difficultyAnchor - b.difficultyAnchor;
    }
    return a.nodeKey.localeCompare(b.nodeKey);
  });
  const next = sorted[0]!;
  return {
    advance: true,
    toNodeId: next.id,
    toNodeKey: next.nodeKey,
    reason: "over_completed_2_weeks",
  };
}

/**
 * Compact gate-state snapshot used by the "Next:" popover in the
 * session UI + the settings preview. Pure derivation — UI never
 * recomputes any of these values.
 */
export type GateStateSnapshot = {
  weeksAtNode: number;
  weeksRequired: number;
  tutAccumulated: number;
  tutRequired: number;
  recentOverCompleted: boolean;
  recentOverCompletedHits: 0 | 1 | 2;
  /** True when no candidate next node exists for this family. */
  terminal: boolean;
};

export function gateStateFor(args: {
  bwProgress: BwProgress;
  currentNode: MovementNode;
  candidateNextNodes: ReadonlyArray<MovementNode>;
  recentSessions: ReadonlyArray<RecentSessionStat>;
}): GateStateSnapshot {
  const mode = inferMode(args.currentNode, args.recentSessions);
  const over = evaluateOverCompletion(args.recentSessions, mode);
  return {
    weeksAtNode: args.bwProgress.weeksAtNode,
    weeksRequired: WEEKS_REQUIRED,
    tutAccumulated: args.bwProgress.accumulatedTutSeconds,
    tutRequired: tutThreshold(args.currentNode),
    recentOverCompleted: over.ok,
    recentOverCompletedHits: over.hits,
    terminal:
      args.candidateNextNodes.filter(
        (n) => n.family === args.currentNode.family,
      ).length === 0,
  };
}
