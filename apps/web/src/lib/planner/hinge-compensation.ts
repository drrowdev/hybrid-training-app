/**
 * Posterior-chain hinge compensation generator.
 *
 * Why this exists
 * ───────────────
 * For bodyweight-only users, the posterior-chain hinge family has
 * limited external loadability — there is no deadlift bar, no kettlebell
 * swing-to-failure, no RDL with a meaningful load. Strength comes from
 * tempo and isometric work on a small DAG of nodes (hip_hinge →
 * single_leg_rdl_bw → glute_ham_raise_assisted → nordic_curl_eccentric
 * → nordic_curl_concentric).
 *
 * The block planner picks 3 main families per session (see
 * `bw-family-rotation.ts`). When the rotation doesn't land on `hinge`,
 * the user's hinge volume for that session is zero. Per the bodyweight
 * addendum (principle 3 — explicit posterior-chain coverage check),
 * the engine should inject a compensation movement in that case.
 *
 * Citations (kept here, never in user-facing UI copy — DC-Q6):
 *   - Bodyweight addendum §3 — hinge as a structural gap for bodyweight
 *     programming; calls for explicit compensation when rotation misses
 *     the family.
 *   - Baar 2017 — isometric protocols are an effective tendon-loading
 *     stimulus when external load isn't available; aligns with the
 *     advanced eccentric-only Nordic prescription.
 *   - Kongsgaard 2009 — heavy-slow-resistance: 3 s+ eccentric at
 *     sub-maximal load drives tendon adaptation. The prescription
 *     leans on slow eccentrics for the same reason.
 *   - Calisthenics practitioner consensus — entry-level hinge work
 *     (tempo hip-hinge, single-leg RDL) is the standard gateway before
 *     glute-ham raises and eccentric Nordics.
 *
 * Pure module. No I/O, no DB, no React.
 */
import type { BwProgress, MovementFamily, MovementNode } from "@hta/db";
import type { SessionModality } from "./session-modality";

/**
 * The five hinge nodes the seed catalog ships (see
 * `packages/db/seeds/bw-movement-nodes.ts` — family === "hinge").
 * The compensation generator branches on the user's current node so
 * the prescription matches what they can already do cleanly.
 */
type HingeNodeKey =
  | "hip_hinge"
  | "single_leg_rdl_bw"
  | "glute_ham_raise_assisted"
  | "nordic_curl_eccentric"
  | "nordic_curl_concentric";

export type HingeCompensationMovement = {
  nodeKey: HingeNodeKey;
  prescriptionType: "isometric_hold" | "tempo_reps" | "reps";
  sets: number;
  reps?: number;
  holdSeconds?: number;
  tempoEccentricSec: number;
  targetRir: number;
  intensityCue: string;
};

export type HingeCompensationReason =
  | "skip_already_covered"
  | "recovery_day"
  | "acknowledged_gap"
  | "no_progress_state";

export type HingeCompensation = {
  inject: boolean;
  movement?: HingeCompensationMovement;
  reason: HingeCompensationReason;
};

/**
 * Per-node base prescription. Reasons live in the JSDoc on the call
 * site (the spec); this table is the matrix.
 *
 *   - hip_hinge (8): entry-level tempo work; load via TUT, not reps.
 *   - single_leg_rdl_bw (22): unilateral balance + slow descent.
 *   - glute_ham_raise_assisted (35): slow-resist + hand-assist on the
 *     concentric — the eccentric is the stimulus per Kongsgaard 2009.
 *   - nordic_curl_eccentric (55): pure eccentric (slow descent) + 90°
 *     isometric brace — Baar 2017 isometric loading hook.
 *   - nordic_curl_concentric (80): full ROM when the user has a
 *     partner / rig; otherwise the eccentric variant stays valid.
 */
const NODE_PRESCRIPTION: Record<HingeNodeKey, HingeCompensationMovement> = {
  hip_hinge: {
    nodeKey: "hip_hinge",
    prescriptionType: "tempo_reps",
    sets: 3,
    reps: 8,
    tempoEccentricSec: 4,
    targetRir: 2,
    intensityCue: "Tempo hip-hinge. Push hips back, hamstrings load.",
  },
  single_leg_rdl_bw: {
    nodeKey: "single_leg_rdl_bw",
    prescriptionType: "tempo_reps",
    sets: 3,
    reps: 8,
    tempoEccentricSec: 4,
    targetRir: 2,
    intensityCue: "Single-leg balance. Slow descent.",
  },
  glute_ham_raise_assisted: {
    nodeKey: "glute_ham_raise_assisted",
    prescriptionType: "tempo_reps",
    sets: 3,
    reps: 6,
    tempoEccentricSec: 5,
    targetRir: 1,
    intensityCue: "Slow-resist the descent. Use hand assistance up.",
  },
  nordic_curl_eccentric: {
    nodeKey: "nordic_curl_eccentric",
    // Eccentric-only + 90° isometric brace — encoded as a slow tempo
    // single rep per set, because the matrix output has to be a single
    // prescription line that MovementFocusView can render.
    prescriptionType: "tempo_reps",
    sets: 4,
    reps: 1,
    tempoEccentricSec: 6,
    targetRir: 1,
    intensityCue: "Eccentric-only. Resist to the floor.",
  },
  nordic_curl_concentric: {
    nodeKey: "nordic_curl_concentric",
    prescriptionType: "tempo_reps",
    sets: 3,
    reps: 5,
    tempoEccentricSec: 4,
    targetRir: 1,
    intensityCue: "Full ROM if you have a partner or rig.",
  },
};

