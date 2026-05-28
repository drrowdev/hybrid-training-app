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

/** Sentinel `kind` values written by the toggle UI. */
export const KIND_REGION_TOGGLE = "Region limitation";
export const KIND_TENDINOPATHY = "Tendinopathy";

export type UpdateLimitationsInput = {
  blockedRegions: Region[];
  tendinopathyActive: boolean;
};

export type UpdateLimitationsResult =
  | { ok: true }
  | { ok: false; error: string };
