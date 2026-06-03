-- 0083_training_blocks_accessory_volume.sql
--
-- ADR 0024 — accessory volume level (Low / Medium / High).
--
-- A per-block lever for how MUCH accessory work a strength day carries,
-- deliberately split from the ADR 0016 effort axis (low volume != low effort).
-- "Minimalism" is the `low` end on a strength-leaning block: keep the heavy
-- compounds, trim accessory breadth. See
-- `apps/web/src/lib/planner/accessory-volume.ts`.
--
-- Stored per block (baked at creation like `power_emphasis` / `focus_muscles`).
-- `medium` is the byte-identical identity, so the NOT NULL DEFAULT 'medium'
-- backfills every existing row to today's prescription with zero behaviour
-- change — the engine-regression guarantee. (This supersedes the ADR 0016
-- accessory VOLUME axis on `profiles.effort_preference`; the rare
-- non-'standard' hypertrophy user created days ago re-picks volume here.)
ALTER TABLE public.training_blocks
  ADD COLUMN IF NOT EXISTS accessory_volume text NOT NULL DEFAULT 'medium';

-- Bounded allowlist mirrors `AccessoryVolumeLevel`.
ALTER TABLE public.training_blocks
  DROP CONSTRAINT IF EXISTS training_blocks_accessory_volume_chk;
ALTER TABLE public.training_blocks
  ADD CONSTRAINT training_blocks_accessory_volume_chk
    CHECK (accessory_volume IN ('low', 'medium', 'high'));
