import {
  parseSwimActualResult,
  swimSnapshotExposure,
  type SwimExposureUnion,
} from "@hta/domain";

/** One actual swim contributes through one ordinary cardio row, never per repeat. */
export function structuredSwimRegions(value: unknown): SwimExposureUnion | null {
  if (value === null || value === undefined) return null;
  const parsed = parseSwimActualResult(value);
  if (!parsed.ok) throw new Error(`Invalid swimming history: ${parsed.error.message}`);
  return swimSnapshotExposure(parsed.value.snapshot);
}
