-- 0129_drop_superset_accessories.down.sql
--
-- Reverses the SCHEMA change in 0129 only. The dropped values are gone: this
-- restores `profiles.superset_accessories` to its original default (false) and
-- `training_blocks.superset_accessories` to null ("inherit profile / legacy"),
-- which is exactly what a fresh row would have carried.
--
-- Restoring the schema does NOT restore auto-pairing behaviour — the code that
-- read these columns was deleted in the same release. Rolling the application
-- back to a build that still reads them is what re-activates it.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS superset_accessories boolean NOT NULL DEFAULT false;

ALTER TABLE public.training_blocks
  ADD COLUMN IF NOT EXISTS superset_accessories boolean;
