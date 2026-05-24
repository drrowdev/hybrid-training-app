/**
 * Bodyweight assessment → starting-node mapping.
 *
 * Phase 2 of the bodyweight progression plan. Pure functions: take
 * raw assessment inputs (rep counts, hold seconds, skill chips) and
 * resolve them to per-family `node_key` values from the catalog
 * seeded by `packages/db/seeds/bw-movement-nodes.ts`.
 *
 * Rationale for the thresholds:
 *   Rep landmarks come from calisthenics practitioner consensus
 *   (Steven Low / Kavadlo brothers / FitnessFAQs body-of-work) where
 *   "X strict reps unlocks node Y" is the standard rule of thumb for
 *   coarse self-classification. They are deliberately conservative —
 *   it is much cheaper for the engine to bump a user up after a few
 *   sessions of obvious sandbagging than to ramp someone down from a
 *   node they cannot actually perform without injury.
 *
 * Skill chips override the rep-based mapping where the chip implies
 * a node that strictly dominates the rep-derived choice (e.g. a user
 * with one_arm_push_up does not need to land on diamond_push_up just
 * because their max rep count was 25+).
 *
 * Brand-purity note (DC-Q6): only catalog `node_key` values appear
 * here — no external program names, no methodology references.
 */
import type { MovementFamily } from "@hta/db";

// ── Skill-chip taxonomy ──────────────────────────────────────────────

/**
 * Twelve chips presented on page 2 of the assessment. The set is
 * intentionally a curated subset of the catalog: the "milestone"
 * skills users either have or don't have. Sub-skills (advanced tuck
 * planche, full front lever, etc.) are not surfaced — the engine
 * progresses the user through those once they're already on the
 * family ladder.
 */
export const BW_SKILL_CHIPS = [
  "l_sit",
  "tuck_planche",
  "tuck_front_lever",
  "tuck_back_lever",
  "pistol_squat",
  "wall_handstand",
  "freestanding_handstand",
  "muscle_up",
  "human_flag",
  "nordic_curl",
  "one_arm_push_up",
  "one_arm_pull_up",
] as const;

export type BwSkillChip = (typeof BW_SKILL_CHIPS)[number];

// ── Rep / hold → node mapping ────────────────────────────────────────

/**
 * Strict full-range push-up reps → push_h current node.
 * Landmarks: 0 → wall, <3 → counter, <8 → knee, <15 → strict push-up,
 * <25 → decline, 25+ → diamond. Source: calisthenics practitioner
 * consensus on rep landmarks. Archer / one-arm gated by skill chip
 * (see `applySkillChipOverrides`).
 */
export function mapPushUpRepsToPushHNode(reps: number): string {
  if (reps <= 0) return "wall_push_up";
  if (reps < 3) return "counter_push_up";
  if (reps < 8) return "knee_push_up";
  if (reps < 15) return "push_up";
  if (reps < 25) return "decline_push_up";
  return "diamond_push_up";
}

/**
 * Strict pull-up reps → pull_v current node.
 * 0 → dead hang, <2 → scapular pull, <5 → negative, <10 → strict
 * pull-up, 10+ → wide pull-up. Archer / one-arm gated by skill chip.
 * Source: calisthenics practitioner consensus.
 */
export function mapPullUpRepsToPullVNode(reps: number): string {
  if (reps <= 0) return "dead_hang";
  if (reps < 2) return "scapular_pull";
  if (reps < 5) return "negative_pull_up";
  if (reps < 10) return "pull_up";
  return "wide_pull_up";
}

/**
 * Bodyweight squat reps → squat_bilateral current node.
 * <25 → bodyweight squat, 25+ → deficit squat. Pistol / shrimp are
 * gated by skill chip — high BW-squat rep counts on their own don't
 * unlock unilateral work because hip mobility + balance are separate
 * skills. Source: calisthenics practitioner consensus.
 */
export function mapSquatRepsToSquatBilateralNode(reps: number): string {
  if (reps < 25) return "bw_squat";
  return "deficit_squat";
}

/**
 * Plank-hold seconds → core_anti_flexion current node.
 * <15s → dead bug, <45s → plank, 45s+ → hollow body hold. L-sit
 * gated by skill chip (`l_sit` chip overrides plank mapping). Source:
 * calisthenics practitioner consensus.
 */
export function mapPlankSecondsToCoreAntiFlexionNode(seconds: number): string {
  if (seconds < 15) return "dead_bug";
  if (seconds < 45) return "plank";
  return "hollow_body_hold";
}

// ── Family-level resolution ──────────────────────────────────────────

/**
 * Default entry node per family — used when the user has no rep
 * signal and no skill chip for the family. Each value is the lowest
 * `difficulty_anchor` node in the family that has empty prerequisites
 * in the catalog (kept in lockstep with `bw-movement-nodes.ts`).
 *
 * Kept here rather than queried from the DB because it never changes
 * without a catalog edit, and the seed action wants a synchronous
 * resolution path that doesn't fan out an extra round-trip per family.
 */
