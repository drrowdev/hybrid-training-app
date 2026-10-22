/**
 * Single home for "does this cardio station carry a weight to log?".
 * Keyed on the catalog slug because the authored `modality` the cardio part
 * carries only distinguishes run / bike / row / ski, never a sled.
 */
export function isLoadedStationSlug(slug: string | null | undefined): boolean {
  return typeof slug === "string" && slug.startsWith("sled-");
}
