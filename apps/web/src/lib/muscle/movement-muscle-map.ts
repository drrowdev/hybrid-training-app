/**
 * Movement slug → muscle-group weighted map + cardio modality map.
 *
 * Two roles:
 *
 *   1. **Static slug overrides** (`MOVEMENT_MUSCLE_MAP`). For the
 *      common compound + accessory lifts called out in the spec we
 *      record the muscle fanout explicitly with weights — primary 1.0,
 *      secondary 0.5, tertiary 0.25 — so the freshness math doesn't
 *      depend on whatever `primary_muscles` / `secondary_muscles` the
 *      seeded `movements` row carries.
 *
 *   2. **DB-driven fallback** (`muscleFanoutFromMovementRow`). For any
 *      movement not in the static map, fan out from the catalog
 *      columns: primary_muscles → weight 1.0, secondary_muscles →
 *      weight 0.5, collapsed through MUSCLE_FROM_DB_ENUM.
 *
 * Cardio modality fanout (`CARDIO_MODALITY_MAP`) covers the modality
 * column on `cardio_logs` — interval runs colour Quads/Hamstrings/
 * Glutes/Calves, rowing colours Lats/Back/Shoulders, padel colours
 * Shoulders/Obliques, etc. Multipliers reflect how much load that
 * modality dumps on each muscle relative to a typical strength set.
 */

import { ALL_MUSCLE_GROUPS, MUSCLE_FROM_DB_ENUM, type MuscleGroup } from "./muscle-groups";

export type MuscleWeight = { muscle: MuscleGroup; weight: number };

/**
 * Static slug → weighted muscle fanout.
 *
 * Coverage targets the user's catalog (see packages/db/seeds/movements*.ts).
 * Anything missing here falls through to muscleFanoutFromMovementRow
 * below, which derives from the catalog's `primary_muscles` columns.
 */
