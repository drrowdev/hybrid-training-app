/**
 * Pure region helpers for limitations.
 *
 * Split out of `actions.ts` (a `"use server"` module that may only
 * export async functions) so the muscle→region inference and the
 * explicit-vs-inferred resolution can be unit-tested and imported by
 * client code without pulling in server-only deps.
 *
 * `REGIONS` is re-exported from the settings constants so there is a
 * single source of truth for the 7 region values.
 */
import { REGIONS, type Region } from "@/lib/settings/limitations-constants";

export { REGIONS };
export type { Region };

/**
 * Lossy muscle→region map (16 muscles → 7 regions). Used to infer a
 * `region` for rows authored through the muscle picker when the user
 * hasn't picked one explicitly. The engine's DC-V safety gates read
 * `limitations.region`, so an inferred region keeps those gates active.
 */
export const MUSCLE_TO_REGION: Record<string, Region> = {
  calves: "foot_ankle_calf",
  quads: "knee",
  hamstrings: "hamstring_posterior",
  glutes: "hamstring_posterior",
  adductors: "adductor_groin",
  erectors: "lumbar_trunk",
  core: "lumbar_trunk",
  obliques: "lumbar_trunk",
  shoulders: "shoulder_scapular",
  traps: "shoulder_scapular",
  lats: "shoulder_scapular",
  back: "shoulder_scapular",
  chest: "shoulder_scapular",
  biceps: "elbow_forearm",
  triceps: "elbow_forearm",
  forearms: "elbow_forearm",
};

/**
 * First-match region inference over the selected muscles. Returns null
 * if nothing maps cleanly (the row then relies on its muscle/movement
 * arrays only).
 */
export function inferRegion(muscles: readonly string[]): Region | null {
  for (const m of muscles) {
    const r = MUSCLE_TO_REGION[m];
    if (r) return r;
  }
  return null;
}

/**
 * Resolve the effective region to persist.
 *
 *   - `undefined` → "Auto": infer from the selected muscles (legacy
 *     behaviour; keeps callers that don't pass a region byte-identical).
 *   - explicit `null` → "None": the user cleared the region.
 *   - a `Region` → use it verbatim.
 */
export function resolveRegion(
  explicit: Region | null | undefined,
  muscles: readonly string[],
): Region | null {
  if (explicit !== undefined) return explicit;
  return inferRegion(muscles);
}
