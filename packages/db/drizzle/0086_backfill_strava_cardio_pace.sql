-- 0086_backfill_strava_cardio_pace.sql
--
-- Backfill avg_pace_sec_per_km on existing Strava-imported cardio rows.
--
-- Strava import (lib/integrations/strava/sync-row.ts) historically built the
-- cardio_logs row WITHOUT computing avg_pace_sec_per_km, so every imported run
-- left that column NULL. lib/stats/pace-prs.ts reads avg_pace_sec_per_km to
-- compute pace PRs (run modality only) — meaning pace PRs never populated for
-- imported activities. The import code now computes pace = duration / distance
-- (sec per km); this migration repairs the existing rows so historical imports
-- light up immediately.
--
-- Scope: only Strava-sourced rows that have a usable distance and no pace yet.
-- Pace = duration_sec / distance_km, rounded to whole seconds. Rows without a
-- positive distance (treadmill, indoor, distance-less modalities) stay NULL.
-- Idempotent: the WHERE clause skips any row that already has a pace.
UPDATE public.cardio_logs
SET avg_pace_sec_per_km = ROUND(duration_sec::numeric / distance_km)::integer
WHERE external_source = 'strava'
  AND avg_pace_sec_per_km IS NULL
  AND distance_km IS NOT NULL
  AND distance_km > 0
  AND duration_sec IS NOT NULL
  AND duration_sec > 0;