export const MOVEMENT_MUSCLE_MAP: Record<string, MuscleWeight[]> = {
  // ── Squat family ─────────────────────────────────────────────────
  "back-squat-low-bar": [
    { muscle: "quads", weight: 1.0 },
    { muscle: "glutes", weight: 1.0 },
    { muscle: "erectors", weight: 0.5 },
    { muscle: "core", weight: 0.25 },
    { muscle: "hamstrings", weight: 0.25 },
  ],
  "back-squat-high-bar": [
    { muscle: "quads", weight: 1.0 },
    { muscle: "glutes", weight: 1.0 },
    { muscle: "erectors", weight: 0.5 },
    { muscle: "core", weight: 0.25 },
    { muscle: "hamstrings", weight: 0.25 },
  ],
  "front-squat": [
    { muscle: "quads", weight: 1.0 },
    { muscle: "glutes", weight: 0.5 },
    { muscle: "core", weight: 0.5 },
    { muscle: "erectors", weight: 0.5 },
  ],
  "goblet-squat": [
    { muscle: "quads", weight: 1.0 },
    { muscle: "glutes", weight: 0.5 },
    { muscle: "core", weight: 0.25 },
  ],
  "bulgarian-split-squat-bb": [
    { muscle: "quads", weight: 1.0 },
    { muscle: "glutes", weight: 1.0 },
    { muscle: "adductors", weight: 0.25 },
  ],
  "bulgarian-split-squat-db": [
    { muscle: "quads", weight: 1.0 },
    { muscle: "glutes", weight: 1.0 },
    { muscle: "adductors", weight: 0.25 },
  ],
  // One dumbbell instead of two: the lateral trunk holds the offset load, so
  // obliques earn a tertiary share the symmetrical version doesn't have.
  "bulgarian-split-squat-db-single-arm": [
    { muscle: "quads", weight: 1.0 },
    { muscle: "glutes", weight: 1.0 },
    { muscle: "adductors", weight: 0.25 },
    { muscle: "obliques", weight: 0.25 },
  ],
  "split-squat-bb": [
    { muscle: "quads", weight: 1.0 },
    { muscle: "glutes", weight: 0.5 },
  ],
  "split-squat-db": [
    { muscle: "quads", weight: 1.0 },
    { muscle: "glutes", weight: 0.5 },
  ],
  "leg-press-45": [
    { muscle: "quads", weight: 1.0 },
    { muscle: "glutes", weight: 0.5 },
    { muscle: "hamstrings", weight: 0.25 },
  ],
  "hack-squat": [
    { muscle: "quads", weight: 1.0 },
    { muscle: "glutes", weight: 0.5 },
  ],
  lunge: [
    { muscle: "quads", weight: 1.0 },
    { muscle: "glutes", weight: 1.0 },
  ],
  "walking-lunge": [
    { muscle: "quads", weight: 1.0 },
    { muscle: "glutes", weight: 1.0 },
    { muscle: "hamstrings", weight: 0.25 },
    { muscle: "core", weight: 0.25 },
  ],
  "walking-lunge-db": [
    { muscle: "quads", weight: 1.0 },
    { muscle: "glutes", weight: 1.0 },
    { muscle: "hamstrings", weight: 0.25 },
    { muscle: "core", weight: 0.25 },
  ],
  "walking-lunge-bb": [
    { muscle: "quads", weight: 1.0 },
    { muscle: "glutes", weight: 1.0 },
    { muscle: "erectors", weight: 0.5 },
    { muscle: "hamstrings", weight: 0.25 },
    { muscle: "core", weight: 0.25 },
  ],
  // Step-ups skip the deep front-knee position, so the quad share is lower
  // than a lunge's and the glute drives the rep.
  "step-up": [
    { muscle: "glutes", weight: 1.0 },
    { muscle: "quads", weight: 0.5 },
    { muscle: "hamstrings", weight: 0.25 },
  ],
  "step-up-db": [
    { muscle: "glutes", weight: 1.0 },
    { muscle: "quads", weight: 0.5 },
    { muscle: "hamstrings", weight: 0.25 },
  ],
  "step-up-bb": [
    { muscle: "glutes", weight: 1.0 },
    { muscle: "quads", weight: 0.5 },
    { muscle: "erectors", weight: 0.5 },
    { muscle: "hamstrings", weight: 0.25 },
  ],
  "curtsy-lunge": [
    { muscle: "glutes", weight: 1.0 },
    { muscle: "quads", weight: 1.0 },
    { muscle: "adductors", weight: 0.25 },
    { muscle: "core", weight: 0.25 },
  ],
  "curtsy-lunge-db": [
    { muscle: "glutes", weight: 1.0 },
    { muscle: "quads", weight: 1.0 },
    { muscle: "adductors", weight: 0.25 },
    { muscle: "core", weight: 0.25 },
  ],
  // The trailing leg's groin is the point of the lateral lunge, so adductors
  // carry a full share rather than the incidental one a forward lunge gets.
  "lateral-lunge": [
    { muscle: "adductors", weight: 1.0 },
    { muscle: "quads", weight: 1.0 },
    { muscle: "glutes", weight: 0.5 },
    { muscle: "hamstrings", weight: 0.25 },
  ],
  "lateral-lunge-db": [
    { muscle: "adductors", weight: 1.0 },
    { muscle: "quads", weight: 1.0 },
    { muscle: "glutes", weight: 0.5 },
    { muscle: "hamstrings", weight: 0.25 },
  ],
  "forward-lunge": [
    { muscle: "quads", weight: 1.0 },
    { muscle: "glutes", weight: 1.0 },
    { muscle: "hamstrings", weight: 0.25 },
    { muscle: "core", weight: 0.25 },
  ],
  "forward-lunge-db": [
    { muscle: "quads", weight: 1.0 },
    { muscle: "glutes", weight: 1.0 },
    { muscle: "hamstrings", weight: 0.25 },
    { muscle: "core", weight: 0.25 },
  ],
  "forward-lunge-bb": [
    { muscle: "quads", weight: 1.0 },
    { muscle: "glutes", weight: 1.0 },
    { muscle: "erectors", weight: 0.5 },
    { muscle: "hamstrings", weight: 0.25 },
    { muscle: "core", weight: 0.25 },
  ],
  // Reverse stepping shifts load toward the hip, so glutes/hamstrings carry
  // more than in the forward step.
  "reverse-lunge": [
    { muscle: "quads", weight: 1.0 },
    { muscle: "glutes", weight: 1.0 },
    { muscle: "hamstrings", weight: 0.5 },
    { muscle: "core", weight: 0.25 },
  ],
  "reverse-lunge-db": [
    { muscle: "quads", weight: 1.0 },
    { muscle: "glutes", weight: 1.0 },
    { muscle: "hamstrings", weight: 0.5 },
    { muscle: "core", weight: 0.25 },
  ],
  "reverse-lunge-bb": [
    { muscle: "quads", weight: 1.0 },
    { muscle: "glutes", weight: 1.0 },
    { muscle: "erectors", weight: 0.5 },
    { muscle: "hamstrings", weight: 0.5 },
    { muscle: "core", weight: 0.25 },
  ],

  // ── Hinge family ─────────────────────────────────────────────────
  "conventional-deadlift": [
    { muscle: "hamstrings", weight: 1.0 },
    { muscle: "glutes", weight: 1.0 },
    { muscle: "erectors", weight: 1.0 },
    { muscle: "back", weight: 0.5 },
    { muscle: "lats", weight: 0.5 },
    { muscle: "traps", weight: 0.5 },
    { muscle: "forearms", weight: 0.25 },
  ],
  "sumo-deadlift": [
    { muscle: "glutes", weight: 1.0 },
    { muscle: "quads", weight: 0.5 },
    { muscle: "hamstrings", weight: 0.5 },
    { muscle: "erectors", weight: 1.0 },
    { muscle: "adductors", weight: 0.5 },
    { muscle: "forearms", weight: 0.25 },
  ],
  "trap-bar-deadlift": [
    { muscle: "glutes", weight: 1.0 },
    { muscle: "quads", weight: 0.5 },
    { muscle: "hamstrings", weight: 0.5 },
    { muscle: "erectors", weight: 0.5 },
    { muscle: "traps", weight: 0.5 },
    { muscle: "forearms", weight: 0.25 },
  ],
  "rdl-bb": [
    { muscle: "hamstrings", weight: 1.0 },
    { muscle: "glutes", weight: 1.0 },
    { muscle: "erectors", weight: 0.5 },
  ],
  "rdl-db": [
    { muscle: "hamstrings", weight: 1.0 },
    { muscle: "glutes", weight: 1.0 },
    { muscle: "erectors", weight: 0.5 },
  ],
  "stiff-leg-deadlift": [
    { muscle: "hamstrings", weight: 1.0 },
    { muscle: "glutes", weight: 0.5 },
    { muscle: "erectors", weight: 0.5 },
  ],
  "good-morning": [
    { muscle: "hamstrings", weight: 1.0 },
    { muscle: "erectors", weight: 1.0 },
    { muscle: "glutes", weight: 0.5 },
  ],
  "hip-thrust-bb": [
    { muscle: "glutes", weight: 1.0 },
    { muscle: "hamstrings", weight: 0.5 },
  ],
  "glute-bridge-bb": [
    { muscle: "glutes", weight: 1.0 },
    { muscle: "hamstrings", weight: 0.25 },
  ],
  "back-extension-45": [
    { muscle: "erectors", weight: 1.0 },
    { muscle: "glutes", weight: 0.5 },
    { muscle: "hamstrings", weight: 0.5 },
  ],
  "back-extension-ghd": [
    { muscle: "erectors", weight: 1.0 },
    { muscle: "glutes", weight: 0.5 },
    { muscle: "hamstrings", weight: 0.5 },
  ],
  "reverse-hyper": [
    { muscle: "glutes", weight: 1.0 },
    { muscle: "hamstrings", weight: 0.5 },
    { muscle: "erectors", weight: 0.5 },
  ],

  // ── Press family ─────────────────────────────────────────────────
  "bench-press-flat": [
    { muscle: "chest", weight: 1.0 },
    { muscle: "triceps", weight: 0.5 },
    { muscle: "shoulders", weight: 0.5 },
  ],
  "bench-press-incline": [
    { muscle: "chest", weight: 1.0 },
    { muscle: "shoulders", weight: 0.5 },
    { muscle: "triceps", weight: 0.5 },
  ],
  "bench-press-decline": [
    { muscle: "chest", weight: 1.0 },
    { muscle: "triceps", weight: 0.5 },
  ],
  "bench-press-paused": [
    { muscle: "chest", weight: 1.0 },
    { muscle: "triceps", weight: 0.5 },
    { muscle: "shoulders", weight: 0.5 },
  ],
  "close-grip-bench": [
    { muscle: "triceps", weight: 1.0 },
    { muscle: "chest", weight: 0.5 },
    { muscle: "shoulders", weight: 0.25 },
  ],
  "db-bench-flat": [
    { muscle: "chest", weight: 1.0 },
    { muscle: "triceps", weight: 0.5 },
    { muscle: "shoulders", weight: 0.5 },
  ],
  "db-bench-incline": [
    { muscle: "chest", weight: 1.0 },
    { muscle: "shoulders", weight: 0.5 },
    { muscle: "triceps", weight: 0.5 },
  ],
  "ohp-standing": [
    { muscle: "shoulders", weight: 1.0 },
    { muscle: "triceps", weight: 0.5 },
    { muscle: "traps", weight: 0.25 },
    { muscle: "core", weight: 0.25 },
  ],
  "ohp-seated": [
    { muscle: "shoulders", weight: 1.0 },
    { muscle: "triceps", weight: 0.5 },
    { muscle: "traps", weight: 0.25 },
  ],
  "push-press": [
    { muscle: "shoulders", weight: 1.0 },
    { muscle: "triceps", weight: 0.5 },
    { muscle: "quads", weight: 0.25 },
    { muscle: "traps", weight: 0.25 },
  ],
  "db-shoulder-press-seated": [
    { muscle: "shoulders", weight: 1.0 },
    { muscle: "triceps", weight: 0.5 },
  ],
  "db-shoulder-press-standing": [
    { muscle: "shoulders", weight: 1.0 },
    { muscle: "triceps", weight: 0.5 },
    { muscle: "core", weight: 0.25 },
  ],
  "dip-parallel": [
    { muscle: "chest", weight: 1.0 },
    { muscle: "triceps", weight: 1.0 },
    { muscle: "shoulders", weight: 0.25 },
  ],
  "dip-bench": [
    { muscle: "triceps", weight: 1.0 },
    { muscle: "chest", weight: 0.5 },
  ],
  "dip-ring": [
    { muscle: "chest", weight: 1.0 },
    { muscle: "triceps", weight: 1.0 },
    { muscle: "shoulders", weight: 0.25 },
  ],
  "push-up": [
    { muscle: "chest", weight: 1.0 },
    { muscle: "triceps", weight: 0.5 },
    { muscle: "shoulders", weight: 0.25 },
    { muscle: "core", weight: 0.25 },
  ],

  // ── Pull family ──────────────────────────────────────────────────
  "pull-up-overhand": [
    { muscle: "lats", weight: 1.0 },
    { muscle: "back", weight: 0.5 },
    { muscle: "biceps", weight: 0.5 },
    { muscle: "forearms", weight: 0.25 },
  ],
  "pull-up-neutral": [
    { muscle: "lats", weight: 1.0 },
    { muscle: "back", weight: 0.5 },
    { muscle: "biceps", weight: 0.5 },
  ],
  "chin-up": [
    { muscle: "lats", weight: 1.0 },
    { muscle: "biceps", weight: 1.0 },
    { muscle: "back", weight: 0.5 },
  ],
  "weighted-pull-up": [
    { muscle: "lats", weight: 1.0 },
    { muscle: "back", weight: 0.5 },
    { muscle: "biceps", weight: 0.5 },
    { muscle: "forearms", weight: 0.25 },
  ],
  "lat-pulldown-wide": [
    { muscle: "lats", weight: 1.0 },
    { muscle: "back", weight: 0.5 },
    { muscle: "biceps", weight: 0.25 },
  ],
  "lat-pulldown-neutral": [
    { muscle: "lats", weight: 1.0 },
    { muscle: "biceps", weight: 0.5 },
    { muscle: "back", weight: 0.5 },
  ],
  "lat-pulldown-narrow": [
    { muscle: "lats", weight: 1.0 },
    { muscle: "biceps", weight: 0.5 },
    { muscle: "back", weight: 0.25 },
  ],
  "bb-row-overhand": [
    { muscle: "back", weight: 1.0 },
    { muscle: "lats", weight: 1.0 },
    { muscle: "biceps", weight: 0.5 },
    { muscle: "erectors", weight: 0.5 },
  ],
  "bb-row-underhand": [
    { muscle: "back", weight: 1.0 },
    { muscle: "lats", weight: 1.0 },
    { muscle: "biceps", weight: 0.5 },
  ],
  "pendlay-row": [
    { muscle: "back", weight: 1.0 },
    { muscle: "lats", weight: 1.0 },
    { muscle: "erectors", weight: 0.5 },
    { muscle: "biceps", weight: 0.5 },
  ],
  "db-row-single-arm": [
    { muscle: "lats", weight: 1.0 },
    { muscle: "back", weight: 1.0 },
    { muscle: "biceps", weight: 0.5 },
  ],
  "cable-row-seated": [
    { muscle: "back", weight: 1.0 },
    { muscle: "lats", weight: 0.5 },
    { muscle: "biceps", weight: 0.5 },
  ],
  "chest-supported-row-db": [
    { muscle: "back", weight: 1.0 },
    { muscle: "lats", weight: 0.5 },
    { muscle: "biceps", weight: 0.5 },
  ],
  "chest-supported-row-machine": [
    { muscle: "back", weight: 1.0 },
    { muscle: "lats", weight: 0.5 },
    { muscle: "biceps", weight: 0.5 },
  ],
  "inverted-row": [
    { muscle: "back", weight: 1.0 },
    { muscle: "lats", weight: 0.5 },
    { muscle: "biceps", weight: 0.5 },
  ],
  "face-pull": [
    { muscle: "shoulders", weight: 1.0 },
    { muscle: "traps", weight: 0.5 },
    { muscle: "back", weight: 0.25 },
  ],

  // ── Isolation: legs ──────────────────────────────────────────────
  "leg-curl-lying": [{ muscle: "hamstrings", weight: 1.0 }],
  "leg-curl-seated": [{ muscle: "hamstrings", weight: 1.0 }],
  "leg-extension": [{ muscle: "quads", weight: 1.0 }],
  "nordic-ham-curl": [
    { muscle: "hamstrings", weight: 1.0 },
    { muscle: "glutes", weight: 0.25 },
  ],
  // The bridge holds hip extension for the whole set, so the glutes carry more
  // than in a machine curl and the trunk braces throughout.
  "sliding-leg-curl": [
    { muscle: "hamstrings", weight: 1.0 },
    { muscle: "glutes", weight: 0.5 },
    { muscle: "core", weight: 0.25 },
  ],
  "calf-raise-standing": [{ muscle: "calves", weight: 1.0 }],
  "calf-raise-seated": [{ muscle: "calves", weight: 1.0 }],
  "tibialis-raise": [{ muscle: "calves", weight: 0.25 }],
  "hip-adduction-machine": [{ muscle: "adductors", weight: 1.0 }],
  "copenhagen-plank": [
    { muscle: "adductors", weight: 1.0 },
    { muscle: "core", weight: 0.5 },
  ],

  // ── Isolation: arms ──────────────────────────────────────────────
  "bb-curl": [{ muscle: "biceps", weight: 1.0 }, { muscle: "forearms", weight: 0.25 }],
  "ez-bar-curl": [{ muscle: "biceps", weight: 1.0 }, { muscle: "forearms", weight: 0.25 }],
  "db-curl-standing": [
    { muscle: "biceps", weight: 1.0 },
    { muscle: "forearms", weight: 0.25 },
  ],
  "db-curl-seated": [
    { muscle: "biceps", weight: 1.0 },
    { muscle: "forearms", weight: 0.25 },
  ],
  "hammer-curl": [
    { muscle: "biceps", weight: 1.0 },
    { muscle: "forearms", weight: 0.5 },
  ],
  "incline-db-curl": [
    { muscle: "biceps", weight: 1.0 },
    { muscle: "forearms", weight: 0.25 },
  ],
  "preacher-curl-ez": [{ muscle: "biceps", weight: 1.0 }],
  "preacher-curl-db": [{ muscle: "biceps", weight: 1.0 }],
  "cable-curl-rope": [
    { muscle: "biceps", weight: 1.0 },
    { muscle: "forearms", weight: 0.25 },
  ],
  "alternating-db-curl": [
    { muscle: "biceps", weight: 1.0 },
    { muscle: "forearms", weight: 0.25 },
  ],
  "spider-curl": [{ muscle: "biceps", weight: 1.0 }],
  "concentration-curl": [{ muscle: "biceps", weight: 1.0 }],
  "pushdown-rope": [{ muscle: "triceps", weight: 1.0 }],
  "pushdown-bar": [{ muscle: "triceps", weight: 1.0 }],
  "pushdown-v-handle": [{ muscle: "triceps", weight: 1.0 }],
  "overhead-tri-ext-db-two-hand": [{ muscle: "triceps", weight: 1.0 }],
  "overhead-tri-ext-db-single": [{ muscle: "triceps", weight: 1.0 }],
  "overhead-tri-ext-ez": [{ muscle: "triceps", weight: 1.0 }],
  "overhead-tri-ext-cable": [{ muscle: "triceps", weight: 1.0 }],
  "skull-crusher-ez": [{ muscle: "triceps", weight: 1.0 }],
  "skull-crusher-db": [{ muscle: "triceps", weight: 1.0 }],
  "jm-press": [{ muscle: "triceps", weight: 1.0 }, { muscle: "chest", weight: 0.25 }],
  "kickback-db": [{ muscle: "triceps", weight: 1.0 }],

  // ── Shoulders / upper-back isolation ─────────────────────────────
  "lateral-raise-db": [{ muscle: "shoulders", weight: 1.0 }],
  "lateral-raise-cable": [{ muscle: "shoulders", weight: 1.0 }],
  "lateral-raise-machine": [{ muscle: "shoulders", weight: 1.0 }],
  "leaning-lateral-raise": [{ muscle: "shoulders", weight: 1.0 }],
  "front-raise-db": [{ muscle: "shoulders", weight: 1.0 }],
  "rear-delt-fly-db": [
    { muscle: "shoulders", weight: 1.0 },
    { muscle: "back", weight: 0.25 },
  ],
  "rear-delt-fly-machine": [
    { muscle: "shoulders", weight: 1.0 },
    { muscle: "back", weight: 0.25 },
  ],
  "shrug-bb": [{ muscle: "traps", weight: 1.0 }, { muscle: "forearms", weight: 0.25 }],
  "shrug-db": [{ muscle: "traps", weight: 1.0 }, { muscle: "forearms", weight: 0.25 }],
  "shrug-trap-bar": [
    { muscle: "traps", weight: 1.0 },
    { muscle: "forearms", weight: 0.25 },
  ],
  "upright-row-bb": [
    { muscle: "shoulders", weight: 1.0 },
    { muscle: "traps", weight: 0.5 },
  ],

  // ── Chest isolation ──────────────────────────────────────────────
  "cable-fly-mid": [{ muscle: "chest", weight: 1.0 }],
  "cable-fly-high-to-low": [{ muscle: "chest", weight: 1.0 }],
  "cable-fly-low-to-high": [
    { muscle: "chest", weight: 1.0 },
    { muscle: "shoulders", weight: 0.25 },
  ],
  "db-fly-flat": [{ muscle: "chest", weight: 1.0 }],
  "db-fly-incline": [{ muscle: "chest", weight: 1.0 }],
  "pec-deck": [{ muscle: "chest", weight: 1.0 }],

  // ── Carries + grip ───────────────────────────────────────────────
  "farmer-carry-db": [
    { muscle: "forearms", weight: 1.0 },
    { muscle: "traps", weight: 0.5 },
    { muscle: "core", weight: 0.5 },
  ],
  "farmer-carry-kb": [
    { muscle: "forearms", weight: 1.0 },
    { muscle: "traps", weight: 0.5 },
    { muscle: "core", weight: 0.5 },
  ],
  "farmer-carry-trap-bar": [
    { muscle: "forearms", weight: 1.0 },
    { muscle: "traps", weight: 0.5 },
    { muscle: "core", weight: 0.5 },
  ],
  "suitcase-carry": [
    { muscle: "obliques", weight: 1.0 },
    { muscle: "core", weight: 0.5 },
    { muscle: "forearms", weight: 0.5 },
  ],

  // ── Core ─────────────────────────────────────────────────────────
  plank: [{ muscle: "core", weight: 1.0 }],
  "rkc-plank": [{ muscle: "core", weight: 1.0 }],
  "side-plank": [
    { muscle: "obliques", weight: 1.0 },
    { muscle: "core", weight: 0.5 },
  ],
  "hanging-leg-raise": [
    { muscle: "core", weight: 1.0 },
    { muscle: "obliques", weight: 0.25 },
  ],
  "hanging-knee-raise": [{ muscle: "core", weight: 1.0 }],
  "toes-to-bar": [
    { muscle: "core", weight: 1.0 },
    { muscle: "lats", weight: 0.25 },
  ],
  "cable-crunch": [{ muscle: "core", weight: 1.0 }],
  "ab-wheel-kneeling": [{ muscle: "core", weight: 1.0 }],
  "ab-wheel-standing": [{ muscle: "core", weight: 1.0 }],
  "dragon-flag": [{ muscle: "core", weight: 1.0 }],
  "weighted-decline-situp": [{ muscle: "core", weight: 1.0 }],
  "pallof-press": [
    { muscle: "obliques", weight: 1.0 },
    { muscle: "core", weight: 0.5 },
  ],
  "dead-bug": [{ muscle: "core", weight: 1.0 }],
  "hollow-body-hold": [{ muscle: "core", weight: 1.0 }],

  // ── Hyperextension family already mapped above (back-extension-45 / reverse-hyper).
};

