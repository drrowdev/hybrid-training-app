-- 0103 — training_blocks program-platform columns.
--
-- The multi-program platform materialises a program instance into a
-- training_blocks row (+ planned_sessions). Until now a platform block had to
-- stash a 'program:<family>' placeholder in the legacy archetype column to
-- satisfy its NOT NULL constraint. This migration:
--   - adds dedicated program_id / program_family columns (NULL for legacy
--     archetype blocks), and
--   - relaxes archetype to nullable, so platform blocks can leave it NULL and
--     the read side derives identity from program_id / program_family instead.
--
-- No backfill: existing archetype blocks keep their archetype value and leave
-- the new columns NULL. RLS is unchanged (column adds inherit the table policy).

ALTER TABLE public.training_blocks
  ADD COLUMN IF NOT EXISTS program_id text,
  ADD COLUMN IF NOT EXISTS program_family text;

ALTER TABLE public.training_blocks
  ALTER COLUMN archetype DROP NOT NULL;
