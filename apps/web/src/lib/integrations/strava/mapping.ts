/**
 * Strava sport_type / type → our cardio modality + primary region.
 *
 * Strava distinguishes `sport_type` (newer, fine-grained) from `type`
 * (legacy, coarse). Sync code passes `sport_type` first, falling back to
 * `type`.
 *
 * Region attribution is conservative: cardio mostly loads the same
 * regions (knee/hip for running, knee for cycling, shoulder for swim).
 * Secondary regions are credited via the same 0.5 multiplier the ledger
 * uses for strength.
 *
 * Unsupported types (WeightTraining, Workout, Yoga, etc.) return null —
 * the sync code skips them. Strength is logged via our own UI; pulling
 * Strava's WeightTraining rows would create duplicates.
 */

export type CardioModality =
  | "run"
  | "bike"
  | "swim"
  | "walk"
  | "row"
  | "ski"
  | "other_cardio";

export type CardioRegionMap = {
  modality: CardioModality;
  primaryRegion: string;
  secondaryRegions: string[];
};

const MAP: Record<string, CardioRegionMap> = {
  Run: { modality: "run", primaryRegion: "knee", secondaryRegions: ["foot_ankle_calf", "hamstring_posterior"] },
  TrailRun: { modality: "run", primaryRegion: "knee", secondaryRegions: ["foot_ankle_calf", "hamstring_posterior"] },
  VirtualRun: { modality: "run", primaryRegion: "knee", secondaryRegions: ["foot_ankle_calf", "hamstring_posterior"] },
  Treadmill: { modality: "run", primaryRegion: "knee", secondaryRegions: ["foot_ankle_calf"] },
  Ride: { modality: "bike", primaryRegion: "knee", secondaryRegions: ["lumbar_trunk"] },
  VirtualRide: { modality: "bike", primaryRegion: "knee", secondaryRegions: ["lumbar_trunk"] },
  EBikeRide: { modality: "bike", primaryRegion: "knee", secondaryRegions: [] },
  EMountainBikeRide: { modality: "bike", primaryRegion: "knee", secondaryRegions: [] },
  GravelRide: { modality: "bike", primaryRegion: "knee", secondaryRegions: ["lumbar_trunk"] },
  MountainBikeRide: { modality: "bike", primaryRegion: "knee", secondaryRegions: ["lumbar_trunk"] },
  Velomobile: { modality: "bike", primaryRegion: "knee", secondaryRegions: [] },
  Swim: { modality: "swim", primaryRegion: "shoulder_scapular", secondaryRegions: ["lumbar_trunk"] },
  Walk: { modality: "walk", primaryRegion: "knee", secondaryRegions: ["foot_ankle_calf"] },
  Hike: { modality: "walk", primaryRegion: "knee", secondaryRegions: ["foot_ankle_calf", "hamstring_posterior"] },
  Rowing: { modality: "row", primaryRegion: "lumbar_trunk", secondaryRegions: ["shoulder_scapular", "knee"] },
  VirtualRow: { modality: "row", primaryRegion: "lumbar_trunk", secondaryRegions: ["shoulder_scapular", "knee"] },
  Kayaking: { modality: "row", primaryRegion: "shoulder_scapular", secondaryRegions: ["lumbar_trunk"] },
  StandUpPaddling: { modality: "row", primaryRegion: "shoulder_scapular", secondaryRegions: ["lumbar_trunk"] },
  NordicSki: { modality: "ski", primaryRegion: "knee", secondaryRegions: ["shoulder_scapular", "lumbar_trunk"] },
  BackcountrySki: { modality: "ski", primaryRegion: "knee", secondaryRegions: ["foot_ankle_calf"] },
  AlpineSki: { modality: "other_cardio", primaryRegion: "knee", secondaryRegions: [] },
  RollerSki: { modality: "ski", primaryRegion: "knee", secondaryRegions: ["shoulder_scapular"] },
  Snowshoe: { modality: "walk", primaryRegion: "knee", secondaryRegions: ["foot_ankle_calf"] },
  Elliptical: { modality: "other_cardio", primaryRegion: "knee", secondaryRegions: [] },
  StairStepper: { modality: "other_cardio", primaryRegion: "knee", secondaryRegions: ["foot_ankle_calf"] },
};

/**
 * Sport types we intentionally do NOT import. Strength-style entries are
 * logged in our own ledger; importing them would double-count load.
 * "Workout" / "Crossfit" are too ambiguous to attribute regions to.
 */
const SKIPPED = new Set([
  "WeightTraining",
  "Workout",
  "Crossfit",
  "Yoga",
  "Pilates",
  "RockClimbing",
  "IceSkate",
  "InlineSkate",
  "Skateboard",
  "Surfing",
  "Kitesurf",
  "Windsurf",
  "Sail",
  "Golf",
  "Soccer",
  "Tennis",
  "Badminton",
  "Pickleball",
  "Squash",
  "TableTennis",
  "Racquetball",
  "Handcycle",
  "Wheelchair",
  "Snowboard",
]);

/**
 * Modality → region mapping, used when a cardio_logs row has no
 * movement_id (e.g. Strava-imported activities). Keeps cardio counted in
 * the region ledger without forcing every Strava activity to a catalog
 * movement.
 */
export const MODALITY_REGION: Record<string, { primaryRegion: string; secondaryRegions: string[] }> = {
  run: { primaryRegion: "knee", secondaryRegions: ["foot_ankle_calf", "hamstring_posterior"] },
  bike: { primaryRegion: "knee", secondaryRegions: ["lumbar_trunk"] },
  swim: { primaryRegion: "shoulder_scapular", secondaryRegions: ["lumbar_trunk"] },
  walk: { primaryRegion: "knee", secondaryRegions: ["foot_ankle_calf"] },
  row: { primaryRegion: "lumbar_trunk", secondaryRegions: ["shoulder_scapular", "knee"] },
  ski: { primaryRegion: "knee", secondaryRegions: ["shoulder_scapular", "lumbar_trunk"] },
  other_cardio: { primaryRegion: "knee", secondaryRegions: [] },
};

/**
 * Returns the mapping for a Strava activity, or null if the activity
 * should be skipped. Falls back from sport_type → type so legacy
 * activities still work.
 */
export function mapStravaActivity(
  sportType: string | null | undefined,
  type: string | null | undefined,
): CardioRegionMap | null {
  const candidate = sportType || type;
  if (!candidate) return null;
  if (SKIPPED.has(candidate)) return null;
  const direct = MAP[candidate];
  if (direct) return direct;
  return null;
}