/**
 * Fan out a movement to its weighted muscle list.
 *
 * 1. Static slug map wins (calibrated, deterministic).
 * 2. Otherwise fall back to the DB primary/secondary muscle columns.
 *
 * Returns [] if neither source has anything — caller should skip the
 * movement entirely for muscle freshness purposes.
 */
export function muscleFanoutFromMovementRow(args: {
  slug?: string | null;
  primaryMuscles?: readonly string[] | null;
  secondaryMuscles?: readonly string[] | null;
}): MuscleWeight[] {
  if (args.slug && MOVEMENT_MUSCLE_MAP[args.slug]) {
    return MOVEMENT_MUSCLE_MAP[args.slug];
  }
  const out = new Map<MuscleGroup, number>();
  for (const m of args.primaryMuscles ?? []) {
    const grp = MUSCLE_FROM_DB_ENUM[m];
    if (!grp) continue;
    out.set(grp, Math.max(out.get(grp) ?? 0, 1.0));
  }
  for (const m of args.secondaryMuscles ?? []) {
    const grp = MUSCLE_FROM_DB_ENUM[m];
    if (!grp) continue;
    out.set(grp, Math.max(out.get(grp) ?? 0, 0.5));
  }
  return Array.from(out, ([muscle, weight]) => ({ muscle, weight }));
}

