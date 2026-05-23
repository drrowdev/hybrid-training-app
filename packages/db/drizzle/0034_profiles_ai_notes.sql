-- 0034_profiles_ai_notes.sql
--
-- Add a single `ai_notes` text column to `profiles`. This is a
-- free-text field the user owns and edits from the new training-
-- profile page; the engine will start appending observations to it
-- later when the AI surface lands. Default NULL — no migration of
-- existing rows.
--
-- The `units` column was added in an earlier migration (see 0000
-- snapshot + the live `profiles.units` column with default 'metric')
-- so this migration only carries `ai_notes`. Keeping the file name
-- focused on the new column to avoid an empty `units` ALTER no-op.
--
-- RLS: no policy changes. The existing `id = auth.uid()` SELECT/UPDATE
-- policies cover the new column without further work.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS ai_notes text;
