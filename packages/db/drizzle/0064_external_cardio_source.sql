-- 0064_external_cardio_source.sql
--
-- Phase 1 of the "external cardio" feature. The user follows a
-- dedicated run program (Runna / Garmin Coach / Hal Higdon / etc.)
-- and the hybrid app stops prescribing run specifics. Cardio days
-- still get planned_session rows so the calendar + concurrent-stress
-- math still see them, but each cardio item is kind=cardio_external
-- with no movement / duration / intensity.
--
-- Columns only — no functions, ON CONFLICT, or new GRANTs. The
-- baseline `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN
-- SCHEMA public TO authenticated` from 0001 is table-level (not
-- column-level), so the new columns inherit access automatically.
-- RLS on `training_blocks` / `profiles` continues to scope rows by
-- `user_id` / `id = auth.uid()`.

ALTER TABLE public.training_blocks
  ADD COLUMN IF NOT EXISTS cardio_source text NOT NULL DEFAULT 'internal'
    CHECK (cardio_source IN ('internal', 'external'));
ALTER TABLE public.training_blocks
  ADD COLUMN IF NOT EXISTS cardio_source_name text;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS preferred_cardio_source text NOT NULL DEFAULT 'internal'
    CHECK (preferred_cardio_source IN ('internal', 'external'));
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS preferred_cardio_source_name text;