/**
 * Cardio modality → weighted muscle fanout. Multipliers represent the
 * fraction of a typical strength-set load this modality contributes
 * per minute of work. Tuned by feel — see PR for justification table.
 *
 *   interval_run     intervals/VO2 running → big legs hit
 *   easy_run         Z2 run → moderate legs
 *   ride_z2          Z2 ride → mild legs (quads-dominant)
 *   ride_intervals   bike VO2/threshold → strong quads
 *   row              erg → upper-back + legs
 *   padel            padel/tennis → shoulders + obliques + legs
 *   swim             swim → lats + shoulders + back + core
 */
export const CARDIO_MODALITY_MAP: Record<string, MuscleWeight[]> = {
  interval_run: [
    { muscle: "quads", weight: 1.0 },
    { muscle: "hamstrings", weight: 1.0 },
    { muscle: "glutes", weight: 1.0 },
    { muscle: "calves", weight: 1.0 },
    { muscle: "core", weight: 0.25 },
  ],
  easy_run: [
    { muscle: "quads", weight: 0.5 },
    { muscle: "hamstrings", weight: 0.5 },
    { muscle: "glutes", weight: 0.5 },
    { muscle: "calves", weight: 0.5 },
  ],
  long_run: [
    { muscle: "quads", weight: 0.75 },
    { muscle: "hamstrings", weight: 0.75 },
    { muscle: "glutes", weight: 0.75 },
    { muscle: "calves", weight: 0.75 },
  ],
  ride_z2: [
    { muscle: "quads", weight: 0.5 },
    { muscle: "glutes", weight: 0.25 },
    { muscle: "calves", weight: 0.25 },
  ],
  ride_intervals: [
    { muscle: "quads", weight: 1.0 },
    { muscle: "glutes", weight: 0.5 },
    { muscle: "hamstrings", weight: 0.25 },
    { muscle: "calves", weight: 0.25 },
  ],
  padel: [
    { muscle: "shoulders", weight: 1.0 },
    { muscle: "obliques", weight: 1.0 },
    { muscle: "quads", weight: 0.5 },
    { muscle: "calves", weight: 0.5 },
    { muscle: "forearms", weight: 0.5 },
    { muscle: "core", weight: 0.5 },
  ],
  row: [
    { muscle: "lats", weight: 1.0 },
    { muscle: "back", weight: 1.0 },
    { muscle: "shoulders", weight: 0.5 },
    { muscle: "quads", weight: 0.5 },
    { muscle: "hamstrings", weight: 0.5 },
    { muscle: "glutes", weight: 0.5 },
    { muscle: "erectors", weight: 0.5 },
    { muscle: "biceps", weight: 0.25 },
  ],
  swim: [
    { muscle: "lats", weight: 1.0 },
    { muscle: "shoulders", weight: 1.0 },
    { muscle: "back", weight: 0.5 },
    { muscle: "triceps", weight: 0.5 },
    { muscle: "core", weight: 0.5 },
  ],
  ruck: [
    { muscle: "quads", weight: 0.5 },
    { muscle: "glutes", weight: 0.5 },
    { muscle: "calves", weight: 0.5 },
    { muscle: "erectors", weight: 0.5 },
    { muscle: "traps", weight: 0.25 },
  ],
  ski_erg: [
    { muscle: "lats", weight: 1.0 },
    { muscle: "core", weight: 0.5 },
    { muscle: "triceps", weight: 0.5 },
    { muscle: "shoulders", weight: 0.25 },
  ],
};

/**
 * Look up a cardio-log row's modality fanout. Returns [] for unknown
 * modalities — caller should fall back to a leg-dominant default at
 * the lowest available weight, or just skip.
 */
export function cardioFanout(modality: string | null | undefined): MuscleWeight[] {
  if (!modality) return [];
  return CARDIO_MODALITY_MAP[modality] ?? [];
}

/** Type guard used by tests. */
export function isMuscleGroup(s: string): s is MuscleGroup {
  return (ALL_MUSCLE_GROUPS as readonly string[]).includes(s);
}
