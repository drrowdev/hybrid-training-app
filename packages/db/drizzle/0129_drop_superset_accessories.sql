-- 0129_drop_superset_accessories.sql
--
-- Removes the auto-pairing preference columns.
--
-- The block-level "Superset accessories" toggle auto-paired anatomically
-- antagonist accessories at read time. It has been replaced by explicit,
-- user-authored links between lifts (stored in `program_instances.instance`
-- and `.setup_input` as `sessionLinks`, and realised by the engine as
-- `prescription.items[].circuit`), so nothing reads these columns any more.
--
-- Destructive and deliberate (owner-approved): the columns hold only a
-- preference, never prescribed work. No prescription or set_log is touched, so
-- no training history is affected — existing blocks simply stop showing
-- auto-paired brackets and keep the exact same prescribed items, sets and reps.
--
-- Deploy ORDER MATTERS: ship the application release that stops reading these
-- columns FIRST. Running this migration against an older build breaks the plan
-- queries (`planner/queries.ts`), the session logger and the program wizard,
-- all of which select the columns by name.
--
-- The down migration in `0129_drop_superset_accessories.down.sql` restores the
-- schema but NOT the values; they are intentionally discarded.

ALTER TABLE public.training_blocks
  DROP COLUMN IF EXISTS superset_accessories;

ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS superset_accessories;