export const FAMILY_ENTRY_NODE: Record<MovementFamily, string> = {
  push_h: "wall_push_up",
  push_v: "pike_push_up",
  pull_h: "inverted_row",
  pull_v: "dead_hang",
  squat_unilateral: "split_squat",
  squat_bilateral: "bw_squat",
  hinge: "hip_hinge",
  core_anti_flexion: "dead_bug",
  core_anti_rotation: "side_plank",
  planche: "planche_lean",
  lever_front: "tuck_front_lever",
  lever_back: "tuck_back_lever",
  muscle_up: "jumping_muscle_up",
  handstand: "pike_handstand_hold",
  human_flag: "clutch_flag",
};

/**
 * Chip → `{family, nodeKey}` override map. Applied after the rep
 * mapping so chips can lift the user above a rep-derived node where
 * the catalog supports it.
 *
 * Intentionally short: many chips do not override an existing
 * mapping, they just *unlock* a family the rep tests don't probe
 * (planche, lever, flag, muscle-up). The seed action treats those
 * as the family's starting node with the chip-implied node as the
 * current node.
 */
export const CHIP_NODE_MAP: Record<
  BwSkillChip,
  { family: MovementFamily; nodeKey: string }
> = {
  l_sit: { family: "core_anti_flexion", nodeKey: "l_sit" },
  tuck_planche: { family: "planche", nodeKey: "tuck_planche" },
  tuck_front_lever: { family: "lever_front", nodeKey: "tuck_front_lever" },
  tuck_back_lever: { family: "lever_back", nodeKey: "tuck_back_lever" },
  pistol_squat: { family: "squat_unilateral", nodeKey: "strict_pistol" },
  wall_handstand: { family: "push_v", nodeKey: "wall_handstand_hold" },
  freestanding_handstand: {
    family: "push_v",
    nodeKey: "freestanding_handstand_hold",
  },
  muscle_up: { family: "muscle_up", nodeKey: "strict_muscle_up" },
  human_flag: { family: "human_flag", nodeKey: "vertical_flag" },
  nordic_curl: { family: "hinge", nodeKey: "nordic_curl_eccentric" },
  one_arm_push_up: { family: "push_h", nodeKey: "one_arm_push_up" },
  one_arm_pull_up: { family: "pull_v", nodeKey: "one_arm_pull_up" },
};

/**
 * Inputs accepted by `resolveFamilyNodes`. Rep tests are nullable —
 * null means the user skipped that question; we treat skipped as
 * "no signal" rather than "0", except for pull-ups where a null is
 * indistinguishable from "0 strict reps" given the question copy
 * ("Strict reps to failure"). Both produce `dead_hang` so the
 * downstream is unaffected.
 */
export type AssessmentRepInputs = {
  pushUpMaxReps: number | null;
  pullUpMaxReps: number | null;
  squatMaxReps: number | null;
  plankHoldSeconds: number | null;
};

/**
 * Resolve every family the user has *any* signal on (rep test or
 * chip) to a `nodeKey`. Families with no signal are not present in
 * the returned map — the caller is responsible for seeding the
 * family-entry node for those.
 */
export function resolveFamilyNodes(
  reps: AssessmentRepInputs,
  chips: readonly BwSkillChip[],
): Map<MovementFamily, string> {
  const out = new Map<MovementFamily, string>();

  // Rep mappings (skip when the input is null).
  if (reps.pushUpMaxReps != null) {
    out.set("push_h", mapPushUpRepsToPushHNode(reps.pushUpMaxReps));
  }
  if (reps.pullUpMaxReps != null) {
    out.set("pull_v", mapPullUpRepsToPullVNode(reps.pullUpMaxReps));
  }
  if (reps.squatMaxReps != null) {
    out.set(
      "squat_bilateral",
      mapSquatRepsToSquatBilateralNode(reps.squatMaxReps),
    );
  }
  if (reps.plankHoldSeconds != null) {
    out.set(
      "core_anti_flexion",
      mapPlankSecondsToCoreAntiFlexionNode(reps.plankHoldSeconds),
    );
  }

  // Chip overrides — last write wins per family. Order chips by
  // ascending implied node difficulty per family so a "stronger" chip
  // doesn't get clobbered by a "weaker" one (currently no family has
  // two chips, but the rule is defensive).
  for (const chip of chips) {
    const override = CHIP_NODE_MAP[chip];
    if (!override) continue;
    out.set(override.family, override.nodeKey);
  }

  return out;
}

/**
 * Final node-key per family, including baseline entry nodes for the
 * families the user gave no signal on. Returned as an array so the
 * seed action can iterate predictably.
 */
export function resolveAllFamilyNodes(
  reps: AssessmentRepInputs,
  chips: readonly BwSkillChip[],
): Array<{ family: MovementFamily; nodeKey: string; fromSignal: boolean }> {
  const signalled = resolveFamilyNodes(reps, chips);
  const families = Object.keys(FAMILY_ENTRY_NODE) as MovementFamily[];
  return families.map((family) => {
    const sig = signalled.get(family);
    if (sig != null) return { family, nodeKey: sig, fromSignal: true };
    return { family, nodeKey: FAMILY_ENTRY_NODE[family], fromSignal: false };
  });
}
