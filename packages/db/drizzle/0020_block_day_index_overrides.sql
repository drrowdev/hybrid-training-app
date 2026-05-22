-- 0020_block_day_index_overrides.sql
-- Capture which calendar days (Mon=0..Sun=6) the user laid the block on
-- in the new block-creation wizard (step 5: "Lay out your week"). Nullable
-- so existing rows (and any non-wizard creation path) keep working.
--
-- Shape mirrors the wizard's localStorage hint (`hta-day-pref-v1`):
--   { "days": [0, 2, 4, 6], "twoADay": false }
--
-- Access is governed by the row's existing user_id RLS policy on
-- training_blocks; this column is not user-id-bearing.

ALTER TABLE "training_blocks"
  ADD COLUMN "day_index_overrides" jsonb;
