/**
 * Bodyweight progression catalog — 75 nodes across 15 families.
 *
 * Source of truth for movement_nodes. Difficulty anchors are a coarse
 * 1–100 cross-family calibration from the addendum and the Phase 1
 * implementation plan; do not adjust without an accompanying code-
 * comment rationale (constraint from the Phase 1 spec).
 *
 * Prerequisites are referenced by `(family, node_key)`. Within-family
 * prereqs supply only the key; cross-family edges (currently just
 * jumping_muscle_up → pull_v.pull_up) supply both.
 */
import type { MovementFamily } from "../src/schema/movement-nodes";

export type SeedNodeRef = { family: MovementFamily; nodeKey: string };

export type SeedMovementNode = {
  family: MovementFamily;
  nodeKey: string;
  displayName: string;
  /**
   * Each prereq is either a bare node_key (same family) or a fully
   * qualified `{ family, nodeKey }` for cross-family edges.
   */
  prerequisites: Array<string | SeedNodeRef>;
  externalLoadCapable: boolean;
  isometricCapable: boolean;
  unilateral: boolean;
  defaultTempoSeconds: number;
  tutPerRepSeconds: number;
  difficultyAnchor: number;
};

const node = (
  family: MovementFamily,
  nodeKey: string,
  displayName: string,
  difficultyAnchor: number,
  opts: Partial<
    Omit<
      SeedMovementNode,
      "family" | "nodeKey" | "displayName" | "difficultyAnchor"
    >
  > = {},
): SeedMovementNode => ({
  family,
  nodeKey,
  displayName,
  prerequisites: opts.prerequisites ?? [],
  externalLoadCapable: opts.externalLoadCapable ?? false,
  isometricCapable: opts.isometricCapable ?? false,
  unilateral: opts.unilateral ?? false,
  defaultTempoSeconds: opts.defaultTempoSeconds ?? 4,
  tutPerRepSeconds: opts.tutPerRepSeconds ?? 4,
  difficultyAnchor,
});

