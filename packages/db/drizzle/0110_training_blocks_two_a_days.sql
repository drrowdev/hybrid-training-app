-- 0110_training_blocks_two_a_days.sql
--
-- Per-block two-a-day preference. Moves the two-a-day choice from the global
-- `profiles.allows_two_a_days` setting to a per-block decision made in the
-- Hybrid program wizard's Schedule step.
--
-- NULLABLE with NO default: null means "inherit profile / legacy", so every
-- existing block (and any block created before this column is written) reads
-- byte-identically to the old profile-driven behaviour. The planner read
-- (`build-block-assembly-context.ts`) lets a non-null per-block value win and
-- falls back to `profiles.allows_two_a_days` when null/undefined.

ALTER TABLE public.training_blocks
  ADD COLUMN IF NOT EXISTS allows_two_a_days boolean;
