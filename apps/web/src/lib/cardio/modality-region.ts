/**
 * Cardio modality → body-region attribution.
 *
 * Used when a `cardio_logs` row has no `movement_id` — the region ledger
 * needs *some* region attribution for cardio so a hard run still shows up
 * as knee/calf load. Keeps cardio counted without forcing every logged
 * activity onto a catalog movement.
 *
 * Region attribution is deliberately conservative: cardio mostly loads the
 * same regions (knee/hip for running, knee for cycling, shoulder for
 * swim). Secondary regions are credited via the same 0.5 multiplier the
 * ledger uses for strength.
 *
 * Consumers: `lib/engine/region-ledger.ts` (canonical reader), plus
 * `lib/hyrox/materialize-actuals.ts` which emits raw keys from this map.
 * The key set is therefore load-bearing — emitting a modality string
 * without a key here silently drops its region contribution, which
 * `lib/hyrox/__tests__/materialize-actuals.test.ts` guards.
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
  primaryRegion: string;
  secondaryRegions: string[];
};

export const MODALITY_REGION: Record<string, CardioRegionMap> = {
  run: { primaryRegion: "knee", secondaryRegions: ["foot_ankle_calf", "hamstring_posterior"] },
  bike: { primaryRegion: "knee", secondaryRegions: ["lumbar_trunk"] },
  swim: { primaryRegion: "shoulder_scapular", secondaryRegions: ["lumbar_trunk"] },
  walk: { primaryRegion: "knee", secondaryRegions: ["foot_ankle_calf"] },
  row: { primaryRegion: "lumbar_trunk", secondaryRegions: ["shoulder_scapular", "knee"] },
  ski: { primaryRegion: "knee", secondaryRegions: ["shoulder_scapular", "lumbar_trunk"] },
  other_cardio: { primaryRegion: "knee", secondaryRegions: [] },
};