/**
 * Order of difficulty across the hinge DAG — used when the user's
 * current node doesn't exactly match one of the five canonical keys
 * (custom catalogs, future nodes). Falls back to the closest entry
 * by `difficultyAnchor`.
 */
const NODE_BY_ANCHOR: ReadonlyArray<{ key: HingeNodeKey; anchor: number }> = [
  { key: "hip_hinge", anchor: 8 },
  { key: "single_leg_rdl_bw", anchor: 22 },
  { key: "glute_ham_raise_assisted", anchor: 35 },
  { key: "nordic_curl_eccentric", anchor: 55 },
  { key: "nordic_curl_concentric", anchor: 80 },
];

function pickNodeForCurrent(node: MovementNode | null): HingeNodeKey {
  if (!node) return "hip_hinge";
  // Exact match by node_key wins.
  const exact = NODE_BY_ANCHOR.find((row) => row.key === node.nodeKey);
  if (exact) return exact.key;
  // Closest-by-anchor fallback.
  let best: HingeNodeKey = "hip_hinge";
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const row of NODE_BY_ANCHOR) {
    const d = Math.abs(row.anchor - node.difficultyAnchor);
    if (d < bestDelta) {
      bestDelta = d;
      best = row.key;
    }
  }
  return best;
}

/**
 * Apply the deload-week shaping — `weekIndex === 3` softens the bout
 * across the board: one fewer set, +1 RIR, and a quality-over-volume
 * cue. Mirrors the same deload pattern used by `bw-prescription.ts`
 * and `accessory-intensity.ts` so the recovery-week shape is uniform.
 */
function applyDeload(
  base: HingeCompensationMovement,
): HingeCompensationMovement {
  return {
    ...base,
    sets: Math.max(1, base.sets - 1),
    targetRir: base.targetRir + 1,
    intensityCue: "Quality over volume. Stop well short of failure.",
  };
}

/**
 * Decide whether to inject a hinge-compensation accessory into a planned
 * session — and if so, with what prescription.
 *
 * Gates (run in order, first match wins):
 *
 *   1. `hasHingeMovement === true` — the rotation already covered hinge;
 *      skip without injection.
 *   2. The session is restorative or pure Z2 — recovery day, do not
 *      stack more loaded work onto it.
 *   3. `bwProgress` is null — the user hasn't been seeded by the
 *      onboarding assessment; we have no idea where to anchor the
 *      prescription, so skip rather than guess.
 *   4. Otherwise inject. The current-node lookup branches the matrix
 *      between the five canonical hinge nodes; deload week shaping
 *      softens the bout on `weekIndex === 3`.
 *
 * The compensation movement does NOT count toward family rotation —
 * the caller appends it as a regular accessory after the rotation pick
 * has already happened, and the next session's rotation seed still
 * sees the original 3 families' history.
 */
export function maybeInjectHingeCompensation(args: {
  bwProgress: BwProgress | null;
  currentNode: MovementNode | null;
  plannedSession: {
    hasHingeMovement: boolean;
    sessionModality: SessionModality;
    weekIndex: 0 | 1 | 2 | 3;
  };
}): HingeCompensation {
  if (args.plannedSession.hasHingeMovement) {
    return { inject: false, reason: "skip_already_covered" };
  }
  if (
    args.plannedSession.sessionModality === "restorative" ||
    args.plannedSession.sessionModality === "pure_z2_aerobic"
  ) {
    return { inject: false, reason: "recovery_day" };
  }
  if (!args.bwProgress) {
    return { inject: false, reason: "no_progress_state" };
  }

  const nodeKey = pickNodeForCurrent(args.currentNode);
  const base = NODE_PRESCRIPTION[nodeKey];
  const movement =
    args.plannedSession.weekIndex === 3 ? applyDeload(base) : base;

  return {
    inject: true,
    movement,
    reason: "acknowledged_gap",
  };
}

/**
 * Family identity for the compensation movement. The injected item is
 * an accessory in the prescription list but is logically a hinge
 * movement — the settings UI and any future audit consumer can use
 * this constant rather than re-deriving it from the node key.
 */
export const HINGE_COMPENSATION_FAMILY: MovementFamily = "hinge";
