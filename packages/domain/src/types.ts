/**
 * Shared engine types.
 *
 * Source of truth for vocabulary used across packages/domain, packages/engine,
 * and packages/db. When a concept appears in multiple places, define it here
 * once and import — never re-derive (per DC-K3 single home for derived state).
 */

/** Six global stress buckets per DC-A3. */
export type Bucket =
  | "neural"
  | "mechanical"
  | "metabolic"
  | "impact"
  | "axial"
  | "tissue";

/** Tracked body regions per DC-A6. */
export type Region =
  | "foot_ankle_calf"
  | "knee"
  | "hamstring_posterior"
  | "adductor_groin"
  | "lumbar_trunk"
  | "shoulder_scapular"
  | "elbow_forearm";

/** Mesocycle archetypes per DC-F1 (engine-internal labels only). */
export type Archetype =
  | "balanced_hybrid_build"
  | "strength_biased_hybrid"
  | "aesthetic_hybrid"
  | "engine_biased_hybrid"
  | "rebuild_return";

/** Active limitation severity per DC-V1. */
export type LimitationSeverity = "mild" | "moderate" | "severe";

export const ALL_BUCKETS: readonly Bucket[] = [
  "neural",
  "mechanical",
  "metabolic",
  "impact",
  "axial",
  "tissue",
] as const;

export const ALL_REGIONS: readonly Region[] = [
  "foot_ankle_calf",
  "knee",
  "hamstring_posterior",
  "adductor_groin",
  "lumbar_trunk",
  "shoulder_scapular",
  "elbow_forearm",
] as const;
