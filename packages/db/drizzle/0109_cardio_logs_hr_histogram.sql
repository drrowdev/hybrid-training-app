-- 0109_cardio_logs_hr_histogram.sql
--
-- Add a band-independent bpm→seconds HR histogram to cardio_logs so a
-- zone-config change can re-bucket past activities' hr_zones locally
-- (via zonesFromHistogram) with no Strava stream re-fetch.
--
-- Populated by the import / webhook-sync paths whenever a per-second HR
-- stream is fetched (alongside the measured hr_zones). Null on
-- stream-less / manual rows. Nullable + no backfill here — existing
-- rows gain a histogram on the next stream fetch or a one-off backfill.
ALTER TABLE public.cardio_logs
  ADD COLUMN IF NOT EXISTS hr_histogram jsonb;
