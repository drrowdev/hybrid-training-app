/**
 * Bodyweight leverage-equivalent multipliers per movement node.
 *
 * Why this exists
 * ───────────────
 * The barbell engine prescribes loaded sets as a percent of training-max.
 * Bodyweight users don't have a TM — but Phase 7 needs to put loaded BW
 * work on the same axis as barbell work (so a weighted pull-up can be
 * stress-budgeted alongside a back squat). The bridge is the
 * leverage-equivalent multiplier: roughly, "what fraction of body mass
 * does this variant load?"
 *
 *   effectiveTM_kg = bodyweight_kg × bwMultiplier(node) + externalLoad_kg
 *
 * Source: calisthenics practitioner consensus on relative-strength
 * comparisons (pull-up ≈ 1 BW, archer ≈ 1.4 BW, one-arm ≈ 2 BW). The
 * numbers below are intentionally rough — they exist for stress
 * budgeting, NOT precise load math. The DAG node + the user's clean
 * rep history remain the source of truth for "what to prescribe."
 *
 * Pure module. No I/O. No DB. No React.
 */
import type { MovementNode } from "@hta/db";

/**
 * Per-node leverage-equivalent multiplier. Multiplies the user's body
 * mass to estimate the effective load lifted by the movement. Nodes not
 * in the table (skill / isometric / progression holds without a clean
 * load story) return 0 — caller treats that as "do not synthesise an
 * effective TM for stress accounting."
 *
 * Calibration: ratios agreed across multiple calisthenics-coaching
 * references treated as practitioner consensus (the "Beast Skills /
 * Overcoming Gravity" body of community knowledge — never cited by
 * brand per DC-Q6). Push family tops out at ~1.7 BW (one-arm push-up),
 * pull family tops out at ~2.0 BW (one-arm pull-up). Hinge nordic
 * concentric anchors high because there's no comparable hamstring lift
 * that loads the knee flexors against full body lever-arm.
 */
export function bwMultiplier(node: MovementNode): number {
  // Push family (push_h)
  if (node.nodeKey === "wall_push_up") return 0.2;
  if (node.nodeKey === "counter_push_up") return 0.4;
  if (node.nodeKey === "knee_push_up") return 0.5;
  if (node.nodeKey === "push_up") return 0.65;
  if (node.nodeKey === "decline_push_up") return 0.75;
  if (node.nodeKey === "diamond_push_up") return 0.8;
  if (node.nodeKey === "archer_push_up") return 1.2;
  if (node.nodeKey === "one_arm_push_up") return 1.7;
  // Pull family (pull_v)
  if (node.nodeKey === "pull_up") return 1.0;
  if (node.nodeKey === "wide_pull_up") return 1.1;
  if (node.nodeKey === "archer_pull_up") return 1.4;
  if (node.nodeKey === "one_arm_pull_up") return 2.0;
  // Row family (pull_h)
  if (node.nodeKey === "inverted_row") return 0.5;
  if (node.nodeKey === "feet_elevated_row") return 0.7;
  if (node.nodeKey === "archer_row") return 1.0;
  if (node.nodeKey === "one_arm_inverted_row") return 1.3;
  if (node.nodeKey === "ring_row_strict") return 0.8;
  // Vertical press / handstand (push_v)
  if (node.nodeKey === "wall_handstand_push_up") return 1.0;
  if (node.nodeKey === "freestanding_handstand_push_up") return 1.4;
  if (node.nodeKey === "pike_push_up") return 0.6;
  // Squat — bilateral
  if (node.nodeKey === "bw_squat") return 0.5;
  if (node.nodeKey === "deficit_squat") return 0.6;
  if (node.nodeKey === "jump_squat") return 0.7;
  if (node.nodeKey === "sissy_squat") return 0.9;
  // Squat — unilateral
  if (node.nodeKey === "split_squat") return 0.7;
  if (node.nodeKey === "bulgarian_split_squat") return 1.0;
  if (node.nodeKey === "shrimp_squat") return 1.3;
  if (node.nodeKey === "assisted_pistol") return 1.0;
  if (node.nodeKey === "strict_pistol") return 1.3;
  if (node.nodeKey === "shrimp_pistol") return 1.6;
  // Hinge
  if (node.nodeKey === "single_leg_rdl_bw") return 0.7;
  if (node.nodeKey === "nordic_curl_concentric") return 1.5;
  // Muscle-up
  if (node.nodeKey === "strict_muscle_up") return 1.4;
  // Fallback — skill / isometric / unmapped nodes get 0 (no synthetic
  // TM contribution).
  return 0.0;
}

/**
 * Effective training-max in kg for a loadable BW node. Bridges
 * bodyweight work into the same TM model the barbell stress engine
 * already consumes (see `lib/engine/tm-anchored-pr.ts` etc.).
 *
 * Returns 0 when the node has no multiplier — caller treats that as
 * "not bridgeable" and falls back to the node-DAG progression path.
 *
 * Negative `externalLoadKg` (band-assist on sub-pull-up nodes) is
 * allowed; the final value is clamped at 0 so we never emit a
 * negative TM.
 */
export function effectiveTrainingMaxKg(args: {
  node: MovementNode;
  userBodyweightKg: number;
  externalLoadKg: number;
}): number {
  const mult = bwMultiplier(args.node);
  if (mult === 0) return 0;
  const raw = args.userBodyweightKg * mult + args.externalLoadKg;
  return raw > 0 ? raw : 0;
}
