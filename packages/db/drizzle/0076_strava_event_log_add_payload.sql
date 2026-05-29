-- 0076_strava_event_log_add_payload.sql
--
-- PR #210 review (review-210 #1) caught a schema mismatch: the
-- `strava_event_log` table created in 0075 was missing two columns
-- the webhook handler writes to:
--   * `payload` (jsonb)    — full event body for forensic audit
--   * `processed_note`     — short status string ("ok", "deauthorized",
--                            "no-connection", etc.) recorded alongside
--                            `processed_ok` so we can grep failures
--                            without re-fetching the payload.
--
-- Without these, every inbound Strava webhook crashes on INSERT and
-- Strava retries indefinitely. Adding the columns NOT NULL is unsafe
-- because the dedup unique index would not protect an unrolled retry
-- from leaving rows with NULL payload during the migration window —
-- so both new columns are nullable. Future inserts always provide a
-- value (the application layer enforces it).

ALTER TABLE public.strava_event_log
  ADD COLUMN IF NOT EXISTS payload        jsonb,
  ADD COLUMN IF NOT EXISTS processed_note text;
