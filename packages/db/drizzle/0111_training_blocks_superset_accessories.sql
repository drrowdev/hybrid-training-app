-- 0111_training_blocks_superset_accessories.sql
--
-- Per-block antagonist-superset accessory preference. Moves the superset choice
-- from the global `profiles.superset_accessories` setting to a per-block decision
-- made in the program wizard's Schedule step (shown for ALL programs).
--
-- NULLABLE with NO default: null means "inherit profile / legacy", so every
-- existing block (and any block created before this column is written) reads
-- byte-identically to the old profile-driven behaviour. The read-time pairing
-- (`apps/web/src/lib/planner/queries.ts`) lets a non-null per-block value WIN and
-- falls back to `profiles.superset_accessories` when null/undefined.

ALTER TABLE public.training_blocks
  ADD COLUMN IF NOT EXISTS superset_accessories boolean;
