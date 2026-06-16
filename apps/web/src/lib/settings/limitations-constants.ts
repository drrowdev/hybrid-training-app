/**
 * Shared constants + types for the profile-level limitations toggle.
 *
 * Lives outside the `"use server"` actions module because Next.js
 * requires server-action files to export only async functions —
 * exporting a const array there strips it from the client bundle and
 * crashes the SSR import.
 */

export const REGIONS = [
  "foot_ankle_calf",
  "knee",
  "hamstring_posterior",
  "adductor_groin",
  "lumbar_trunk",
  "shoulder_scapular",
  "elbow_forearm",
] as const;

export type Region = (typeof REGIONS)[number];

/**
 * Human-readable per-region labels.
 *
 * Originally shipped inline in `LimitationsToggleSection` (PR #182);
 * hoisted here so display surfaces (e.g. the region-spike warning
 * banner on Today) can reuse the same vocabulary without duplicating
 * the map.
 */
export const REGION_LABELS: Record<Region, string> = {
  foot_ankle_calf: "Foot / ankle / calf",
  knee: "Knee",
  hamstring_posterior: "Hamstring / posterior chain",
  adductor_groin: "Adductor / groin",
  lumbar_trunk: "Lumbar / trunk",
  shoulder_scapular: "Shoulder / scapular",
  elbow_forearm: "Elbow / forearm",
};
