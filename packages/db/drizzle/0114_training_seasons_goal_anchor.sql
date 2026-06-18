-- 0114_training_seasons_goal_anchor.sql
--
-- ADR 0051 Phase 1 — give a Season an optional GOAL anchor. A Season can point
-- at an event (a priority_events A-event) or a themed target date; the roadmap
-- back-calculates "N weeks out" and pins the peak/realize block to event week
-- (the taper itself stays ADR 0008's — the Season only orders blocks up to it).
--
-- Purely additive nullable columns: a Season with no goal (the Phase 0 shape)
-- is unaffected, and the columns default to NULL. The event FK is ON DELETE SET
-- NULL so deleting an event never cascades into Season history.

ALTER TABLE public.training_seasons
  ADD COLUMN IF NOT EXISTS goal_type text;            -- NULL | 'event' | 'theme'

ALTER TABLE public.training_seasons
  ADD COLUMN IF NOT EXISTS target_event_id uuid
  REFERENCES public.priority_events(id) ON DELETE SET NULL;

ALTER TABLE public.training_seasons
  ADD COLUMN IF NOT EXISTS target_date date;          -- denormalised event/peak date
