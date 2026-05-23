/**
 * The 16-muscle grid taxonomy.
 *
 * This is the visualisation vocabulary surfaced on /app/freshness and
 * the /app/stats/wellness muscle card. It maps cleanly to the existing
 * `muscle` enum on `movements` (22 finer values like front_delts /
 * rear_delts / upper_chest) — `MUSCLE_FROM_DB_ENUM` collapses the
 * fine-grained enum to the 16 display groups.
 *
 * Coexists with the 7-region engine taxonomy (DC-A6 / packages/domain
 * `Region`). The engine, planner, and existing freshness gates keep
 * reading regions — this layer is additive.
 */

export type MuscleGroup =
  | "quads"
  | "hamstrings"
  | "glutes"
  | "calves"
  | "core"
  | "chest"
  | "back"
  | "lats"
  | "traps"
  | "shoulders"
  | "biceps"
  | "triceps"
  | "forearms"
  | "obliques"
  | "erectors"
  | "adductors";

export const ALL_MUSCLE_GROUPS: readonly MuscleGroup[] = [
  "quads",
  "hamstrings",
  "glutes",
  "calves",
  "core",
  "chest",
  "back",
  "lats",
  "traps",
  "shoulders",
  "biceps",
  "triceps",
  "forearms",
  "obliques",
  "erectors",
  "adductors",
] as const;

export const MUSCLE_LABELS: Record<MuscleGroup, string> = {
  quads: "Quads",
  hamstrings: "Hamstrings",
  glutes: "Glutes",
  calves: "Calves",
  core: "Core",
  chest: "Chest",
  back: "Back",
  lats: "Lats",
  traps: "Traps",
  shoulders: "Shoulders",
  biceps: "Biceps",
  triceps: "Triceps",
  forearms: "Forearms",
  obliques: "Obliques",
  erectors: "Erectors",
  adductors: "Adductors",
};

/**
 * Collapse the finer `muscle` enum on `movements.primary_muscles` /
 * `secondary_muscles` to the 16-muscle display taxonomy.
 *
 * Anything not listed (abductors, neck, tibialis) maps to null and is
 * dropped from the grid — those don't have a dedicated tile.
 */
export const MUSCLE_FROM_DB_ENUM: Record<string, MuscleGroup | null> = {
  quads: "quads",
  hamstrings: "hamstrings",
  glutes: "glutes",
  calves: "calves",
  abs: "core",
  chest: "chest",
  upper_chest: "chest",
  mid_back: "back",
  lats: "lats",
  traps: "traps",
  front_delts: "shoulders",
  side_delts: "shoulders",
  rear_delts: "shoulders",
  biceps: "biceps",
  triceps: "triceps",
  forearms: "forearms",
  obliques: "obliques",
  lower_back: "erectors",
  adductors: "adductors",
  abductors: null,
  tibialis: null,
  neck: null,
};