export const BW_MOVEMENT_NODES: SeedMovementNode[] = [
  // ── push_h ────────────────────────────────────────────────── 8
  node("push_h", "wall_push_up", "Wall push-up", 5),
  node("push_h", "counter_push_up", "Counter push-up", 10, {
    prerequisites: ["wall_push_up"],
  }),
  node("push_h", "knee_push_up", "Knee push-up", 18, {
    prerequisites: ["counter_push_up"],
  }),
  node("push_h", "push_up", "Push-up", 28, {
    prerequisites: ["knee_push_up"],
    externalLoadCapable: true,
  }),
  node("push_h", "decline_push_up", "Decline push-up", 38, {
    prerequisites: ["push_up"],
    externalLoadCapable: true,
  }),
  node("push_h", "diamond_push_up", "Diamond push-up", 42, {
    prerequisites: ["push_up"],
    externalLoadCapable: true,
  }),
  node("push_h", "archer_push_up", "Archer push-up", 55, {
    prerequisites: ["decline_push_up"],
    unilateral: true,
    tutPerRepSeconds: 5,
  }),
  node("push_h", "one_arm_push_up", "One-arm push-up", 75, {
    prerequisites: ["archer_push_up"],
    unilateral: true,
    tutPerRepSeconds: 6,
  }),

  // ── push_v ────────────────────────────────────────────────── 6
  node("push_v", "pike_push_up", "Pike push-up", 32, {
    tutPerRepSeconds: 4,
  }),
  node("push_v", "wall_walk", "Wall walk", 40, {
    prerequisites: ["pike_push_up"],
    isometricCapable: true,
    defaultTempoSeconds: 6,
    tutPerRepSeconds: 6,
  }),
  node("push_v", "wall_handstand_hold", "Wall handstand hold", 50, {
    prerequisites: ["wall_walk"],
    isometricCapable: true,
    defaultTempoSeconds: 6,
    tutPerRepSeconds: 6,
  }),
  node("push_v", "wall_handstand_push_up", "Wall HSPU", 62, {
    prerequisites: ["wall_handstand_hold"],
    externalLoadCapable: true,
  }),
  node(
    "push_v",
    "freestanding_handstand_hold",
    "Freestanding handstand hold",
    70,
    {
      prerequisites: ["wall_handstand_hold"],
      isometricCapable: true,
      defaultTempoSeconds: 8,
      tutPerRepSeconds: 6,
    },
  ),
  node(
    "push_v",
    "freestanding_handstand_push_up",
    "Freestanding HSPU",
    88,
    {
      prerequisites: ["freestanding_handstand_hold"],
      tutPerRepSeconds: 5,
    },
  ),

  // ── pull_v ────────────────────────────────────────────────── 8
  node("pull_v", "dead_hang", "Dead hang", 8, {
    isometricCapable: true,
    defaultTempoSeconds: 6,
    tutPerRepSeconds: 6,
  }),
  node("pull_v", "scapular_pull", "Scapular pull", 12, {
    prerequisites: ["dead_hang"],
    tutPerRepSeconds: 3,
  }),
  node("pull_v", "band_assisted_pull_up", "Band-assisted pull-up", 20, {
    prerequisites: ["scapular_pull"],
  }),
  node("pull_v", "negative_pull_up", "Negative pull-up", 25, {
    prerequisites: ["scapular_pull"],
    tutPerRepSeconds: 5,
  }),
  node("pull_v", "pull_up", "Strict pull-up", 35, {
    prerequisites: ["negative_pull_up"],
    externalLoadCapable: true,
  }),
  node("pull_v", "wide_pull_up", "Wide-grip pull-up", 45, {
    prerequisites: ["pull_up"],
    externalLoadCapable: true,
  }),
  node("pull_v", "archer_pull_up", "Archer pull-up", 60, {
    prerequisites: ["wide_pull_up"],
    unilateral: true,
    tutPerRepSeconds: 5,
  }),
  node("pull_v", "one_arm_pull_up", "One-arm pull-up", 90, {
    prerequisites: ["archer_pull_up"],
    unilateral: true,
    tutPerRepSeconds: 6,
  }),

  // ── pull_h ────────────────────────────────────────────────── 5
  node("pull_h", "inverted_row", "Inverted row", 18, {
    externalLoadCapable: true,
  }),
  node("pull_h", "feet_elevated_row", "Feet-elevated inverted row", 28, {
    prerequisites: ["inverted_row"],
    externalLoadCapable: true,
  }),
  node("pull_h", "archer_row", "Archer row", 42, {
    prerequisites: ["feet_elevated_row"],
    unilateral: true,
    tutPerRepSeconds: 5,
  }),
  node("pull_h", "one_arm_inverted_row", "One-arm inverted row", 55, {
    prerequisites: ["archer_row"],
    unilateral: true,
    tutPerRepSeconds: 5,
  }),
  node("pull_h", "ring_row_strict", "Ring row (strict, feet elevated)", 38, {
    prerequisites: ["feet_elevated_row"],
    tutPerRepSeconds: 5,
  }),

  // ── squat_unilateral ──────────────────────────────────────── 6
  node("squat_unilateral", "split_squat", "Split squat", 22, {
    externalLoadCapable: true,
    unilateral: true,
  }),
  node("squat_unilateral", "bulgarian_split_squat", "Bulgarian split squat", 32, {
    prerequisites: ["split_squat"],
    externalLoadCapable: true,
    unilateral: true,
  }),
  node("squat_unilateral", "shrimp_squat", "Shrimp squat", 50, {
    prerequisites: ["bulgarian_split_squat"],
    unilateral: true,
    tutPerRepSeconds: 5,
  }),
  node("squat_unilateral", "assisted_pistol", "Assisted pistol squat", 45, {
    prerequisites: ["bulgarian_split_squat"],
    unilateral: true,
    tutPerRepSeconds: 5,
  }),
  node("squat_unilateral", "strict_pistol", "Strict pistol squat", 65, {
    prerequisites: ["assisted_pistol"],
    externalLoadCapable: true,
    unilateral: true,
    tutPerRepSeconds: 5,
  }),
  node("squat_unilateral", "shrimp_pistol", "Shrimp pistol", 78, {
    prerequisites: ["strict_pistol"],
    unilateral: true,
    tutPerRepSeconds: 6,
  }),

  // ── squat_bilateral ───────────────────────────────────────── 4
  node("squat_bilateral", "bw_squat", "Bodyweight squat", 12, {
    externalLoadCapable: true,
    defaultTempoSeconds: 3,
    tutPerRepSeconds: 3,
  }),
  node("squat_bilateral", "deficit_squat", "Deficit squat", 20, {
    prerequisites: ["bw_squat"],
    externalLoadCapable: true,
  }),
  node("squat_bilateral", "jump_squat", "Jump squat", 28, {
    prerequisites: ["bw_squat"],
    defaultTempoSeconds: 2,
    tutPerRepSeconds: 2,
  }),
  node("squat_bilateral", "sissy_squat", "Sissy squat", 38, {
    prerequisites: ["bw_squat"],
    externalLoadCapable: true,
    tutPerRepSeconds: 5,
  }),

  // ── hinge ─────────────────────────────────────────────────── 5
  node("hinge", "hip_hinge", "Hip hinge drill", 8),
  node("hinge", "single_leg_rdl_bw", "Single-leg RDL (bodyweight)", 22, {
    prerequisites: ["hip_hinge"],
    externalLoadCapable: true,
    unilateral: true,
  }),
  node("hinge", "glute_ham_raise_assisted", "Glute-ham raise (assisted)", 35, {
    prerequisites: ["hip_hinge"],
    tutPerRepSeconds: 5,
  }),
  node("hinge", "nordic_curl_eccentric", "Nordic curl (eccentric only)", 55, {
    prerequisites: ["glute_ham_raise_assisted"],
    defaultTempoSeconds: 5,
    tutPerRepSeconds: 6,
  }),
  node("hinge", "nordic_curl_concentric", "Nordic curl (full ROM)", 80, {
    prerequisites: ["nordic_curl_eccentric"],
    externalLoadCapable: true,
    tutPerRepSeconds: 6,
  }),

  // ── planche ───────────────────────────────────────────────── 6
  node("planche", "planche_lean", "Planche lean", 35, {
    isometricCapable: true,
    defaultTempoSeconds: 6,
    tutPerRepSeconds: 6,
  }),
  node("planche", "tuck_planche", "Tuck planche hold", 50, {
    prerequisites: ["planche_lean"],
    isometricCapable: true,
    defaultTempoSeconds: 6,
    tutPerRepSeconds: 6,
  }),
  node("planche", "advanced_tuck_planche", "Advanced tuck planche", 65, {
    prerequisites: ["tuck_planche"],
    isometricCapable: true,
    defaultTempoSeconds: 8,
    tutPerRepSeconds: 8,
  }),
  node("planche", "straddle_planche", "Straddle planche", 82, {
    prerequisites: ["advanced_tuck_planche"],
    isometricCapable: true,
    defaultTempoSeconds: 8,
    tutPerRepSeconds: 8,
  }),
  node("planche", "full_planche", "Full planche", 95, {
    prerequisites: ["straddle_planche"],
    isometricCapable: true,
    defaultTempoSeconds: 8,
    tutPerRepSeconds: 8,
  }),
  node("planche", "one_arm_planche", "One-arm planche", 100, {
    prerequisites: ["full_planche"],
    isometricCapable: true,
    unilateral: true,
    defaultTempoSeconds: 10,
    tutPerRepSeconds: 10,
  }),

  // ── lever_front ───────────────────────────────────────────── 5
  node("lever_front", "tuck_front_lever", "Tuck front lever", 40, {
    isometricCapable: true,
    defaultTempoSeconds: 6,
    tutPerRepSeconds: 6,
  }),
  node(
    "lever_front",
    "advanced_tuck_front_lever",
    "Advanced tuck front lever",
    55,
    {
      prerequisites: ["tuck_front_lever"],
      isometricCapable: true,
      defaultTempoSeconds: 8,
      tutPerRepSeconds: 8,
    },
  ),
  node("lever_front", "straddle_front_lever", "Straddle front lever", 72, {
    prerequisites: ["advanced_tuck_front_lever"],
    isometricCapable: true,
    defaultTempoSeconds: 8,
    tutPerRepSeconds: 8,
  }),
  node("lever_front", "half_front_lever", "Half front lever", 82, {
    prerequisites: ["straddle_front_lever"],
    isometricCapable: true,
    defaultTempoSeconds: 8,
    tutPerRepSeconds: 8,
  }),
  node("lever_front", "full_front_lever", "Full front lever", 92, {
    prerequisites: ["half_front_lever"],
    isometricCapable: true,
    defaultTempoSeconds: 8,
    tutPerRepSeconds: 8,
  }),

  // ── lever_back ────────────────────────────────────────────── 4
  node("lever_back", "tuck_back_lever", "Tuck back lever", 38, {
    isometricCapable: true,
    defaultTempoSeconds: 6,
    tutPerRepSeconds: 6,
  }),
  node("lever_back", "straddle_back_lever", "Straddle back lever", 58, {
    prerequisites: ["tuck_back_lever"],
    isometricCapable: true,
    defaultTempoSeconds: 8,
    tutPerRepSeconds: 8,
  }),
  node("lever_back", "full_back_lever", "Full back lever", 78, {
    prerequisites: ["straddle_back_lever"],
    isometricCapable: true,
    defaultTempoSeconds: 8,
    tutPerRepSeconds: 8,
  }),
  node("lever_back", "one_arm_back_lever", "One-arm back lever", 95, {
    prerequisites: ["full_back_lever"],
    isometricCapable: true,
    unilateral: true,
    defaultTempoSeconds: 10,
    tutPerRepSeconds: 10,
  }),

  // ── muscle_up ─────────────────────────────────────────────── 3
  node("muscle_up", "jumping_muscle_up", "Jumping muscle-up", 50, {
    prerequisites: [{ family: "pull_v", nodeKey: "pull_up" }],
    defaultTempoSeconds: 3,
    tutPerRepSeconds: 3,
  }),
  node("muscle_up", "explosive_muscle_up", "Explosive muscle-up", 65, {
    prerequisites: ["jumping_muscle_up"],
    defaultTempoSeconds: 3,
    tutPerRepSeconds: 3,
  }),
  node("muscle_up", "strict_muscle_up", "Strict muscle-up", 80, {
    prerequisites: ["explosive_muscle_up"],
    externalLoadCapable: true,
  }),

  // ── handstand ─────────────────────────────────────────────── 4
  node("handstand", "pike_handstand_hold", "Pike handstand (hands on floor)", 22, {
    isometricCapable: true,
    defaultTempoSeconds: 5,
    tutPerRepSeconds: 5,
  }),
  node("handstand", "wall_handstand_walk_in", "Wall walk to handstand", 32, {
    prerequisites: ["pike_handstand_hold"],
    isometricCapable: true,
    defaultTempoSeconds: 5,
    tutPerRepSeconds: 5,
  }),
  node(
    "handstand",
    "freestanding_handstand_kick_up",
    "Freestanding handstand kick-up",
    50,
    {
      prerequisites: ["wall_handstand_walk_in"],
      isometricCapable: true,
      defaultTempoSeconds: 6,
      tutPerRepSeconds: 6,
    },
  ),
  node("handstand", "freestanding_handstand_press", "Handstand press", 75, {
    prerequisites: ["freestanding_handstand_kick_up"],
    defaultTempoSeconds: 5,
    tutPerRepSeconds: 5,
  }),

  // ── human_flag ────────────────────────────────────────────── 3
  node("human_flag", "clutch_flag", "Clutch flag", 50, {
    isometricCapable: true,
    defaultTempoSeconds: 6,
    tutPerRepSeconds: 6,
  }),
  node("human_flag", "vertical_flag", "Vertical flag", 65, {
    prerequisites: ["clutch_flag"],
    isometricCapable: true,
    defaultTempoSeconds: 8,
    tutPerRepSeconds: 8,
  }),
  node("human_flag", "horizontal_flag", "Horizontal flag", 88, {
    prerequisites: ["vertical_flag"],
    isometricCapable: true,
    defaultTempoSeconds: 10,
    tutPerRepSeconds: 10,
  }),

  // ── core_anti_flexion ─────────────────────────────────────── 4
  node("core_anti_flexion", "dead_bug", "Dead bug", 10),
  node("core_anti_flexion", "plank", "Plank", 18, {
    prerequisites: ["dead_bug"],
    isometricCapable: true,
  }),
  node("core_anti_flexion", "hollow_body_hold", "Hollow body hold", 32, {
    prerequisites: ["plank"],
    isometricCapable: true,
    defaultTempoSeconds: 6,
    tutPerRepSeconds: 6,
  }),
  node("core_anti_flexion", "dragon_flag", "Dragon flag", 60, {
    prerequisites: ["hollow_body_hold"],
    defaultTempoSeconds: 5,
    tutPerRepSeconds: 6,
  }),

  // ── core_anti_rotation ────────────────────────────────────── 3
  node("core_anti_rotation", "side_plank", "Side plank", 18, {
    isometricCapable: true,
    unilateral: true,
  }),
  node("core_anti_rotation", "pallof_press_bw", "Pallof press (bodyweight)", 25, {
    prerequisites: ["side_plank"],
  }),
  node("core_anti_rotation", "windmill_bw", "Windmill (bodyweight)", 38, {
    prerequisites: ["pallof_press_bw"],
    unilateral: true,
    tutPerRepSeconds: 5,
  }),

  // ── L-sit bonus (skill-chip in core_anti_flexion) ─────────── 1
  node("core_anti_flexion", "l_sit", "L-sit", 42, {
    prerequisites: ["hollow_body_hold"],
    isometricCapable: true,
    defaultTempoSeconds: 6,
    tutPerRepSeconds: 6,
  }),
];

export const BW_MOVEMENT_NODE_COUNT = BW_MOVEMENT_NODES.length;
